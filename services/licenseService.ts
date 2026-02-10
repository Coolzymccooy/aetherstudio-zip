const getLicenseBaseUrl = () => {
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

export type LicenseCheckResult = {
  ok: boolean;
  pro: boolean;
  message?: string;
  source?: "server" | "offline";
};

export type LicenseIssueResult = {
  ok: boolean;
  key?: string;
  exp?: number;
  message?: string;
};

export const verifyLicenseKey = async (key: string): Promise<LicenseCheckResult> => {
  const base = getLicenseBaseUrl();
  if (!base) {
    return { ok: false, pro: false, message: "license_base_unconfigured", source: "offline" };
  }

  try {
    const res = await fetchWithTimeout(
      `${base}/license/verify`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key }),
      },
      1800
    );
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        ok: false,
        pro: false,
        message: body?.error || body?.message || `license_error_${res.status}`,
        source: "server",
      };
    }
    return {
      ok: !!body?.ok,
      pro: !!body?.pro,
      message: body?.message,
      source: "server",
    };
  } catch (err) {
    return {
      ok: false,
      pro: false,
      message: "license_server_unreachable",
      source: "offline",
    };
  }
};

export const issueLicenseKey = async (params: {
  token: string;
  email?: string;
  days?: number;
  plan?: "pro" | string;
}): Promise<LicenseIssueResult> => {
  const base = getLicenseBaseUrl();
  if (!base) {
    return { ok: false, message: "license_base_unconfigured" };
  }
  if (!params.token) {
    return { ok: false, message: "missing_admin_token" };
  }

  try {
    const res = await fetchWithTimeout(
      `${base}/license/issue`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-admin-token": params.token,
        },
        body: JSON.stringify({
          email: params.email,
          days: params.days,
          plan: params.plan || "pro",
        }),
      },
      2500
    );
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, message: body?.error || body?.message || `license_issue_error_${res.status}` };
    }
    return { ok: true, key: body?.key, exp: body?.exp };
  } catch (err) {
    return { ok: false, message: "license_issue_failed" };
  }
};
