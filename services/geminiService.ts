const getAiBaseUrl = () => {
  const isLocal =
    typeof window !== "undefined" &&
    (window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1");

  const rawLocal = (import.meta.env.VITE_AI_BASE_URL_LOCAL as string | undefined) || "";
  const rawPublic = (import.meta.env.VITE_AI_BASE_URL as string | undefined) || "";
  const raw = (isLocal ? rawLocal : rawPublic) || rawPublic;

  if (raw) return raw.replace(/\/+$/, "");

  const signal = (import.meta.env.VITE_SIGNAL_URL as string | undefined) || "";
  if (!signal) return "";
  const httpish = signal.replace(/^ws(s)?:\/\//i, "http$1://");
  return httpish.replace(/\/+$/, "");
};

const fetchWithTimeout = async (
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs = 1500
) => {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
};

const statusIndicatesReachable = (status: number) => {
  return status === 401 || status === 403 || (status >= 200 && status < 300);
};

export const checkAiAvailability = async (): Promise<boolean> => {
  const base = getAiBaseUrl();
  if (!base) return false;

  try {
    const res = await fetchWithTimeout(`${base}/ai/health`, { method: "GET" }, 1200);
    if (statusIndicatesReachable(res.status)) return true;
    if (res.status !== 404 && res.status !== 405) return false;
  } catch {
    // fall through to chat probe
  }

  try {
    const res = await fetchWithTimeout(
      `${base}/ai/chat`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: "ping" }),
      },
      1200
    );
    if (statusIndicatesReachable(res.status)) return true;
    return false;
  } catch {
    return false;
  }
};

export const ensureImageGenApiKey = async (): Promise<boolean> => {
  // Keys must stay on the server; client always returns true.
  return true;
};

export const generateStudioBackground = async (prompt: string): Promise<string | null> => {
  const base = getAiBaseUrl();
  if (!base) throw new Error("AI base URL not configured");

  const res = await fetch(`${base}/ai/image`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `AI image error (${res.status})`);
  }

  const json = await res.json();
  return json?.image || null;
};

export const askStudioAssistant = async (query: string): Promise<string> => {
  const base = getAiBaseUrl();
  if (!base) return "AI base URL not configured.";

  try {
    const res = await fetch(`${base}/ai/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return text || "Error connecting to AI services. Please check your network.";
    }
    const json = await res.json();
    return json?.text || "I couldn't generate a response.";
  } catch (error) {
    console.error("AI Chat Error:", error);
    return "Error connecting to AI services. Please check your network.";
  }
};
