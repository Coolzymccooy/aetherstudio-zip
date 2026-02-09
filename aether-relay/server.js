// aether-relay/server.js (CommonJS)
const http = require("http");
const { WebSocketServer } = require("ws");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const url = require("url");
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
const RELAY_TOKEN = process.env.RELAY_TOKEN || ""; // optional
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const DEFAULT_FFMPEG_WIN = path.join(__dirname, "..", "tools", "ffmpeg", "ffmpeg-8.0.1-essentials_build", "bin", "ffmpeg.exe");
const DEFAULT_FFMPEG_NIX = "/usr/bin/ffmpeg";
const resolveFfmpegPath = () => {
  const envPath = (process.env.FFMPEG_PATH || "").trim();
  const platformDefault = process.platform === "win32" ? DEFAULT_FFMPEG_WIN : DEFAULT_FFMPEG_NIX;
  if (envPath && fs.existsSync(envPath)) return envPath;
  if (fs.existsSync(platformDefault)) return platformDefault;
  return envPath || platformDefault;
};
const FFMPEG_PATH = resolveFfmpegPath();
const RELAY_LOG_PATH = process.env.RELAY_LOG_PATH || path.join(__dirname, "..", "tools", "relay-ffmpeg.log");

const RTMP_URL_PRIMARY = process.env.RTMP_URL_PRIMARY || "rtmps://a.rtmp.youtube.com/live2";
const RTMP_URL_FALLBACK = process.env.RTMP_URL_FALLBACK || process.env.RTMP_URL || "rtmp://a.rtmp.youtube.com/live2";

function buildRtmpUrl(base, streamKey) {
  return `${base.replace(/\/$/, "")}/${streamKey}`;
}

const server = http.createServer(async (req, res) => {
  const { pathname } = url.parse(req.url || "/");

  const sendJson = (code, body) => {
    res.writeHead(code, {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    });
    res.end(JSON.stringify(body));
  };

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    });
    res.end();
    return;
  }

  if (pathname === "/health") {
    sendJson(200, { ok: true, service: "aether-relay", ts: new Date().toISOString() });
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
          sendJson(500, { error: "genai_not_installed", details: err?.message || "missing_dependency" });
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
              parts: [{ text: `A professional, high-quality digital streaming background, cinematic lighting, ${prompt}` }],
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

// Allow WS on both "/" and "/ws" (handy for simple env URLs)
const wss = new WebSocketServer({
  server,
  path: undefined, // accept all paths; we’ll validate ourselves
});

wss.on("connection", (ws, req) => {
  const { pathname } = url.parse(req.url || "/");
  const clientIp =
    req.headers["x-forwarded-for"]?.toString().split(",")[0]?.trim() ||
    req.socket.remoteAddress;

  // Only allow "/" or "/ws" (reject noisy other paths)
  if (pathname !== "/" && pathname !== "/ws") {
    ws.close(1008, "Invalid WS path");
    return;
  }

  console.log(`[relay] ws connected ip=${clientIp} path=${pathname}`);

  let ffmpeg = null;
  let streaming = false;
  let wantStreaming = false;
  let lastStreamKey = "";
  let restartTimer = null;
  let rtmpTarget = "primary";
  let lastFfmpegStartMs = 0;
  let lastErrSentMs = 0;
  let authed = RELAY_TOKEN ? false : true;

  // Keepalive ping -> helps proxies/mobile networks
  const pingTimer = setInterval(() => {
    try {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: "ping", t: Date.now() }));
    } catch {}
  }, 15000);

  function stopFfmpeg(reason = "stop") {
    if (!ffmpeg) return;
    try { ffmpeg.stdin.end(); } catch {}
    try { ffmpeg.kill("SIGINT"); } catch {}
    ffmpeg = null;
    streaming = false;
    wantStreaming = false;
    try {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: "stopped", reason }));
    } catch {}
  }

  ws.on("message", (data, isBinary) => {
    try {
      // Control messages (JSON)
      if (!isBinary) {
        const txt = data.toString();
        let msg;
        try {
          msg = JSON.parse(txt);
        } catch {
          ws.send(JSON.stringify({ type: "error", error: "bad_json" }));
          return;
        }

        // Auth (optional)
        if (RELAY_TOKEN) {
          if (!msg.token || msg.token !== RELAY_TOKEN) {
            ws.send(JSON.stringify({ type: "error", error: "unauthorized" }));
            ws.close(1008, "unauthorized");
            return;
          }
          authed = true;
        }

        if (msg.type === "join") {
          ws.send(JSON.stringify({ type: "connected", role: msg.role || "unknown", sessionId: msg.sessionId || null }));
          return;
        }

        if (msg.type === "ping") {
          ws.send(JSON.stringify({ type: "pong", t: Date.now() }));
          return;
        }

        if (msg.type === "start-stream") {
          if (!authed) {
            ws.send(JSON.stringify({ type: "error", error: "unauthorized" }));
            return;
          }
          if (!msg.streamKey) {
            ws.send(JSON.stringify({ type: "error", error: "missing_stream_key" }));
            return;
          }
          if (streaming) {
            ws.send(JSON.stringify({ type: "info", text: "already_streaming" }));
            return;
          }

          wantStreaming = true;
          lastStreamKey = String(msg.streamKey || "").trim();
          rtmpTarget = "primary";

          const ffmpegBin = fs.existsSync(FFMPEG_PATH) ? FFMPEG_PATH : "ffmpeg";
          const spawnFfmpeg = () => {
            if (restartTimer) {
              clearTimeout(restartTimer);
              restartTimer = null;
            }
            const base = rtmpTarget === "primary" ? RTMP_URL_PRIMARY : RTMP_URL_FALLBACK;
            const rtmp = buildRtmpUrl(base, lastStreamKey);
            lastFfmpegStartMs = Date.now();
            ffmpeg = spawn(
              ffmpegBin,
              [
              "-loglevel", "warning",
              
              // INPUT
              "-f", "webm",
              "-i", "pipe:0",

              // VIDEO (Optimized for Render Free Tier CPU)
              "-c:v", "libx264",
              "-preset", "ultrafast",
              "-tune", "zerolatency",
              "-profile:v", "high",
              "-level", "4.1",
              "-vf", "scale=1280:720", // Downscale to 720p to save CPU
              "-pix_fmt", "yuv420p",
              "-r", "30",
              "-g", "60",
              "-keyint_min", "60",
              "-sc_threshold", "0",
              "-b:v", "2500k",         // Lower bitrate (2.5Mbps) prevents buffer starvation
              "-maxrate", "2500k",
              "-bufsize", "15000k", // Increased buffer (15Mb) to handle network jitter on weak connections

              // AUDIO
              "-c:a", "aac",
              "-b:a", "128k",
              "-ar", "44100",
              "-af", "aresample=async=1", // Prevent audio timestamp drift

              // OUTPUT
              "-f", "flv",
              rtmp,
              ],
              { stdio: ["pipe", "ignore", "pipe"] }
            );

            streaming = true;
            try { ws.send(JSON.stringify({ type: "ffmpeg_start", target: rtmpTarget, rtmp })); } catch {}

            // LOGGING: Use console instead of file for Render compatibility
            console.log(`[relay] ffmpeg start -> ${rtmp}`);
            
            ffmpeg.stderr.on("data", (chunk) => {
              const line = chunk.toString();
              // Log only errors/warnings to console to avoid noise
              if (/error|failed|invalid|timed out|refused/i.test(line)) {
                 console.error(`[ffmpeg] ${line.trim()}`);
                 
                 const now = Date.now();
                 if (now - lastErrSentMs > 1000) {
                    lastErrSentMs = now;
                    try { ws.send(JSON.stringify({ type: "ffmpeg_error", message: line.trim().slice(0, 220) })); } catch {}
                 }
              }
            });

            ffmpeg.on("close", (code) => {
              streaming = false;
              ffmpeg = null;
              // try { logStream.end(); } catch {} // Removed file stream
              try { ws.send(JSON.stringify({ type: "ffmpeg_closed", code, target: rtmpTarget })); } catch {}
              if (wantStreaming && lastStreamKey && ws.readyState === ws.OPEN) {
                const diedQuick = Date.now() - lastFfmpegStartMs < 8000;
                if (rtmpTarget === "primary" && diedQuick) {
                  rtmpTarget = "fallback";
                  try { ws.send(JSON.stringify({ type: "rtmp_fallback", target: rtmpTarget })); } catch {}
                }
                restartTimer = setTimeout(spawnFfmpeg, 1500);
                try { ws.send(JSON.stringify({ type: "ffmpeg_restarting" })); } catch {}
              }
            });
          };

          spawnFfmpeg();

          ws.send(JSON.stringify({ type: "started" }));
          return;
        }

        if (msg.type === "stop-stream") {
          stopFfmpeg("stop-stream");
          ws.send(JSON.stringify({ type: "stopping" }));
          return;
        }

        // ignore unknown control messages
        return;
      }

      // Binary chunks (MediaRecorder -> webm chunks)
      if (!streaming || !ffmpeg) return;
      if (!ffmpeg.stdin || !ffmpeg.stdin.writable) return;
      ffmpeg.stdin.write(data);
    } catch {
      try { ws.send(JSON.stringify({ type: "error", error: "relay_exception" })); } catch {}
    }
  });

  ws.on("close", (code, reason) => {
    clearInterval(pingTimer);
    stopFfmpeg("ws_close");
    console.log(`[relay] ws closed code=${code} reason=${String(reason || "")}`);
  });

  ws.on("error", (e) => {
    console.log("[relay] ws error:", e?.message || e);
  });
});

server.listen(PORT, "0.0.0.0", () => console.log(`[relay] listening on :${PORT}`));
