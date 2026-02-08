export function getSignalUrl(): string {
  const v = import.meta.env.VITE_SIGNAL_URL as string | undefined;
  if (v && v.trim()) return v.trim();

  const isProd =
    window.location.hostname !== "localhost" &&
    window.location.hostname !== "127.0.0.1";

  // fallback
  return isProd
    ? `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}`
    : "ws://localhost:8080";
}
