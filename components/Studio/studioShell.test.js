import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCanvasLayoutRevision,
  computeOperatorRailScrollState,
} from "./studioShell.ts";

test("operator rail scroll state exposes overflow thumb geometry", () => {
  const state = computeOperatorRailScrollState({
    clientHeight: 420,
    scrollHeight: 1260,
    scrollTop: 315,
    trackHeight: 300,
  });

  assert.equal(state.overflow, true);
  assert.equal(state.thumbHeight > 0, true);
  assert.equal(state.thumbTop > 0, true);
  assert.equal(state.progress > 0, true);
});

test("operator rail scroll state collapses when content fits", () => {
  const state = computeOperatorRailScrollState({
    clientHeight: 420,
    scrollHeight: 420,
    scrollTop: 0,
    trackHeight: 300,
  });

  assert.deepEqual(state, {
    overflow: false,
    progress: 0,
    thumbHeight: 300,
    thumbTop: 0,
    maxScrollTop: 0,
  });
});

test("canvas layout revision ignores input section-only changes", () => {
  const before = buildCanvasLayoutRevision({
    rightPanelTab: "inputs",
    railWidth: 352,
    railHeight: 860,
    viewportWidth: 1536,
    viewportHeight: 864,
    composerMode: true,
  });
  const after = buildCanvasLayoutRevision({
    rightPanelTab: "inputs",
    railWidth: 352,
    railHeight: 860,
    viewportWidth: 1536,
    viewportHeight: 864,
    composerMode: true,
  });

  assert.equal(before, after);
});

test("canvas layout revision changes on real viewport-affecting changes", () => {
  const before = buildCanvasLayoutRevision({
    rightPanelTab: "inputs",
    railWidth: 352,
    railHeight: 860,
    viewportWidth: 1536,
    viewportHeight: 864,
    composerMode: false,
  });
  const after = buildCanvasLayoutRevision({
    rightPanelTab: "inputs",
    railWidth: 384,
    railHeight: 860,
    viewportWidth: 1536,
    viewportHeight: 864,
    composerMode: false,
  });

  assert.notEqual(before, after);
});
