import test from "node:test";
import assert from "node:assert/strict";
import {
  buildGlobalScrollSegments,
  buildCanvasLayoutRevision,
  computeInputSectionBodyHeights,
  computeOperatorRailScrollState,
  mapGlobalNodeScrollTopToProgress,
  mapGlobalProgressToNodeScrollTop,
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

test("canvas layout revision is stable when only rail height changes", () => {
  const before = buildCanvasLayoutRevision({
    railWidth: 352,
    railHeight: 860,
    viewportWidth: 1536,
    viewportHeight: 864,
    composerMode: false,
  });
  const after = buildCanvasLayoutRevision({
    railWidth: 352,
    railHeight: 920,
    viewportWidth: 1536,
    viewportHeight: 864,
    composerMode: false,
  });
  assert.equal(before, after);
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
    rightPanelTab: "properties",
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

test("input section body heights stay bounded against rail height", () => {
  const heights = computeInputSectionBodyHeights({ railHeight: 760 });

  assert.equal(heights.compact >= 112, true);
  assert.equal(heights.standard > heights.compact, true);
  assert.equal(heights.medium > heights.standard, true);
  assert.equal(heights.layoutStudio > heights.medium, true);
  assert.equal(heights.layoutStudio <= 460, true);
});

test("global progress maps across ordered outer and nested segments", () => {
  const nodes = [
    { id: "outer", maxScrollTop: 200, scrollTop: 0 },
    { id: "inner:layout", maxScrollTop: 120, scrollTop: 0 },
    { id: "inner:audience", maxScrollTop: 80, scrollTop: 0 },
  ];
  const segments = buildGlobalScrollSegments({ nodes });
  assert.equal(segments.totalScrollable, 400);

  const quarter = mapGlobalProgressToNodeScrollTop({ nodes, segments, progress: 0.25 });
  assert.deepEqual(quarter, {
    outer: 100,
    "inner:layout": 0,
    "inner:audience": 0,
  });

  const mid = mapGlobalProgressToNodeScrollTop({ nodes, segments, progress: 0.55 });
  assert.equal(Math.round(mid.outer), 200);
  assert.equal(Math.round(mid["inner:layout"]), 20);
  assert.equal(Math.round(mid["inner:audience"]), 0);

  const full = mapGlobalProgressToNodeScrollTop({ nodes, segments, progress: 1 });
  assert.deepEqual(full, {
    outer: 200,
    "inner:layout": 120,
    "inner:audience": 80,
  });
});

test("node scroll positions map back to global progress", () => {
  const nodes = [
    { id: "outer", maxScrollTop: 200, scrollTop: 200 },
    { id: "inner:layout", maxScrollTop: 120, scrollTop: 60 },
    { id: "inner:audience", maxScrollTop: 80, scrollTop: 10 },
  ];
  const segments = buildGlobalScrollSegments({ nodes });
  const progress = mapGlobalNodeScrollTopToProgress({ nodes, segments });
  assert.equal(progress, 0.825);
});

// ─── IN Panel: Composer Mode ────────────────────────────────────────────────

test("canvas revision changes when composer mode arms or disarms", () => {
  const standby = buildCanvasLayoutRevision({
    railWidth: 352,
    viewportWidth: 1536,
    viewportHeight: 864,
    composerMode: false,
  });
  const armed = buildCanvasLayoutRevision({
    railWidth: 352,
    viewportWidth: 1536,
    viewportHeight: 864,
    composerMode: true,
  });

  assert.notEqual(standby, armed);
  assert.equal(standby.startsWith("standby"), true);
  assert.equal(armed.startsWith("armed"), true);
});

// ─── IN Panel: Layout Studio section heights ────────────────────────────────

test("layout studio body is the tallest section at any rail height", () => {
  for (const railHeight of [600, 760, 900, 1080]) {
    const h = computeInputSectionBodyHeights({ railHeight });
    assert.equal(h.layoutStudio >= h.medium, true, `layoutStudio >= medium at railHeight ${railHeight}`);
    assert.equal(h.medium >= h.standard, true, `medium >= standard at railHeight ${railHeight}`);
    assert.equal(h.standard >= h.compact, true, `standard >= compact at railHeight ${railHeight}`);
  }
});

test("input section heights floor at their computed minimums on very small rails", () => {
  // railHeight=0 → usableHeight = max(320, 0-280) = 320 (floor enforced by implementation)
  const h = computeInputSectionBodyHeights({ railHeight: 0 });

  assert.equal(h.compact, 112);    // max(112, min(320*0.32=102, 180)) = 112
  assert.equal(h.standard, 148);  // max(148, min(320*0.42=134, 248)) = 148
  assert.equal(h.medium, 184);    // max(184, min(320*0.56=179, 320)) = 184
  assert.equal(h.layoutStudio, 256); // max(240, min(320*0.80=256, 460)) = 256
});

test("layout studio body height is capped at 460 regardless of rail size", () => {
  const h = computeInputSectionBodyHeights({ railHeight: 2160 });

  assert.equal(h.layoutStudio, 460);
});

// ─── IN Panel: outer scroll thumb ───────────────────────────────────────────

test("outer rail thumb reaches track bottom when scrolled to end", () => {
  const state = computeOperatorRailScrollState({
    clientHeight: 500,
    scrollHeight: 1500,
    scrollTop: 1000, // maxScrollTop
    trackHeight: 400,
  });

  assert.equal(state.overflow, true);
  assert.equal(state.progress, 1);
  assert.equal(state.thumbTop, state.maxScrollTop <= 0 ? 0 : 400 - state.thumbHeight);
});

test("outer rail thumb is proportionally smaller with more overflow", () => {
  const small = computeOperatorRailScrollState({
    clientHeight: 500,
    scrollHeight: 600,
    scrollTop: 0,
    trackHeight: 400,
  });
  const large = computeOperatorRailScrollState({
    clientHeight: 500,
    scrollHeight: 2000,
    scrollTop: 0,
    trackHeight: 400,
  });

  assert.equal(small.overflow, true);
  assert.equal(large.overflow, true);
  assert.equal(small.thumbHeight > large.thumbHeight, true);
});

test("outer rail progress stays clamped between 0 and 1", () => {
  const atStart = computeOperatorRailScrollState({
    clientHeight: 400,
    scrollHeight: 1200,
    scrollTop: 0,
    trackHeight: 300,
  });
  const atEnd = computeOperatorRailScrollState({
    clientHeight: 400,
    scrollHeight: 1200,
    scrollTop: 800,
    trackHeight: 300,
  });
  const overScroll = computeOperatorRailScrollState({
    clientHeight: 400,
    scrollHeight: 1200,
    scrollTop: 9999,
    trackHeight: 300,
  });

  assert.equal(atStart.progress, 0);
  assert.equal(atEnd.progress, 1);
  assert.equal(overScroll.progress, 1);
});

// ─── IN Panel: outer-only global scroll coordinator ─────────────────────────

test("outer-only scroll coordinator maps single rail progress correctly", () => {
  const nodes = [{ id: "outer-rail", maxScrollTop: 300, scrollTop: 150 }];
  const segments = buildGlobalScrollSegments({ nodes });

  assert.equal(segments.totalScrollable, 300);
  assert.equal(segments.segments.length, 1);

  const progress = mapGlobalNodeScrollTopToProgress({ nodes, segments });
  assert.equal(progress, 0.5);

  const mapped = mapGlobalProgressToNodeScrollTop({ nodes, segments, progress: 0.5 });
  assert.deepEqual(mapped, { "outer-rail": 150 });
});

test("outer-only coordinator scrolls to top and bottom correctly", () => {
  const nodes = [{ id: "outer-rail", maxScrollTop: 400, scrollTop: 0 }];
  const segments = buildGlobalScrollSegments({ nodes });

  const top = mapGlobalProgressToNodeScrollTop({ nodes, segments, progress: 0 });
  const bottom = mapGlobalProgressToNodeScrollTop({ nodes, segments, progress: 1 });

  assert.deepEqual(top, { "outer-rail": 0 });
  assert.deepEqual(bottom, { "outer-rail": 400 });
});

test("global mapping handles no overflow and mixed zero-span nodes", () => {
  const nodes = [
    { id: "outer", maxScrollTop: 0, scrollTop: 0 },
    { id: "inner:hidden", maxScrollTop: 0, scrollTop: 999 },
    { id: "inner:active", maxScrollTop: 40, scrollTop: 10 },
  ];
  const segments = buildGlobalScrollSegments({ nodes });
  assert.equal(segments.totalScrollable, 40);
  assert.equal(segments.segments.length, 1);
  assert.equal(segments.segments[0].id, "inner:active");

  const mapped = mapGlobalProgressToNodeScrollTop({ nodes, segments, progress: 0.5 });
  assert.deepEqual(mapped, {
    outer: 0,
    "inner:hidden": 0,
    "inner:active": 20,
  });

  const noOverflowNodes = [
    { id: "outer", maxScrollTop: 0, scrollTop: 0 },
    { id: "inner:a", maxScrollTop: 0, scrollTop: 0 },
  ];
  const noOverflowSegments = buildGlobalScrollSegments({ nodes: noOverflowNodes });
  const noOverflowMapped = mapGlobalProgressToNodeScrollTop({
    nodes: noOverflowNodes,
    segments: noOverflowSegments,
    progress: 0.75,
  });
  assert.deepEqual(noOverflowMapped, { outer: 0, "inner:a": 0 });
  assert.equal(
    mapGlobalNodeScrollTopToProgress({
      nodes: noOverflowNodes,
      segments: noOverflowSegments,
    }),
    0
  );
});

// ─── Outer-Rail Only: Scroll State Drives Slider ────────────────────────────

test("outer rail overflow is detected when content exceeds client height", () => {
  // Simulates the outer rail after sections expand to their natural height
  // (no inner maxHeight cap). scrollHeight > clientHeight triggers overflow.
  const state = computeOperatorRailScrollState({
    clientHeight: 800,
    scrollHeight: 1600, // two sections worth of content
    scrollTop: 0,
    trackHeight: 500,
  });

  assert.equal(state.overflow, true);
  assert.equal(state.progress, 0);
  assert.equal(state.thumbHeight < 500, true);
});

test("outer rail slider thumb travels full track range when scrolled end-to-end", () => {
  const trackHeight = 400;
  const atTop = computeOperatorRailScrollState({
    clientHeight: 700,
    scrollHeight: 1400,
    scrollTop: 0,
    trackHeight,
  });
  const atBottom = computeOperatorRailScrollState({
    clientHeight: 700,
    scrollHeight: 1400,
    scrollTop: 700, // maxScrollTop = 1400 - 700
    trackHeight,
  });

  assert.equal(atTop.overflow, true);
  assert.equal(atTop.progress, 0);
  assert.equal(atTop.thumbTop, 0);

  assert.equal(atBottom.progress, 1);
  assert.equal(atBottom.thumbTop, trackHeight - atBottom.thumbHeight);
});

test("outer-only coordinator returns correct scroll top after sections expand", () => {
  // Scenario: user opens Scene Presets — section expands to ~600px, outer rail
  // scrollHeight becomes 1100px, clientHeight is 700px.
  const nodes = [{ id: "outer-rail", maxScrollTop: 400, scrollTop: 0 }];
  const segments = buildGlobalScrollSegments({ nodes });

  // Sliding to 50% should set outer scroll to 200px.
  const at50 = mapGlobalProgressToNodeScrollTop({ nodes, segments, progress: 0.5 });
  assert.deepEqual(at50, { "outer-rail": 200 });

  // Sliding to 100% should reach maxScrollTop.
  const at100 = mapGlobalProgressToNodeScrollTop({ nodes, segments, progress: 1 });
  assert.deepEqual(at100, { "outer-rail": 400 });
});


// ─── Scene Preset: outer-only scroll covers full section content ─────────────

test("single large section drives outer rail overflow and thumb geometry", () => {
  // Simulates Scene Presets open with many saved presets making section ~900px tall.
  // Headers for 7 closed sections ≈ 7 * 48 = 336px. Open section ≈ 560px.
  // Total ≈ 896px. Rail clientHeight = 700px → overflow = true.
  const totalContent = 896;
  const clientHeight = 700;
  const scrollTop = 0;

  const state = computeOperatorRailScrollState({
    clientHeight,
    scrollHeight: totalContent,
    scrollTop,
    trackHeight: 500,
  });

  assert.equal(state.overflow, true);
  assert.equal(state.maxScrollTop, totalContent - clientHeight);
  assert.equal(state.thumbHeight < 500, true);
  // Thumb must be at least minThumbHeight (default 48px) tall.
  assert.equal(state.thumbHeight >= 48, true);
});
