const { app, BrowserWindow, dialog, shell } = require("electron");
const { spawn } = require("child_process");
const fs = require("fs");
const http = require("http");
const https = require("https");
const net = require("net");
const os = require("os");
const path = require("path");
const express = require("express");

const ROOT_DIR = path.resolve(__dirname, "..");
const UI_PORT = Number(process.env.AETHER_DESKTOP_UI_PORT || 5174);
const APP_URL_OVERRIDE = process.env.AETHER_DESKTOP_URL || "";
const START_LOCAL_SERVICES = (process.env.AETHER_DESKTOP_SKIP_SERVICES || "0") !== "1";
const START_UI_SERVER = (process.env.AETHER_DESKTOP_SKIP_UI_SERVER || "0") !== "1";
const FFMPEG_REL_PATH = path.join(
  "tools",
  "ffmpeg",
  "ffmpeg-8.0.1-essentials_build",
  "bin",
  "ffmpeg.exe"
);

const childProcesses = [];
let localUiServer = null;

const SINGLE_INSTANCE_LOCK = app.requestSingleInstanceLock();
if (!SINGLE_INSTANCE_LOCK) {
  app.quit();
  process.exit(0);
}

function getAppRoot() {
  return app.isPackaged ? app.getAppPath() : ROOT_DIR;
}

function getRunDir() {
  if (app.isPackaged) {
    return path.join(app.getPath("userData"), "logs");
  }
  return path.join(ROOT_DIR, ".local-run");
}

function resolveRuntimePath(relPath) {
  const appPath = path.join(getAppRoot(), relPath);
  if (!app.isPackaged) return appPath;
  const unpacked = path.join(process.resourcesPath, "app.asar.unpacked", relPath);
  if (fs.existsSync(unpacked)) return unpacked;
  return appPath;
}

function ensureRunDir() {
  const runDir = getRunDir();
  if (!fs.existsSync(runDir)) {
    fs.mkdirSync(runDir, { recursive: true });
  }
  return runDir;
}

function parseEnvFile(filePath) {
  const values = {};
  if (!fs.existsSync(filePath)) return values;
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/g);
  for (const line of lines) {
    const trimmed = String(line || "").trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1);
    values[key] = val;
  }
  return values;
}

function resolveLanAddress() {
  const nets = os.networkInterfaces();
  for (const netName of Object.keys(nets)) {
    const entries = nets[netName] || [];
    for (const entry of entries) {
      if (entry && entry.family === "IPv4" && !entry.internal) {
        return entry.address;
      }
    }
  }
  return "127.0.0.1";
}

function relayEnvFromLocal() {
  const envLocal = parseEnvFile(path.join(ROOT_DIR, ".env.local"));
  const env = { ...process.env };
  env.RELAY_PORT = env.RELAY_PORT || "8080";
  env.RELAY_TOKEN = env.RELAY_TOKEN || envLocal.VITE_RELAY_TOKEN || envLocal.RELAY_TOKEN || "";
  env.RTMP_URL_PRIMARY = env.RTMP_URL_PRIMARY || envLocal.RTMP_URL_PRIMARY || "";
  env.RTMP_URL_FALLBACK = env.RTMP_URL_FALLBACK || envLocal.RTMP_URL_FALLBACK || "";
  env.GEMINI_API_KEY = env.GEMINI_API_KEY || envLocal.VITE_GEMINI_API_KEY || "";
  if (!env.FFMPEG_PATH) {
    const ffmpegPath = resolveRuntimePath(FFMPEG_REL_PATH);
    if (fs.existsSync(ffmpegPath)) {
      env.FFMPEG_PATH = ffmpegPath;
    }
  }
  return env;
}

function spawnNodeScript(name, scriptRelPath, envOverrides) {
  const runDir = ensureRunDir();
  const outPath = path.join(runDir, `${name}.desktop.out.log`);
  const errPath = path.join(runDir, `${name}.desktop.err.log`);
  const outFd = fs.openSync(outPath, "a");
  const errFd = fs.openSync(errPath, "a");
  const scriptPath = resolveRuntimePath(scriptRelPath);
  const command = app.isPackaged ? process.execPath : "node";
  const env = {
    ...process.env,
    ...(app.isPackaged ? { ELECTRON_RUN_AS_NODE: "1" } : {}),
    ...(envOverrides || {}),
  };

  const child = spawn(command, [scriptPath], {
    cwd: getAppRoot(),
    env,
    stdio: ["ignore", outFd, errFd],
    windowsHide: true,
  });
  childProcesses.push(child);
  return child;
}

function stopChildProcesses() {
  while (childProcesses.length > 0) {
    const child = childProcesses.pop();
    if (!child || child.killed) continue;
    try {
      child.kill("SIGINT");
    } catch {}
  }
}

function stopLocalUiServer() {
  if (!localUiServer) return;
  try {
    localUiServer.close();
  } catch {}
  localUiServer = null;
}

function isPortListening(port, host = "127.0.0.1", timeoutMs = 800) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ port, host });
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      try {
        socket.destroy();
      } catch {}
      resolve(value);
    };

    socket.setTimeout(timeoutMs);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}

function waitForHttpReady(urlString, timeoutMs = 45000) {
  return new Promise((resolve, reject) => {
    const endAt = Date.now() + timeoutMs;
    const parsed = new URL(urlString);
    const client = parsed.protocol === "https:" ? https : http;

    const attempt = () => {
      if (Date.now() > endAt) {
        reject(new Error(`Timed out waiting for ${urlString}`));
        return;
      }
      const req = client.request(
        {
          method: "GET",
          protocol: parsed.protocol,
          hostname: parsed.hostname,
          port: parsed.port,
          path: parsed.pathname || "/",
          timeout: 1500,
        },
        (res) => {
          res.resume();
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 500) {
            resolve();
            return;
          }
          setTimeout(attempt, 400);
        }
      );
      req.on("timeout", () => {
        req.destroy();
        setTimeout(attempt, 400);
      });
      req.on("error", () => setTimeout(attempt, 400));
      req.end();
    };

    attempt();
  });
}

function startBundledUiServer(port) {
  return new Promise((resolve, reject) => {
    const distDir = resolveRuntimePath("dist");
    const indexPath = path.join(distDir, "index.html");
    if (!fs.existsSync(indexPath)) {
      reject(new Error(`Desktop build output missing: ${indexPath}`));
      return;
    }

    const web = express();
    web.disable("x-powered-by");
    web.use(express.static(distDir, { index: false }));
    web.get("*", (_req, res) => {
      res.sendFile(indexPath);
    });

    const server = web.listen(port, "0.0.0.0", () => {
      localUiServer = server;
      resolve();
    });
    server.on("error", reject);
  });
}

async function ensureAppUiUrl() {
  if (APP_URL_OVERRIDE) return APP_URL_OVERRIDE;

  const localUrl = `http://127.0.0.1:${UI_PORT}`;
  if (!app.isPackaged) return localUrl;

  const listening = await isPortListening(UI_PORT);
  if (!listening && START_UI_SERVER) {
    await startBundledUiServer(UI_PORT);
  }
  return localUrl;
}

function createWindow(appUrl) {
  const win = new BrowserWindow({
    width: 1680,
    height: 980,
    minWidth: 1280,
    minHeight: 800,
    autoHideMenuBar: true,
    title: "Aether Studio - AI Streaming",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });

  win.webContents.setWindowOpenHandler(({ url, frameName }) => {
    if (frameName === "AetherVirtualCable" || url === "about:blank") {
      return {
        action: "allow",
        overrideBrowserWindowOptions: {
          width: 1280,
          height: 720,
          autoHideMenuBar: true,
          title: "Aether Virtual Output",
          webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            backgroundThrottling: false,
          },
        },
      };
    }
    if (/^https?:\/\//i.test(url)) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });

  win.loadURL(appUrl);
}

app.whenReady().then(async () => {
  try {
    const appUrl = await ensureAppUiUrl();
    const lanAddress = resolveLanAddress();
    if (!process.env.AETHER_DESKTOP_MOBILE_BASE_URL) {
      process.env.AETHER_DESKTOP_MOBILE_BASE_URL = `http://${lanAddress}:${UI_PORT}`;
    }

    if (START_LOCAL_SERVICES) {
      const relayEnv = relayEnvFromLocal();
      const relayPort = Number(relayEnv.RELAY_PORT || 8080);
      const relayListening = await isPortListening(relayPort);
      if (!relayListening) {
        spawnNodeScript("relay", "aether-relay/server.js", relayEnv);
      }

      const peerListening = await isPortListening(9000);
      if (!peerListening) {
        spawnNodeScript("peer", "server/peer.cjs", process.env);
      }
    }

    await waitForHttpReady(appUrl, 45000);
    createWindow(appUrl);
  } catch (err) {
    dialog.showErrorBox(
      "AetherStudio Desktop Startup Failed",
      `Desktop startup failed.\n\n${String(err?.message || err)}`
    );
    app.quit();
  }
});

app.on("window-all-closed", () => {
  stopLocalUiServer();
  stopChildProcesses();
  app.quit();
});

app.on("second-instance", () => {
  const existing = BrowserWindow.getAllWindows()[0];
  if (!existing) return;
  if (existing.isMinimized()) existing.restore();
  existing.focus();
});

app.on("before-quit", () => {
  stopLocalUiServer();
  stopChildProcesses();
});
