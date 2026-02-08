// Lightweight local PeerJS signaling server
// Run with: npm run peer

const http = require("http");
const express = require("express");
const { ExpressPeerServer } = require("peer");

const PORT = Number(process.env.PEER_PORT || process.env.PORT || 9000);
const PEER_PATH = process.env.PEER_PATH || "/peerjs";

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

server.listen(PORT, () => {
  console.log(`Aether Local PeerServer running on port ${PORT}`);
  console.log(`PeerJS internal path: ${PEER_PATH} (mounted at /)`);
});
