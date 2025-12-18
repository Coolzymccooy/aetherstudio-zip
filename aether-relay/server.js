const http = require("http");
const { WebSocketServer } = require("ws");
const { spawn } = require("child_process");

const PORT = process.env.PORT || 8080;

// Optional simple auth token (recommended)
const RELAY_TOKEN = process.env.RELAY_TOKEN || "";

// Where to push (YouTube ingest)
function buildRtmpUrl(streamKey) {
  // YouTube supports RTMPS ingest:
  // rtmps://a.rtmps.youtube.com:443/live2/<STREAM_KEY>
  return `rtmps://a.rtmps.youtube.com:443/live2/${streamKey}`;
}

const server = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200);
    res.end("ok");
    return;
  }
  res.writeHead(404);
  res.end("not found");
});

const wss = new WebSocketServer({ server });

wss.on("connection", (ws, req) => {
  let ffmpeg = null;
  let streaming = false;

  // Basic origin logging (optional)
  // console.log("WS connected from origin:", req.headers.origin);

  ws.on("message", (data, isBinary) => {
    try {
      if (!isBinary) {
        const msg = JSON.parse(data.toString());

        // Optional token auth
        if (RELAY_TOKEN && msg.token !== RELAY_TOKEN) {
          ws.send(JSON.stringify({ type: "error", error: "unauthorized" }));
          ws.close();
          return;
        }

        if (msg.type === "start-stream") {
          if (!msg.streamKey) {
            ws.send(JSON.stringify({ type: "error", error: "missing_stream_key" }));
            return;
          }
          if (streaming) {
            ws.send(JSON.stringify({ type: "info", text: "already_streaming" }));
            return;
          }

          const rtmpUrl = buildRtmpUrl(msg.streamKey);

          // Start FFmpeg: input is WebM chunks over stdin, output RTMPS
          ffmpeg = spawn("ffmpeg", [
            "-loglevel", "warning",
            "-i", "pipe:0",

            // Video
           "-c:v", "libx264",
           "-preset", "veryfast",
           "-tune", "zerolatency",
           "-pix_fmt", "yuv420p",
           "-r", "30",
           "-g", "60",
           "-keyint_min", "60",

// Stable bitrate (good baseline for 720p/1080p)
"-b:v", "4500k",
"-maxrate", "4500k",
"-bufsize", "9000k",

"-c:a", "aac",
"-b:a", "160k",
"-ar", "44100",



            // Audio
            "-c:a", "aac",
            "-b:a", "160k",
            "-ar", "48000",

            // Output
            "-f", "flv",
            rtmpUrl
          ], { stdio: ["pipe", "ignore", "pipe"] });

          streaming = true;

          ffmpeg.stderr.on("data", (chunk) => {
            // send limited info to client (don’t spam)
            // console.log("[ffmpeg]", chunk.toString());
          });

          ffmpeg.on("close", (code) => {
            streaming = false;
            ffmpeg = null;
            try {
              ws.send(JSON.stringify({ type: "stopped", code }));
            } catch {}
          });

          ws.send(JSON.stringify({ type: "started" }));
          return;
        }

        if (msg.type === "stop-stream") {
          if (ffmpeg) {
            try { ffmpeg.stdin.end(); } catch {}
            try { ffmpeg.kill("SIGINT"); } catch {}
          }
          streaming = false;
          ws.send(JSON.stringify({ type: "stopping" }));
          return;
        }

        if (msg.type === "ping") {
          ws.send(JSON.stringify({ type: "pong", t: Date.now() }));
          return;
        }

        return;
      }

      // Binary video chunks
      if (!streaming || !ffmpeg) return;
      if (!ffmpeg.stdin.writable) return;

      ffmpeg.stdin.write(data);
    } catch (e) {
      try {
        ws.send(JSON.stringify({ type: "error", error: "bad_message" }));
      } catch {}
    }
  });

  ws.on("close", () => {
    if (ffmpeg) {
      try { ffmpeg.stdin.end(); } catch {}
      try { ffmpeg.kill("SIGINT"); } catch {}
    }
  });
});

server.listen(PORT, () => {
  console.log(`Relay listening on :${PORT}`);
  console.log("WS client connected");
  console.log("start-stream received", { hasKey: !!(msg && msg.streamKey) });
  console.log("ffmpeg started");


});
