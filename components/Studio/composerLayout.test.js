import test from "node:test";
import assert from "node:assert/strict";
import { computeComposerLayout, computeTransitionAlpha } from "./composerLayout.ts";

const baseInput = {
  canvasWidth: 1920,
  canvasHeight: 1080,
  maxComposedCameras: 4,
};

test("main_thumbs keeps main full and stacks thumbs", () => {
  const result = computeComposerLayout({
    ...baseInput,
    layoutTemplate: "main_thumbs",
    cameraLayerIds: ["a", "b", "c"],
    selectedMainLayerId: "b",
  });

  assert.equal(result.resolvedMainLayerId, "b");
  assert.equal(result.placements.b.width, 1920);
  assert.equal(result.placements.b.height, 1080);
  assert.equal(result.placements.a.visible, true);
  assert.equal(result.placements.c.visible, true);
  assert.equal(result.hiddenLayerIds.length, 0);
});

test("side_by_side places two primaries and keeps extras visible as strip", () => {
  const result = computeComposerLayout({
    ...baseInput,
    layoutTemplate: "side_by_side",
    cameraLayerIds: ["a", "b", "c", "d"],
    selectedMainLayerId: "c",
  });

  assert.equal(result.placements.c.width, 960);
  assert.equal(result.placements.c.height, 1080);
  assert.equal(result.placements.a.width > 0, true);
  assert.equal(result.placements.a.visible, true);
  assert.equal(result.hiddenLayerIds.length, 0);
});

test("pip_corner shows one main and up to three pips", () => {
  const result = computeComposerLayout({
    ...baseInput,
    layoutTemplate: "pip_corner",
    cameraLayerIds: ["a", "b", "c", "d", "e"],
    selectedMainLayerId: "a",
    maxComposedCameras: 5,
  });

  assert.equal(result.visibleLayerIds.length, 4);
  assert.equal(result.hiddenLayerIds.includes("e"), true);
  assert.equal(result.placements.b.styleAdjustments.rounded, 12);
});

test("grid_2x2 lays out first four and hides overflow", () => {
  const result = computeComposerLayout({
    ...baseInput,
    layoutTemplate: "grid_2x2",
    cameraLayerIds: ["a", "b", "c", "d", "e", "f"],
    selectedMainLayerId: "d",
    maxComposedCameras: 6,
  });

  assert.equal(result.visibleLayerIds.length, 4);
  assert.equal(result.hiddenLayerIds.includes("e"), true);
  assert.equal(result.hiddenLayerIds.includes("f"), true);
  assert.equal(result.placements.a.width, 960);
  assert.equal(result.placements.a.height, 540);
});

test("maxComposedCameras cap is enforced deterministically", () => {
  const result = computeComposerLayout({
    ...baseInput,
    layoutTemplate: "main_thumbs",
    cameraLayerIds: ["a", "b", "c", "d", "e"],
    selectedMainLayerId: "a",
    maxComposedCameras: 3,
  });

  assert.deepEqual(result.visibleLayerIds, ["a", "b", "c"]);
  assert.equal(result.hiddenLayerIds.includes("d"), true);
  assert.equal(result.hiddenLayerIds.includes("e"), true);
});

test("camera order override is honored while appending unknown cameras", () => {
  const result = computeComposerLayout({
    ...baseInput,
    layoutTemplate: "main_thumbs",
    cameraLayerIds: ["a", "b", "c"],
    cameraOrderOverride: ["c", "a"],
    maxComposedCameras: 3,
  });

  assert.deepEqual(result.cameraLayerOrder, ["c", "a", "b"]);
});

test("freeform returns no auto placements", () => {
  const result = computeComposerLayout({
    ...baseInput,
    layoutTemplate: "freeform",
    cameraLayerIds: ["a", "b", "c"],
    selectedMainLayerId: "b",
  });

  assert.equal(result.resolvedMainLayerId, "b");
  assert.deepEqual(result.placements, {});
  assert.deepEqual(result.visibleLayerIds, []);
  assert.deepEqual(result.hiddenLayerIds, []);
});

test("computeTransitionAlpha ramps up then down then returns to zero", () => {
  assert.equal(computeTransitionAlpha(0, 300), 0);
  assert.equal(computeTransitionAlpha(75, 300) > 0, true);
  assert.equal(computeTransitionAlpha(150, 300), 1);
  assert.equal(computeTransitionAlpha(225, 300) > 0, true);
  assert.equal(computeTransitionAlpha(300, 300), 0);
  assert.equal(computeTransitionAlpha(500, 300), 0);
});
