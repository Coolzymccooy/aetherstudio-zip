import express from "express";
import { ExpressPeerServer } from "peer";

const app = express();
const port = process.env.PORT || 10000;

// health
app.get("/health", (_, res) => res.status(200).send("ok"));

// PeerJS server mounted at /peerjs
const peerServer = ExpressPeerServer(app.listen(port, () => {
  console.log("Peer server listening on :", port);
}), {
  path: "/peerjs",
  allow_discovery: true
});

app.use("/peerjs", peerServer);
