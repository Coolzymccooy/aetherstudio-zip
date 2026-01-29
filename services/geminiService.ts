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
