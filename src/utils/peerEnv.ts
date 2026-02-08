export type PeerEnv = { host: string; port: number; secure: boolean; path: string };

type PeerMode = "cloud" | "custom";

const CLOUD_DEFAULT: PeerEnv = {
  host: "0.peerjs.com",
  port: 443,
  secure: true,
  path: "/peerjs",
};

const storage = {
  mode: "aether_peer_mode",
  host: "aether_peer_host",
  port: "aether_peer_port",
  path: "aether_peer_path",
  secure: "aether_peer_secure",
};

const parseBool = (v: any, fallback: boolean) => {
  if (typeof v !== "string") return fallback;
  const s = v.trim().toLowerCase();
  if (s === "true") return true;
  if (s === "false") return false;
  return fallback;
};

const parseNum = (v: any, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

export function getPeerEnv(): PeerEnv {
  // 1) URL query overrides (for mobile companion links)
  let queryMode: PeerMode | null = null;
  let queryHost: string | null = null;
  let queryPort: string | null = null;
  let queryPath: string | null = null;
  let querySecure: string | null = null;

  try {
    const params = new URLSearchParams(window.location.search);
    queryMode = (params.get("peerMode") as PeerMode | null) || null;
    queryHost = params.get("peerHost");
    queryPort = params.get("peerPort");
    queryPath = params.get("peerPath");
    querySecure = params.get("peerSecure");
  } catch {}

  // 2) LocalStorage (runtime settings)
  const storedMode = (localStorage.getItem(storage.mode) as PeerMode | null) || null;
  const storedHost = localStorage.getItem(storage.host);
  const storedPort = localStorage.getItem(storage.port);
  const storedPath = localStorage.getItem(storage.path);
  const storedSecure = localStorage.getItem(storage.secure);

  // 3) Vite env (build-time defaults)
  const envHost = (import.meta.env.VITE_PEER_HOST as string | undefined) ?? "";
  const envPort = (import.meta.env.VITE_PEER_PORT as string | undefined) ?? "";
  const envPath = (import.meta.env.VITE_PEER_PATH as string | undefined) ?? "";
  const envSecure = (import.meta.env.VITE_PEER_SECURE as string | undefined) ?? "";

  const mode =
    (queryMode || storedMode || (import.meta.env.VITE_PEER_MODE as PeerMode | undefined) || "cloud");

  if (mode === "cloud") {
    return { ...CLOUD_DEFAULT };
  }

  const rawHost =
    (queryHost && queryHost.trim()) ||
    (storedHost && storedHost.trim()) ||
    (envHost && envHost.trim()) ||
    "";
  const host = rawHost.replace(/^https?:\/\//i, "").trim();

  const rawPath =
    (queryPath && queryPath.trim()) ||
    (storedPath && storedPath.trim()) ||
    (envPath && envPath.trim()) ||
    "/peerjs";
  const path = rawPath.startsWith("/") ? rawPath : `/${rawPath}`;

  const isLocalHostTarget =
    host === "" ||
    host === "localhost" ||
    host === "127.0.0.1";

  const secureDefault = isLocalHostTarget ? false : true;
  const secure = parseBool(querySecure || storedSecure || envSecure, secureDefault);

  const fallbackPort = host ? (secure ? 443 : 80) : 9000;
  let port = parseNum(queryPort || storedPort || envPort, fallbackPort);

  // If anything resolves to 10000 locally, silently correct to 9000
  if (isLocalHostTarget && port === 10000) {
    console.warn("[peerEnv] Detected port 10000 for local peer target. Forcing to 9000.", {
      rawHost,
      host,
      rawPort: queryPort || storedPort || envPort,
      secure,
      path,
    });
    port = 9000;
  }

  return { host: host || CLOUD_DEFAULT.host, port, secure, path };
}


