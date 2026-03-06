import test from "node:test";
import assert from "node:assert/strict";
import {
  coerceViewportSize,
  computeCanvasDisplaySize,
} from "./canvasViewport.ts";

test("coerceViewportSize preserves the last valid viewport when measurement collapses", () => {
  const previous = { width: 1180, height: 664 };
  const next = coerceViewportSize(previous, { width: 0, height: 0 });

  assert.deepEqual(next, previous);
});

test("computeCanvasDisplaySize fits a 16:9 stage inside the viewport", () => {
  const display = computeCanvasDisplaySize({ width: 1000, height: 600 });

  assert.deepEqual(display, { width: 1000, height: 562 });
});
