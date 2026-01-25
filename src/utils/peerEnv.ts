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

  // Host should be ONLY hostname (no https:// and no trailing slash)
  const host = rawHost
    .replace(/^https?:\/\//i, "")
    .replace(/\/+$/, "")
    .trim();

  const secure = parseBool(import.meta.env.VITE_PEER_SECURE, host ? true : false);

  const port = parseNum(
    import.meta.env.VITE_PEER_PORT,
    host ? (secure ? 443 : 80) : 9000
  );

  // ✅ WARNING only (do NOT crash the UI)
  if (port === 10000) {
    console.warn("⚠️ Unexpected PeerJS port 10000 detected. Check your env config.", {
      rawHost,
      resolvedHost: host,
      port,
      secure,
      VITE_PEER_PORT: import.meta.env.VITE_PEER_PORT,
      VITE_PEER_HOST: import.meta.env.VITE_PEER_HOST,
      VITE_PEER_PATH: import.meta.env.VITE_PEER_PATH,
      VITE_PEER_SECURE: import.meta.env.VITE_PEER_SECURE,
    });
  }

  const rawPath = (import.meta.env.VITE_PEER_PATH as string | undefined) ?? "/peerjs";
  const path = rawPath.startsWith("/") ? rawPath : `/${rawPath}`;

  return { host: host || "0.peerjs.com", port, secure, path };
}

