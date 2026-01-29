export type PeerEnv = { host: string; port: number; secure: boolean; path: string };

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
  const rawHost = (import.meta.env.VITE_PEER_HOST as string | undefined) ?? "";
  const host = rawHost.replace(/^https?:\/\//i, "").trim();

  const secure = parseBool(import.meta.env.VITE_PEER_SECURE, host ? true : false);

  const fallbackPort = host ? (secure ? 443 : 80) : 9000;
  let port = parseNum(import.meta.env.VITE_PEER_PORT, fallbackPort);

  const rawPath = (import.meta.env.VITE_PEER_PATH as string | undefined) ?? "/peerjs";
  const path = rawPath.startsWith("/") ? rawPath : `/${rawPath}`;

  const isLocalHostTarget =
    host === "" ||
    host === "localhost" ||
    host === "127.0.0.1";

  // If anything resolves to 10000 locally, silently correct to 9000
  if (isLocalHostTarget && port === 10000) {
    console.warn("[peerEnv] Detected port 10000 for local peer target. Forcing to 9000.", {
      rawHost,
      host,
      rawPort: import.meta.env.VITE_PEER_PORT,
      secure,
      path,
    });
    port = 9000;
  }

  return { host: host || "0.peerjs.com", port, secure, path };
}


