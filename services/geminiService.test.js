import test from "node:test";
import assert from "node:assert/strict";
import { checkAiAvailability, formatAiHealthMessage } from "./geminiService.ts";

const originalFetch = globalThis.fetch;
const originalWindow = globalThis.window;
const originalTestEnv = globalThis.__AETHER_TEST_ENV__;

const setLocalEnv = () => {
  globalThis.__AETHER_TEST_ENV__ = {
    VITE_AI_BASE_URL: "http://localhost:8080",
    VITE_AI_BASE_URL_LOCAL: "http://localhost:8080",
    VITE_SIGNAL_URL: "ws://localhost:8080",
    VITE_GEMINI_API_KEY: "client-visible-key",
  };
  globalThis.window = {
    location: {
      hostname: "localhost",
      protocol: "http:",
    },
  };
};

const restoreGlobals = () => {
  globalThis.fetch = originalFetch;
  globalThis.window = originalWindow;
  globalThis.__AETHER_TEST_ENV__ = originalTestEnv;
};

test("ai health reports missing_gemini_api_key from local relay", async () => {
  setLocalEnv();
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ ok: false, error: "missing_gemini_api_key" }), {
      status: 503,
      headers: { "content-type": "application/json" },
    });

  const result = await checkAiAvailability();
  assert.equal(result.ok, false);
  assert.equal(result.reason, "missing_gemini_api_key");
  assert.equal(
    formatAiHealthMessage(result),
    "Local AI offline: relay server at http://localhost:8080 is running, but its GEMINI_API_KEY is missing even though VITE_GEMINI_API_KEY is set in this app."
  );

  restoreGlobals();
});

test("ai health falls back to chat probe when health route is absent", async () => {
  setLocalEnv();
  let callCount = 0;
  globalThis.fetch = async (input) => {
    callCount += 1;
    if (callCount === 1) {
      return new Response("missing", { status: 404 });
    }
    assert.match(String(input), /\/ai\/chat$/);
    return new Response(JSON.stringify({ text: "pong" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const result = await checkAiAvailability();
  assert.equal(result.ok, true);
  assert.equal(result.reason, "ok");

  restoreGlobals();
});

test("ai health reports timeout cleanly", async () => {
  setLocalEnv();
  globalThis.fetch = async () => {
    const error = new Error("timed out");
    error.name = "AbortError";
    throw error;
  };

  const result = await checkAiAvailability();
  assert.equal(result.ok, false);
  assert.equal(result.reason, "timeout");
  assert.equal(formatAiHealthMessage(result), "AI relay timed out at http://localhost:8080.");

  restoreGlobals();
});
