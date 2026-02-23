const mobileBase =
  (process.env.AETHER_DESKTOP_MOBILE_BASE_URL || "").trim() || "http://127.0.0.1:5174";

const LOCAL_DEFAULTS = {
  aether_peer_ui_mode: "local",
  aether_peer_mode: "custom",
  aether_peer_host: "127.0.0.1",
  aether_peer_port: "9000",
  aether_peer_path: "/peerjs",
  aether_peer_secure: "false",
  aether_mobile_base_url: mobileBase,
};

function applyLocalDefaults() {
  try {
    for (const [key, value] of Object.entries(LOCAL_DEFAULTS)) {
      window.localStorage.setItem(key, value);
    }
  } catch {}
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", applyLocalDefaults, { once: true });
} else {
  applyLocalDefaults();
}
