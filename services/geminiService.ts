type AiHealthReason =
  | "ok"
  | "missing_base_url"
  | "missing_gemini_api_key"
  | "timeout"
  | "unreachable"
  | "non_ai_backend"
  | "http_error";

export type AiHealthStatus = {
  ok: boolean;
  reason: AiHealthReason;
  baseUrl: string;
  isLocal: boolean;
  status?: number;
  detail?: string;
};

type RuntimeEnv = Record<string, string | undefined>;

const readEnvValue = (key: string) => {
  const testEnv = (globalThis as { __AETHER_TEST_ENV__?: RuntimeEnv }).__AETHER_TEST_ENV__;
  if (testEnv && key in testEnv) return testEnv[key] || "";
  return ((import.meta as ImportMeta & { env?: RuntimeEnv }).env?.[key] as string | undefined) || "";
};

const getAiBaseUrl = () => {
  const isLocal =
    typeof window !== "undefined" &&
    (window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1");

  const rawLocal = readEnvValue("VITE_AI_BASE_URL_LOCAL");
  const rawPublic = readEnvValue("VITE_AI_BASE_URL");
  const rawProd = readEnvValue("VITE_AI_BASE_URL_PROD");
  const isHttps = typeof window !== "undefined" && window.location.protocol === "https:";

  let raw = (isLocal ? rawLocal : rawPublic) || rawPublic;

  // Stay local-first for desktop/dev, but avoid an insecure localhost target on HTTPS tunnels.
  if (isHttps && rawProd && raw.startsWith("http://") && raw.includes("localhost")) {
    raw = rawProd;
  }

  if (raw) return raw.replace(/\/+$/, "");

  const signal = readEnvValue("VITE_SIGNAL_URL");
  if (!signal) return "";
  const httpish = signal.replace(/^ws(s)?:\/\//i, "http$1://");
  return httpish.replace(/\/+$/, "");
};

const isLocalAiBaseUrl = (baseUrl: string) => /\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(baseUrl);

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

const parseResponsePayload = async (res: Response) => {
  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const json = await res.json().catch(() => ({}));
    return {
      detail: String(json?.error || json?.details || json?.message || "").trim(),
      json,
    };
  }

  const text = String(await res.text().catch(() => "")).trim();
  if (!text) return { detail: "", json: null };

  try {
    const json = JSON.parse(text);
    return {
      detail: String(json?.error || json?.details || json?.message || text).trim(),
      json,
    };
  } catch {
    return { detail: text, json: null };
  }
};

const normalizeAiError = (status: number, detail: string): Pick<AiHealthStatus, "reason" | "detail"> => {
  const normalizedDetail = String(detail || "").trim();
  if (normalizedDetail.includes("missing_gemini_api_key")) {
    return { reason: "missing_gemini_api_key", detail: normalizedDetail };
  }
  if (status === 404 || status === 405) {
    return { reason: "non_ai_backend", detail: normalizedDetail || "missing_ai_route" };
  }
  return { reason: "http_error", detail: normalizedDetail || `http_${status}` };
};

export const formatAiHealthMessage = (health: AiHealthStatus) => {
  const hasClientGeminiKey = !!readEnvValue("VITE_GEMINI_API_KEY");
  if (health.ok) {
    return health.isLocal
      ? `Local AI online at ${health.baseUrl}.`
      : `AI online at ${health.baseUrl}.`;
  }

  if (health.reason === "missing_base_url") {
    return "AI base URL is not configured.";
  }
  if (health.reason === "missing_gemini_api_key") {
    return health.isLocal
      ? `Local AI offline: relay server at ${health.baseUrl} is running, but its GEMINI_API_KEY is missing${hasClientGeminiKey ? " even though VITE_GEMINI_API_KEY is set in this app" : ""}.`
      : `AI relay at ${health.baseUrl} is missing GEMINI_API_KEY.`;
  }
  if (health.reason === "timeout") {
    return `AI relay timed out at ${health.baseUrl}.`;
  }
  if (health.reason === "unreachable") {
    return `AI relay is unreachable at ${health.baseUrl}.`;
  }
  if (health.reason === "non_ai_backend") {
    return `Relay responded at ${health.baseUrl}, but AI routes are unavailable there.`;
  }
  return health.detail
    ? `AI request failed: ${health.detail}.`
    : `AI request failed at ${health.baseUrl}.`;
};

export const checkAiAvailability = async (): Promise<AiHealthStatus> => {
  const baseUrl = getAiBaseUrl();
  const isLocal = isLocalAiBaseUrl(baseUrl);
  if (!baseUrl) {
    return { ok: false, reason: "missing_base_url", baseUrl: "", isLocal };
  }

  try {
    const res = await fetchWithTimeout(`${baseUrl}/ai/health`, { method: "GET" }, 1500);
    if (res.ok || res.status === 401 || res.status === 403) {
      return { ok: true, reason: "ok", baseUrl, isLocal, status: res.status };
    }

    const parsed = await parseResponsePayload(res);
    const normalized = normalizeAiError(res.status, parsed.detail);
    if (normalized.reason !== "non_ai_backend") {
      return {
        ok: false,
        baseUrl,
        isLocal,
        status: res.status,
        ...normalized,
      };
    }
  } catch (error: any) {
    if (String(error?.name || "") === "AbortError") {
      return { ok: false, reason: "timeout", baseUrl, isLocal };
    }
  }

  try {
    const res = await fetchWithTimeout(
      `${baseUrl}/ai/chat`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: "ping" }),
      },
      1500
    );

    if (res.ok || res.status === 401 || res.status === 403) {
      return { ok: true, reason: "ok", baseUrl, isLocal, status: res.status };
    }

    const parsed = await parseResponsePayload(res);
    const normalized = normalizeAiError(res.status, parsed.detail);
    return {
      ok: false,
      baseUrl,
      isLocal,
      status: res.status,
      ...normalized,
    };
  } catch (error: any) {
    if (String(error?.name || "") === "AbortError") {
      return { ok: false, reason: "timeout", baseUrl, isLocal };
    }
    return { ok: false, reason: "unreachable", baseUrl, isLocal, detail: String(error?.message || "") || undefined };
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
    const parsed = await parseResponsePayload(res);
    throw new Error(parsed.detail || `AI image error (${res.status})`);
  }

  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const json = await res.json().catch(() => ({}));
    return json?.image || null;
  }

  const text = await res.text().catch(() => "");
  if (!text) return null;
  if (text.trim().startsWith("data:image/")) {
    return text.trim();
  }
  try {
    const json = JSON.parse(text);
    return json?.image || null;
  } catch {
    throw new Error(text || "AI image response invalid");
  }
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
      const parsed = await parseResponsePayload(res);
      return parsed.detail || "Error connecting to AI services. Please check your network.";
    }
    const json = await res.json();
    return json?.text || "I couldn't generate a response.";
  } catch (error) {
    console.error("AI Chat Error:", error);
    return "Error connecting to AI services. Please check your network.";
  }
};
