// Deprecated compatibility shim.
// The active relay is now aether-relay/server.js for both local and production.

const { server } = require("../aether-relay/server.js");

const PORT = Number(process.env.PORT || 8080);

console.warn(
  "[deprecated] server/signaling.cjs is deprecated. Use `node aether-relay/server.js`."
);

if (server.listening) {
  console.log(`[compat] relay already listening on :${PORT}`);
} else {
  server.listen(PORT, "0.0.0.0", () => {
    console.log(`[compat] forwarding to aether-relay on :${PORT}`);
  });
}
