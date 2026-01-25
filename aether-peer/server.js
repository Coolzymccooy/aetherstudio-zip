// server.js (CommonJS)
const http = require("http");
const express = require("express");
const cors = require("cors");
const { ExpressPeerServer } = require("peer");

const app = express();
app.use(cors());

const PORT = Number(process.env.PORT || 9000);
const PEER_PATH = process.env.PEER_PATH || "/peerjs";

app.get("/health", (_, res) => res.status(200).json({ ok: true, peerPath: PEER_PATH }));

const server = http.createServer(app);

// IMPORTANT: path MUST be "/" when you mount at PEER_PATH
const peerServer = ExpressPeerServer(server, {
  path: "/",                // <- not "/peerjs"
  allow_discovery: true,
  proxied: true,
  debug: true,
});

app.use(PEER_PATH, peerServer);

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[peer] listening on ${PORT} mount=${PEER_PATH} internal=/`);
});
