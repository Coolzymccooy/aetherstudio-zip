// aether-peer/server.js (CommonJS)
const http = require("http");
const express = require("express");
const cors = require("cors");
const { ExpressPeerServer } = require("peer");

const app = express();

const PORT = Number(process.env.PORT || 9000);
const PEER_PATH = process.env.PEER_PATH || "/peerjs";

// CORS (LAN/dev)
app.use(
  cors({
    origin: true,
    credentials: true,
  })
);

// Health
app.get("/health", (_, res) =>
  res.status(200).json({
    ok: true,
    service: "aether-peer",
    peerPath: PEER_PATH,
    uptimeSec: Math.round(process.uptime()),
    ts: new Date().toISOString(),
  })
);

const server = http.createServer(app);

/**
 * ✅ Stable config:
 * - Peer server internally serves under /peerjs (PEER_PATH)
 * - Mount once at "/" so /peerjs/id exists for sure
 * - proxied=false for LAN
 */
const peerServer = ExpressPeerServer(server, {
  path: PEER_PATH,         // ✅ internal peer path
  allow_discovery: true,
  proxied: false,          // ✅ LAN/local
  debug: true,
});

// ✅ Mount once at root
app.use("/", peerServer);

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[aether-peer] listening on :${PORT}`);
  console.log(`[aether-peer] mount=${PEER_PATH} internal=/`);
});

