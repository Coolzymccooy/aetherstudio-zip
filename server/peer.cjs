// Lightweight local PeerJS signaling server
// Run with: npm run peer

const http = require("http");
const express = require("express");
const { ExpressPeerServer } = require("peer");
const net = require("net");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const PORT = Number(process.env.PEER_PORT || process.env.PORT || 9000);
const PEER_AUTO_REBIND = String(process.env.PEER_AUTO_REBIND || "false").toLowerCase() === "true";
const PEER_REUSE_PORT =
  process.argv.includes("--reuse-port") || String(process.env.PEER_REUSE_PORT || "").toLowerCase() === "true";
const PORT_SCAN_LIMIT = 10;
const PEER_PATH = process.env.PEER_PATH || "/peerjs";
const LOCAL_RUN_DIR = path.join(__dirname, "..", ".local-run");
const PEER_LOCK_PATH = path.join(LOCAL_RUN_DIR, "peer.pid");

const ensureDir = (dir) => {
  try { fs.mkdirSync(dir, { recursive: true }); } catch { }
};
ensureDir(LOCAL_RUN_DIR);

const processExists = (pid) => {
  try {
    return process.kill(pid, 0), true;
  } catch (err) {
    return err && err.code === "EPERM";
  }
};

const rotateLocalLogs = (maxBytes = 2 * 1024 * 1024, keep = 3) => {
  if (!fs.existsSync(LOCAL_RUN_DIR)) return;
  const now = Date.now();
  const logFiles = fs.readdirSync(LOCAL_RUN_DIR).filter((f) => f.endsWith(".log"));
  logFiles.forEach((f) => {
    const full = path.join(LOCAL_RUN_DIR, f);
    try {
      const st = fs.statSync(full);
      if (st.size <= maxBytes) return;
      fs.renameSync(full, `${full}.${now}.bak`);
    } catch { }
  });
  const backups = fs.readdirSync(LOCAL_RUN_DIR).filter((f) => f.endsWith(".bak"));
  const byBase = new Map();
  backups.forEach((f) => {
    const base = f.split(".log")[0];
    if (!byBase.has(base)) byBase.set(base, []);
    byBase.get(base).push(path.join(LOCAL_RUN_DIR, f));
  });
  byBase.forEach((files) => {
    const sorted = files.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
    sorted.slice(keep).forEach((stale) => { try { fs.unlinkSync(stale); } catch { } });
  });
};

const ensureSingleInstance = () => {
  if (fs.existsSync(PEER_LOCK_PATH)) {
    const existingPid = Number(fs.readFileSync(PEER_LOCK_PATH, "utf8").trim());
    if (existingPid && processExists(existingPid)) {
      throw new Error(`peer_already_running_pid_${existingPid}`);
    }
  }
  fs.writeFileSync(PEER_LOCK_PATH, String(process.pid));
  const cleanup = () => { try { fs.unlinkSync(PEER_LOCK_PATH); } catch { } };
  process.once("exit", cleanup);
  process.once("SIGINT", () => { cleanup(); process.exit(); });
  process.once("SIGTERM", () => { cleanup(); process.exit(); });
};

const logPortConflict = (port) => {
  try {
    const out = execSync(`netstat -ano | findstr :${port}`, { encoding: "utf8" });
    console.error(`[peer] Port ${port} in use. netstat: ${out.split(/\r?\n/).slice(0, 3).join(" ")}`);
  } catch (err) {
    console.error(`[peer] Port ${port} in use. netstat unavailable: ${err?.message || "unknown"}`);
  }
};

const isPortFree = (port) =>
  new Promise((resolve) => {
    const tester = net.createServer();
    tester.once("error", () => {
      tester.close(() => resolve(false));
    });
    tester.once("listening", () => {
      tester.close(() => resolve(true));
    });
    tester.listen({ port, host: "0.0.0.0", exclusive: true });
  });

const findAvailablePort = async (preferred) => {
  const limit = PEER_AUTO_REBIND ? PORT_SCAN_LIMIT : 0;
  for (let i = 0; i <= limit; i += 1) {
    const candidate = preferred + i;
    // eslint-disable-next-line no-await-in-loop
    const free = await isPortFree(candidate);
    if (free) return candidate;
    if (!PEER_AUTO_REBIND) break;
  }
  logPortConflict(preferred);
  throw new Error("port_in_use");
};

const app = express();
const server = http.createServer(app);

app.get("/", (_req, res) => {
  res.type("text/plain").send("Aether Local PeerServer Active");
});

// Match PeerJS client expectations: /peerjs/peerjs and /peerjs/peerjs/id
const peerServer = ExpressPeerServer(server, {
  path: PEER_PATH,
  allow_discovery: true,
});

app.use("/", peerServer);

const startPeerServer = async () => {
  try {
    rotateLocalLogs();
    ensureSingleInstance();
    const port = await findAvailablePort(PORT);
    server.listen({ port, host: "0.0.0.0", reusePort: PEER_REUSE_PORT }, () => {
      console.log(`Aether Local PeerServer running on port ${port}`);
      console.log(`PeerJS internal path: ${PEER_PATH} (mounted at /)`);
    });
    server.on("error", (err) => {
      console.error(`[peer] listen_error ${err?.code || "unknown"} ${err?.message || ""}`);
    });
  } catch (err) {
    console.error(`[peer] start_error ${err?.message || err}`);
    process.exitCode = 1;
  }
};

startPeerServer();
