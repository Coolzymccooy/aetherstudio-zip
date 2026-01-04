// aether-peer/server.js (CommonJS)



const http = require("http");
const express = require("express");
const cors = require("cors");
const { ExpressPeerServer } = require("peer");

const app = express();
const PORT = process.env.PORT || 10000;
const PEER_PATH = "/peerjs";

app.use(cors());

// health check
app.get("/health", (_, res) => res.send("ok"));

// create HTTP server FIRST
const server = http.createServer(app);

// attach PeerJS to the server
const peerServer = ExpressPeerServer(server, {
  path: "/",
  allow_discovery: true,
  proxied: true,
  debug: true
});

// mount PeerJS ONCE
app.use(PEER_PATH, peerServer);

// start listening
server.listen(PORT, "0.0.0.0", () => {
  console.log(`[peer] listening on ${PORT} path=${PEER_PATH}`);
});
