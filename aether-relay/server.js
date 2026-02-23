// aether-relay/server.js (CommonJS)
const http = require("http");
const { WebSocketServer } = require("ws");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const url = require("url");
const crypto = require("crypto");
const {
  DEFAULT_MAX_DESTINATIONS,
  DEFAULT_SOFT_QUEUE_BYTES,
  DEFAULT_HARD_QUEUE_BYTES,
  buildRtmpUrl,
  normalizeDestinations,
  buildFfmpegArgs,
  isRtmpUrl,
  nextRestartDelayMs,
  queueCongestionLevel,
  redactRtmpTarget,
} = require("./relay-utils");

let genAiModule = null;
let genAiLoadError = null;

const loadGoogleGenAi = async () => {
  if (genAiModule) return genAiModule;
  if (genAiLoadError) throw genAiLoadError;
  try {
    genAiModule = await import("@google/genai");
    return genAiModule;
  } catch (err) {
    genAiLoadError = err;
    throw err;
  }
};

const PORT = Number(process.env.PORT || 8080);
const RELAY_TOKEN = process.env.RELAY_TOKEN || "";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const LICENSE_SECRET = process.env.LICENSE_SECRET || "";
const LICENSE_ADMIN_TOKEN = process.env.LICENSE_ADMIN_TOKEN || "";
const DEFAULT_FFMPEG_WIN = path.join(
  __dirname,
  "..",
  "tools",
  "ffmpeg",
  "ffmpeg-8.0.1-essentials_build",
  "bin",
  "ffmpeg.exe"
);
const DEFAULT_FFMPEG_NIX = "/usr/bin/ffmpeg";
const RTMP_URL_PRIMARY = process.env.RTMP_URL_PRIMARY || "rtmps://a.rtmp.youtube.com/live2";
const RTMP_URL_FALLBACK =
  process.env.RTMP_URL_FALLBACK || process.env.RTMP_URL || "rtmp://a.rtmp.youtube.com/live2";
const MAX_DESTINATIONS = Math.max(
  1,
  Number(process.env.RELAY_MAX_DESTINATIONS || DEFAULT_MAX_DESTINATIONS)
);
const SOFT_QUEUE_BYTES = Math.max(
  512 * 1024,
  Number(process.env.RELAY_SOFT_QUEUE_BYTES || DEFAULT_SOFT_QUEUE_BYTES)
);
const HARD_QUEUE_BYTES = Math.max(
  SOFT_QUEUE_BYTES + 256 * 1024,
  Number(process.env.RELAY_HARD_QUEUE_BYTES || DEFAULT_HARD_QUEUE_BYTES)
);
const RESTART_BASE_DELAY_MS = Math.max(
  300,
  Number(process.env.RELAY_RESTART_BASE_MS || 1500)
);
const RESTART_MAX_DELAY_MS = Math.max(
  RESTART_BASE_DELAY_MS,
  Number(process.env.RELAY_RESTART_MAX_MS || 12000)
);
const MAX_RESTART_ATTEMPTS = Math.max(
  1,
  Number(process.env.RELAY_MAX_RESTART_ATTEMPTS || 6)
);
const RELAY_SOAK_RESET_MS = Math.max(5000, Number(process.env.RELAY_SOAK_RESET_MS || 30000));
const INPUT_CHUNK_TIMEOUT_MS = Math.max(
  2000,
  Number(process.env.RELAY_INPUT_CHUNK_TIMEOUT_MS || 15000)
);

const resolveFfmpegPath = () => {
  const envPath = (process.env.FFMPEG_PATH || "").trim();
  const platformDefault = process.platform === "win32" ? DEFAULT_FFMPEG_WIN : DEFAULT_FFMPEG_NIX;
  if (envPath && fs.existsSync(envPath)) return envPath;
  if (fs.existsSync(platformDefault)) return platformDefault;
  return envPath || platformDefault;
};
const FFMPEG_PATH = resolveFfmpegPath();

const relayRuntime = {
  activeStreams: 0,
  totalStarts: 0,
  totalRestarts: 0,
  restartAttempts: 0,
  startRequests: 0,
  startAccepted: 0,
  startRejected: 0,
  lastStartRequestAt: null,
  lastStartRejectReason: null,
  ingestBytesTotal: 0,
  ingestChunksTotal: 0,
  ingestIgnoredNoStream: 0,
  ingestIgnoredNoFfmpeg: 0,
  ingestIgnoredNotActiveHost: 0,
  lastChunkAt: null,
  lastStartAt: null,
  lastFirstChunkAt: null,
  lastFirstChunkDelayMs: null,
  lastDestinationCount: 0,
  lastCloseCode: null,
  lastFfmpegPid: null,
  lastError: null,
  lastErrorAt: null,
  updatedAt: new Date().toISOString(),
};
const activeHostBySession = new Map();

function touchRuntime() {
  relayRuntime.updatedAt = new Date().toISOString();
}

function setLastError(message) {
  const clean = String(message || "").slice(0, 400);
  relayRuntime.lastError = clean || null;
  relayRuntime.lastErrorAt = clean ? new Date().toISOString() : null;
  touchRuntime();
}

function incrementRuntimeMetric(metricName) {
  relayRuntime[metricName] = Number(relayRuntime[metricName] || 0) + 1;
  touchRuntime();
}

function logEvent(event, fields = {}) {
  const payload = {
    service: "aether-relay",
    event,
    ts: new Date().toISOString(),
    ...fields,
  };
  console.log(JSON.stringify(payload));
}

function safeSendWs(ws, payload) {
  try {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(payload));
  } catch {}
}

function runFfmpegCheck(cb) {
  const ffmpegBin = fs.existsSync(FFMPEG_PATH) ? FFMPEG_PATH : "ffmpeg";
  let done = false;
  const chunks = [];
  const proc = spawn(ffmpegBin, ["-version"]);
  const timeout = setTimeout(() => {
    if (done) return;
    done = true;
    try {
      proc.kill("SIGKILL");
    } catch {}
    cb(new Error("ffmpeg_check_timeout"));
  }, 2500);

  proc.stdout.on("data", (d) => chunks.push(d));
  proc.stderr.on("data", (d) => chunks.push(d));
  proc.on("error", (err) => {
    if (done) return;
    done = true;
    clearTimeout(timeout);
    cb(err);
  });
  proc.on("close", (code) => {
    if (done) return;
    done = true;
    clearTimeout(timeout);
    const out = Buffer.concat(chunks).toString("utf8").trim();
    if (code === 0) {
      cb(null, out.split("\n")[0] || "ffmpeg available");
      return;
    }
    cb(new Error(out || `ffmpeg exited with code ${code}`));
  });
}

const base64UrlEncode = (buf) =>
  Buffer.from(buf)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

const base64UrlDecode = (str) => {
  const pad = str.length % 4 ? "=".repeat(4 - (str.length % 4)) : "";
  return Buffer.from(str.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
};

const signPayload = (payload) => {
  const body = base64UrlEncode(JSON.stringify(payload));
  const sig = base64UrlEncode(crypto.createHmac("sha256", LICENSE_SECRET).update(body).digest());
  return `PRO_${body}.${sig}`;
};

const verifyKey = (rawKey) => {
  if (!LICENSE_SECRET) {
    return { ok: false, pro: false, message: "license_secret_missing" };
  }
  const key = String(rawKey || "").trim();
  if (!key) return { ok: false, pro: false, message: "missing_key" };
  const stripped = key.replace(/^PRO[_-]/i, "");
  const parts = stripped.split(".");
  if (parts.length !== 2) return { ok: false, pro: false, message: "bad_format" };
  const [body, sig] = parts;
  const expected = base64UrlEncode(crypto.createHmac("sha256", LICENSE_SECRET).update(body).digest());
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return { ok: false, pro: false, message: "invalid_signature" };
  }
  let payload = {};
  try {
    payload = JSON.parse(base64UrlDecode(body).toString("utf8"));
  } catch {
    return { ok: false, pro: false, message: "invalid_payload" };
  }
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && now > payload.exp) {
    return { ok: false, pro: false, message: "expired" };
  }
  const plan = String(payload.plan || "pro").toLowerCase();
  return { ok: true, pro: plan === "pro", message: "ok", payload };
};

const server = http.createServer(async (req, res) => {
  const { pathname } = url.parse(req.url || "/");

  const sendJson = (code, body) => {
    res.writeHead(code, {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Admin-Token",
    });
    res.end(JSON.stringify(body));
  };

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Admin-Token",
    });
    res.end();
    return;
  }

  if (pathname === "/health") {
    sendJson(200, {
      ok: true,
      service: "aether-relay",
      ts: new Date().toISOString(),
      metrics: {
        ...relayRuntime,
        activeWsConnections: wss?.clients?.size || 0,
        activeHostSessions: activeHostBySession.size,
        ffmpegPath: FFMPEG_PATH,
      },
    });
    return;
  }

  if (pathname === "/ffmpeg") {
    runFfmpegCheck((err, version) => {
      if (err) {
        sendJson(500, { ok: false, error: String(err.message || err) });
        return;
      }
      sendJson(200, { ok: true, version, path: FFMPEG_PATH });
    });
    return;
  }

  if (pathname === "/license/health") {
    if (!LICENSE_SECRET) {
      sendJson(503, { ok: false, error: "license_secret_missing" });
      return;
    }
    sendJson(200, { ok: true, service: "aether-license", ts: new Date().toISOString() });
    return;
  }

  if (pathname === "/license/verify") {
    if (!LICENSE_SECRET) {
      sendJson(503, { ok: false, error: "license_secret_missing" });
      return;
    }
    const chunks = [];
    req.on("data", (d) => chunks.push(d));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8") || "{}";
        const body = JSON.parse(raw);
        const result = verifyKey(body.key);
        if (!result.ok) {
          sendJson(401, { ok: false, pro: false, message: result.message });
          return;
        }
        sendJson(200, { ok: true, pro: result.pro, message: "verified" });
      } catch (e) {
        sendJson(500, {
          ok: false,
          error: "license_exception",
          details: e?.message || "unknown",
        });
      }
    });
    return;
  }

  if (pathname === "/license/issue") {
    if (!LICENSE_SECRET) {
      sendJson(503, { ok: false, error: "license_secret_missing" });
      return;
    }
    if (!LICENSE_ADMIN_TOKEN) {
      sendJson(403, { ok: false, error: "license_admin_disabled" });
      return;
    }
    const adminHeader = req.headers["x-admin-token"] || req.headers["authorization"];
    const adminToken = Array.isArray(adminHeader) ? adminHeader[0] : adminHeader;
    if (String(adminToken || "").replace(/^Bearer\s+/i, "") !== LICENSE_ADMIN_TOKEN) {
      sendJson(403, { ok: false, error: "license_admin_unauthorized" });
      return;
    }
    const chunks = [];
    req.on("data", (d) => chunks.push(d));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8") || "{}";
        const body = JSON.parse(raw);
        const plan = String(body.plan || "pro").toLowerCase();
        const days = Number(body.days || 0);
        const exp = body.exp
          ? Number(body.exp)
          : days > 0
            ? Math.floor(Date.now() / 1000) + Math.floor(days * 86400)
            : undefined;
        const payload = {
          plan,
          sub: body.email || body.userId || undefined,
          iat: Math.floor(Date.now() / 1000),
          exp,
          meta: body.meta || undefined,
        };
        const key = signPayload(payload);
        sendJson(200, { ok: true, key, plan, exp });
      } catch (e) {
        sendJson(500, {
          ok: false,
          error: "license_issue_exception",
          details: e?.message || "unknown",
        });
      }
    });
    return;
  }

  if (pathname === "/ai/health") {
    if (!GEMINI_API_KEY) {
      sendJson(503, { ok: false, error: "missing_gemini_api_key" });
      return;
    }
    sendJson(200, { ok: true, service: "aether-ai", ts: new Date().toISOString() });
    return;
  }

  if (pathname === "/ai/chat" || pathname === "/ai/image") {
    if (!GEMINI_API_KEY) {
      sendJson(500, { error: "missing_gemini_api_key" });
      return;
    }

    const chunks = [];
    req.on("data", (d) => chunks.push(d));
    req.on("end", async () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8") || "{}";
        const body = JSON.parse(raw);
        const prompt = (body.prompt || "").toString().trim();
        const query = (body.query || "").toString().trim();

        let GoogleGenAI;
        try {
          ({ GoogleGenAI } = await loadGoogleGenAi());
        } catch (err) {
          sendJson(500, {
            error: "genai_not_installed",
            details: err?.message || "missing_dependency",
          });
          return;
        }

        const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

        if (pathname === "/ai/image") {
          if (!prompt) {
            sendJson(400, { error: "missing_prompt" });
            return;
          }

          const response = await ai.models.generateContent({
            model: "gemini-3-pro-image-preview",
            contents: {
              parts: [
                {
                  text: `A professional, high-quality digital streaming background, cinematic lighting, ${prompt}`,
                },
              ],
            },
            config: {
              imageConfig: {
                aspectRatio: "16:9",
                imageSize: "1K",
              },
            },
          });

          let image = null;
          for (const part of response.candidates?.[0]?.content?.parts || []) {
            if (part.inlineData?.data) {
              image = `data:image/png;base64,${part.inlineData.data}`;
              break;
            }
          }

          sendJson(200, { image });
          return;
        }

        if (pathname === "/ai/chat") {
          if (!query) {
            sendJson(400, { error: "missing_query" });
            return;
          }

          const response = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: query,
            config: {
              systemInstruction:
                "You are Aether, an expert AI broadcast engineer. Help the user with technical streaming advice, script ideas, or chat engagement tips. Keep answers concise and actionable.",
            },
          });

          sendJson(200, { text: response.text || "" });
          return;
        }
      } catch (e) {
        sendJson(500, { error: "ai_exception", details: e?.message || "unknown" });
      }
    });
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain", "Access-Control-Allow-Origin": "*" });
  res.end("not found");
});

// Allow WS on both "/" and "/ws".
const wss = new WebSocketServer({ server, path: undefined });

wss.on("connection", (ws, req) => {
  const { pathname } = url.parse(req.url || "/");
  const clientIp =
    req.headers["x-forwarded-for"]?.toString().split(",")[0]?.trim() || req.socket.remoteAddress;

  if (pathname !== "/" && pathname !== "/ws") {
    ws.close(1008, "Invalid WS path");
    return;
  }

  let ffmpeg = null;
  let streaming = false;
  let wantStreaming = false;
  let restartTimer = null;
  let restartAttempts = 0;
  let authed = RELAY_TOKEN ? false : true;
  let currentTargets = [];
  let fallbackTarget = "";
  let lastStartMs = 0;
  let lastErrSentMs = 0;
  let clientRole = "unknown";
  let clientSessionId = "";

  let ingestQueue = [];
  let ingestQueueBytes = 0;
  let queueSoftSent = false;
  let stdinBackpressured = false;
  const degradedTargets = new Set();
  let waitingForFirstChunk = false;
  let firstChunkTimer = null;
  let sessionIngestBytes = 0;
  let sessionIngestChunks = 0;

  const pingTimer = setInterval(() => {
    safeSendWs(ws, { type: "ping", t: Date.now() });
  }, 15000);

  const clearRestartTimer = () => {
    if (restartTimer) {
      clearTimeout(restartTimer);
      restartTimer = null;
    }
  };

  const clearFirstChunkTimer = () => {
    if (firstChunkTimer) {
      clearTimeout(firstChunkTimer);
      firstChunkTimer = null;
    }
  };

  const emitDestinationStatus = (target, status, reason) => {
    safeSendWs(ws, {
      type: "destination_status",
      target: redactRtmpTarget(target),
      status,
      reason: reason || null,
      ts: new Date().toISOString(),
    });
  };

  const emitRelayCongestion = (level, queuedBytes) => {
    safeSendWs(ws, {
      type: "relay_congestion",
      level,
      queuedBytes,
      softThresholdBytes: SOFT_QUEUE_BYTES,
      hardThresholdBytes: HARD_QUEUE_BYTES,
      ts: Date.now(),
    });
    logEvent("relay.congestion", { ip: clientIp, level, queuedBytes });
  };

  const resetIngestQueue = () => {
    ingestQueue = [];
    ingestQueueBytes = 0;
    queueSoftSent = false;
    stdinBackpressured = false;
  };

  const updateStreamHealthMetrics = () => {
    relayRuntime.restartAttempts = restartAttempts;
    relayRuntime.lastDestinationCount = currentTargets.length;
    touchRuntime();
  };

  const stopFfmpeg = (reason = "stop", opts = {}) => {
    const shouldResetAttempts =
      opts.resetAttempts === true || reason === "stop-stream" || reason === "ws_close";
    const hadActiveProcess = !!ffmpeg || streaming;

    clearRestartTimer();
    clearFirstChunkTimer();
    waitingForFirstChunk = false;
    wantStreaming = false;
    if (shouldResetAttempts) {
      restartAttempts = 0;
    }
    updateStreamHealthMetrics();
    if (!hadActiveProcess) {
      if (opts.fatalReason) {
        const fatalPayload = {
          type: "relay_fatal",
          reason: opts.fatalReason,
          ...(opts.fatalMeta || {}),
        };
        setLastError(opts.fatalReason);
        safeSendWs(ws, fatalPayload);
      }
      return;
    }

    resetIngestQueue();
    degradedTargets.clear();

    if (ffmpeg) {
      try {
        ffmpeg.stdin.removeAllListeners("drain");
      } catch {}
      try {
        ffmpeg.stdin.end();
      } catch {}
      try {
        ffmpeg.kill("SIGINT");
      } catch {}
      ffmpeg = null;
    }

    if (streaming) {
      streaming = false;
      relayRuntime.activeStreams = Math.max(0, relayRuntime.activeStreams - 1);
      relayRuntime.lastFfmpegPid = null;
      touchRuntime();
    }

    if (currentTargets.length > 0) {
      currentTargets.forEach((target) => emitDestinationStatus(target, "down", reason));
    }

    safeSendWs(ws, { type: "stopped", reason });
    if (opts.fatalReason) {
      const fatalPayload = {
        type: "relay_fatal",
        reason: opts.fatalReason,
        ...(opts.fatalMeta || {}),
      };
      setLastError(opts.fatalReason);
      safeSendWs(ws, fatalPayload);
    }
  };

  const flushIngestQueue = () => {
    if (!ffmpeg || !ffmpeg.stdin || !ffmpeg.stdin.writable) return;
    while (ingestQueue.length > 0) {
      const chunk = ingestQueue[0];
      const ok = ffmpeg.stdin.write(chunk);
      ingestQueue.shift();
      ingestQueueBytes = Math.max(0, ingestQueueBytes - chunk.length);
      if (!ok) {
        stdinBackpressured = true;
        return;
      }
    }
    stdinBackpressured = false;
    if (queueSoftSent && ingestQueueBytes < Math.floor(SOFT_QUEUE_BYTES / 2)) {
      queueSoftSent = false;
      safeSendWs(ws, {
        type: "relay_congestion",
        level: "recovered",
        queuedBytes: ingestQueueBytes,
        ts: Date.now(),
      });
    }
  };

  const enqueueBinaryChunk = (chunk) => {
    ingestQueue.push(chunk);
    ingestQueueBytes += chunk.length;

    const level = queueCongestionLevel(ingestQueueBytes, SOFT_QUEUE_BYTES, HARD_QUEUE_BYTES);
    if (level === "soft" && !queueSoftSent) {
      queueSoftSent = true;
      emitRelayCongestion("soft", ingestQueueBytes);
    }
    if (level === "hard") {
      emitRelayCongestion("hard", ingestQueueBytes);
      stopFfmpeg("relay_hard_congestion", { fatalReason: "relay_hard_congestion" });
      return false;
    }
    return true;
  };

  const scheduleRestart = (closeCode) => {
    const runtimeMs = Date.now() - lastStartMs;
    const diedQuick = runtimeMs < 8000;

    relayRuntime.lastCloseCode = closeCode ?? null;
    touchRuntime();

    if (runtimeMs >= RELAY_SOAK_RESET_MS) {
      restartAttempts = 0;
    }

    if (
      diedQuick &&
      fallbackTarget &&
      currentTargets.length === 1 &&
      currentTargets[0].toLowerCase() !== fallbackTarget.toLowerCase()
    ) {
      currentTargets = [fallbackTarget];
      restartAttempts = 0;
      safeSendWs(ws, { type: "rtmp_fallback", target: redactRtmpTarget(fallbackTarget) });
      logEvent("relay.fallback", { ip: clientIp, target: redactRtmpTarget(fallbackTarget) });
    }

    if (restartAttempts >= MAX_RESTART_ATTEMPTS) {
      wantStreaming = false;
      const reason = "max_restart_exceeded";
      setLastError(reason);
      safeSendWs(ws, { type: "relay_fatal", reason, attempts: restartAttempts });
      logEvent("relay.fatal", { ip: clientIp, reason, attempts: restartAttempts });
      return;
    }

    const delayMs = nextRestartDelayMs(
      restartAttempts,
      RESTART_BASE_DELAY_MS,
      RESTART_MAX_DELAY_MS
    );
    restartAttempts += 1;
    relayRuntime.totalRestarts += 1;
    updateStreamHealthMetrics();

    restartTimer = setTimeout(() => {
      startFfmpeg("restart");
    }, delayMs);

    safeSendWs(ws, {
      type: "ffmpeg_restarting",
      attempt: restartAttempts,
      delayMs,
    });
  };

  const startFfmpeg = (mode = "initial") => {
    clearRestartTimer();
    clearFirstChunkTimer();
    resetIngestQueue();
    degradedTargets.clear();
    waitingForFirstChunk = true;
    sessionIngestBytes = 0;
    sessionIngestChunks = 0;

    const ffmpegBin = fs.existsSync(FFMPEG_PATH) ? FFMPEG_PATH : "ffmpeg";
    const args = buildFfmpegArgs({
      outputs: currentTargets,
      width: 1280,
      height: 720,
      fps: 30,
      vBitrateKbps: 2500,
      aBitrateKbps: 128,
      preset: "ultrafast",
    });

    lastStartMs = Date.now();
    relayRuntime.lastStartAt = new Date(lastStartMs).toISOString();
    ffmpeg = spawn(ffmpegBin, args, { stdio: ["pipe", "ignore", "pipe"] });
    streaming = true;
    relayRuntime.activeStreams += 1;
    relayRuntime.totalStarts += 1;
    relayRuntime.lastFfmpegPid = ffmpeg.pid || null;
    updateStreamHealthMetrics();

    safeSendWs(ws, {
      type: "ffmpeg_start",
      mode,
      destinations: currentTargets.map((target) => redactRtmpTarget(target)),
    });

    currentTargets.forEach((target) => emitDestinationStatus(target, "starting", "ffmpeg_starting"));
    setTimeout(() => {
      if (!ffmpeg || !streaming) return;
      currentTargets.forEach((target) => emitDestinationStatus(target, "up", "active"));
    }, 1200);

    logEvent("ffmpeg.start", {
      ip: clientIp,
      mode,
      pid: ffmpeg.pid || null,
      destinations: currentTargets.map((target) => redactRtmpTarget(target)),
    });

    ffmpeg.stdin.on("drain", () => {
      stdinBackpressured = false;
      flushIngestQueue();
    });

    firstChunkTimer = setTimeout(() => {
      if (!streaming || !waitingForFirstChunk) return;
      const fatalReason = "no_input_data_from_encoder";
      logEvent("relay.no_input_timeout", {
        ip: clientIp,
        timeoutMs: INPUT_CHUNK_TIMEOUT_MS,
        fatalReason,
        sessionId: clientSessionId || null,
      });
      stopFfmpeg(fatalReason, {
        fatalReason,
        fatalMeta: {
          timeoutMs: INPUT_CHUNK_TIMEOUT_MS,
          sessionId: clientSessionId || null,
        },
      });
    }, INPUT_CHUNK_TIMEOUT_MS);

    ffmpeg.stdin.on("error", (err) => {
      setLastError(err?.message || "stdin_error");
      logEvent("ffmpeg.stdin_error", { ip: clientIp, error: err?.message || "stdin_error" });
    });

    ffmpeg.on("error", (err) => {
      setLastError(err?.message || "spawn_error");
      safeSendWs(ws, { type: "ffmpeg_error", message: (err?.message || "spawn_error").slice(0, 220) });
      logEvent("ffmpeg.spawn_error", { ip: clientIp, error: err?.message || "spawn_error" });
    });

    ffmpeg.stderr.on("data", (chunk) => {
      const lines = String(chunk || "")
        .split(/\r?\n/g)
        .map((line) => line.trim())
        .filter(Boolean);
      for (const line of lines) {
        if (/slave muxer/i.test(line) && /failed/i.test(line)) {
          const slaveMatch = line.match(/Slave '([^']+)'/i);
          let rawTarget = "";
          if (slaveMatch?.[1]) {
            const withOpts = String(slaveMatch[1]).trim();
            const lastBracket = withOpts.lastIndexOf("]");
            rawTarget = lastBracket >= 0 ? withOpts.slice(lastBracket + 1) : withOpts;
          }
          const redactedTarget = rawTarget ? redactRtmpTarget(rawTarget) : "unknown";
          if (!degradedTargets.has(redactedTarget)) {
            degradedTargets.add(redactedTarget);
            safeSendWs(ws, {
              type: "destination_status",
              target: redactedTarget,
              status: "degraded",
              reason: "destination_write_failed",
              detail: line.slice(0, 220),
            });
          }
        }
        if (/all tee outputs failed/i.test(line)) {
          stopFfmpeg("all_destinations_failed", { fatalReason: "all_destinations_failed" });
          break;
        }
        if (/error|failed|invalid|timed out|refused|broken pipe|connection reset/i.test(line)) {
          setLastError(line);
          const now = Date.now();
          if (now - lastErrSentMs > 800) {
            lastErrSentMs = now;
            safeSendWs(ws, { type: "ffmpeg_error", message: line.slice(0, 220) });
          }
          logEvent("ffmpeg.stderr", { ip: clientIp, message: line.slice(0, 220) });
        }
      }
    });

    ffmpeg.on("close", (code, signal) => {
      clearFirstChunkTimer();
      waitingForFirstChunk = false;
      ffmpeg = null;
      if (streaming) {
        streaming = false;
        relayRuntime.activeStreams = Math.max(0, relayRuntime.activeStreams - 1);
      }
      relayRuntime.lastFfmpegPid = null;
      relayRuntime.lastCloseCode = code ?? null;
      touchRuntime();

      logEvent("ffmpeg.closed", {
        ip: clientIp,
        code: code ?? null,
        signal: signal || null,
        ingestBytes: sessionIngestBytes,
        ingestChunks: sessionIngestChunks,
      });

      safeSendWs(ws, { type: "ffmpeg_closed", code, signal });
      currentTargets.forEach((target) => emitDestinationStatus(target, "down", `ffmpeg_closed_${code}`));

      if (!wantStreaming || ws.readyState !== ws.OPEN) return;
      scheduleRestart(code);
    });
  };

  const handleStartStream = (msg) => {
    const requestedDestinations = Array.isArray(msg?.destinations) ? msg.destinations.length : 0;
    const cleanKey = String(msg?.streamKey || "").trim();
    relayRuntime.startRequests += 1;
    relayRuntime.lastStartRequestAt = new Date().toISOString();
    touchRuntime();
    logEvent("start_stream.request", {
      ip: clientIp,
      role: clientRole,
      sessionId: clientSessionId || null,
      hasKey: !!cleanKey,
      requestedDestinations,
    });

    if (!authed) {
      safeSendWs(ws, { type: "error", error: "unauthorized" });
      relayRuntime.startRejected += 1;
      relayRuntime.lastStartRejectReason = "unauthorized";
      touchRuntime();
      logEvent("start_stream.rejected", { ip: clientIp, reason: "unauthorized" });
      return;
    }
    if (clientRole === "host" && clientSessionId) {
      const activeHost = activeHostBySession.get(clientSessionId);
      if (activeHost && activeHost !== ws) {
        safeSendWs(ws, { type: "error", error: "not_active_host" });
        relayRuntime.startRejected += 1;
        relayRuntime.lastStartRejectReason = "not_active_host";
        touchRuntime();
        logEvent("start_stream.rejected", {
          ip: clientIp,
          reason: "not_active_host",
          sessionId: clientSessionId,
        });
        return;
      }
    }
    if (!cleanKey) {
      safeSendWs(ws, { type: "error", error: "missing_stream_key" });
      relayRuntime.startRejected += 1;
      relayRuntime.lastStartRejectReason = "missing_stream_key";
      touchRuntime();
      logEvent("start_stream.rejected", { ip: clientIp, reason: "missing_stream_key" });
      return;
    }
    if (streaming) {
      safeSendWs(ws, { type: "info", text: "already_streaming" });
      relayRuntime.startRejected += 1;
      relayRuntime.lastStartRejectReason = "already_streaming";
      touchRuntime();
      logEvent("start_stream.rejected", { ip: clientIp, reason: "already_streaming" });
      return;
    }

    currentTargets = normalizeDestinations({
      streamKey: cleanKey,
      destinations: msg.destinations,
      primaryBase: RTMP_URL_PRIMARY,
      maxDestinations: MAX_DESTINATIONS,
    });

    if (currentTargets.length === 0) {
      safeSendWs(ws, { type: "error", error: "no_valid_destinations" });
      relayRuntime.startRejected += 1;
      relayRuntime.lastStartRejectReason = "no_valid_destinations";
      touchRuntime();
      logEvent("start_stream.rejected", { ip: clientIp, reason: "no_valid_destinations" });
      return;
    }

    fallbackTarget = "";
    const hasExtraTargets = currentTargets.length > 1;
    if (!isRtmpUrl(cleanKey) && !hasExtraTargets) {
      const fallback = buildRtmpUrl(RTMP_URL_FALLBACK, cleanKey);
      if (fallback.toLowerCase() !== currentTargets[0].toLowerCase()) {
        fallbackTarget = fallback;
      }
    }

    wantStreaming = true;
    relayRuntime.startAccepted += 1;
    relayRuntime.lastStartRejectReason = null;
    touchRuntime();
    restartAttempts = 0;
    updateStreamHealthMetrics();
    startFfmpeg("initial");
    safeSendWs(ws, {
      type: "started",
      destinationCount: currentTargets.length,
      destinations: currentTargets.map((target) => redactRtmpTarget(target)),
    });
  };

  const handleBinaryStreamChunk = (data) => {
    if (clientRole === "host" && clientSessionId) {
      const activeHost = activeHostBySession.get(clientSessionId);
      if (activeHost && activeHost !== ws) {
        incrementRuntimeMetric("ingestIgnoredNotActiveHost");
        return;
      }
    }
    if (!streaming) {
      incrementRuntimeMetric("ingestIgnoredNoStream");
      return;
    }
    if (!ffmpeg || !ffmpeg.stdin || !ffmpeg.stdin.writable) {
      incrementRuntimeMetric("ingestIgnoredNoFfmpeg");
      return;
    }
    const chunk = Buffer.isBuffer(data) ? data : Buffer.from(data);
    if (!chunk || chunk.length === 0) return;

    if (waitingForFirstChunk) {
      waitingForFirstChunk = false;
      clearFirstChunkTimer();
    }

    sessionIngestBytes += chunk.length;
    sessionIngestChunks += 1;
    relayRuntime.ingestBytesTotal += chunk.length;
    relayRuntime.ingestChunksTotal += 1;
    relayRuntime.lastChunkAt = new Date().toISOString();
    touchRuntime();

    if (sessionIngestChunks === 1) {
      relayRuntime.lastFirstChunkAt = new Date().toISOString();
      relayRuntime.lastFirstChunkDelayMs = lastStartMs > 0 ? Math.max(0, Date.now() - lastStartMs) : null;
      touchRuntime();
      logEvent("relay.ingest_started", {
        ip: clientIp,
        firstChunkBytes: chunk.length,
        firstChunkDelayMs: relayRuntime.lastFirstChunkDelayMs,
        sessionId: clientSessionId || null,
      });
    }

    if (stdinBackpressured || ingestQueue.length > 0) {
      if (!enqueueBinaryChunk(chunk)) return;
      flushIngestQueue();
      return;
    }

    const ok = ffmpeg.stdin.write(chunk);
    if (!ok) {
      stdinBackpressured = true;
    }
  };

  ws.on("message", (data, isBinary) => {
    try {
      if (!isBinary) {
        const txt = data.toString();
        let msg = {};
        try {
          msg = JSON.parse(txt);
        } catch {
          safeSendWs(ws, { type: "error", error: "bad_json" });
          return;
        }

        if (RELAY_TOKEN) {
          const providedToken = typeof msg.token === "string" ? msg.token : "";
          if (!authed) {
            if (!providedToken || providedToken !== RELAY_TOKEN) {
              safeSendWs(ws, { type: "error", error: "unauthorized" });
              ws.close(1008, "unauthorized");
              return;
            }
            authed = true;
          } else if (providedToken && providedToken !== RELAY_TOKEN) {
            safeSendWs(ws, { type: "error", error: "unauthorized" });
            ws.close(1008, "unauthorized");
            return;
          }
        }

        if (msg.type === "join") {
          clientRole = String(msg.role || "unknown");
          clientSessionId = String(msg.sessionId || "").trim();

          if (clientRole === "host" && clientSessionId) {
            const existing = activeHostBySession.get(clientSessionId);
            if (existing && existing !== ws && existing.readyState === existing.OPEN) {
              safeSendWs(existing, {
                type: "info",
                text: "relay_control_passed_to_newer_host",
              });
            }
            activeHostBySession.set(clientSessionId, ws);
          }

          safeSendWs(ws, {
            type: "connected",
            role: clientRole,
            sessionId: clientSessionId || null,
          });
          logEvent("ws.connected", {
            ip: clientIp,
            role: clientRole,
            sessionId: clientSessionId || null,
          });
          return;
        }

        if (msg.type === "ping") {
          safeSendWs(ws, { type: "pong", t: Date.now(), echo: msg.t || null });
          return;
        }

        if (msg.type === "start-stream") {
          handleStartStream(msg);
          return;
        }

        if (msg.type === "stop-stream") {
          if (clientRole === "host" && clientSessionId) {
            const activeHost = activeHostBySession.get(clientSessionId);
            if (activeHost && activeHost !== ws) {
              safeSendWs(ws, { type: "error", error: "not_active_host" });
              return;
            }
          }
          stopFfmpeg("stop-stream");
          safeSendWs(ws, { type: "stopping" });
          return;
        }

        return;
      }

      handleBinaryStreamChunk(data);
    } catch {
      safeSendWs(ws, { type: "error", error: "relay_exception" });
    }
  });

  ws.on("close", (code, reason) => {
    clearInterval(pingTimer);
    stopFfmpeg("ws_close");
    if (clientRole === "host" && clientSessionId) {
      const existing = activeHostBySession.get(clientSessionId);
      if (existing === ws) {
        activeHostBySession.delete(clientSessionId);
      }
    }
    logEvent("ws.closed", {
      ip: clientIp,
      role: clientRole,
      sessionId: clientSessionId || null,
      code,
      reason: String(reason || "").slice(0, 120),
    });
  });

  ws.on("error", (err) => {
    logEvent("ws.error", { ip: clientIp, error: err?.message || "unknown_ws_error" });
  });
});

if (require.main === module) {
  server.listen(PORT, "0.0.0.0", () => {
    logEvent("relay.listen", {
      port: PORT,
      ffmpegPath: FFMPEG_PATH,
      maxDestinations: MAX_DESTINATIONS,
      softQueueBytes: SOFT_QUEUE_BYTES,
      hardQueueBytes: HARD_QUEUE_BYTES,
      inputChunkTimeoutMs: INPUT_CHUNK_TIMEOUT_MS,
    });
  });
}

module.exports = {
  server,
};
