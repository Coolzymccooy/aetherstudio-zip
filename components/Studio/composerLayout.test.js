import test from "node:test";
import assert from "node:assert/strict";
import { computeComposerLayout, computeFreeformSnap, computeTransitionAlpha } from "./composerLayout.ts";

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
  assert.equal(result.placements.b.width < 1920, true);
  assert.equal(result.placements.b.height < 1080, true);
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

  assert.equal(result.placements.c.width < 960, true);
  assert.equal(result.placements.c.height < 1080, true);
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
  assert.equal(result.placements.b.styleAdjustments.rounded >= 16, true);
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
  assert.equal(result.placements.a.width < 960, true);
  assert.equal(result.placements.a.height < 540, true);
});

test("speaker_focus keeps main full and limits secondary to a single pip", () => {
  const result = computeComposerLayout({
    ...baseInput,
    layoutTemplate: "speaker_focus",
    cameraLayerIds: ["a", "b", "c"],
    selectedMainLayerId: "b",
    maxComposedCameras: 4,
  });

  assert.equal(result.visibleLayerIds.length, 2);
  assert.equal(result.placements.b.width < 1920, true);
  assert.equal(result.hiddenLayerIds.includes("c"), true);
});

test("scripture_focus creates split rail with rounded secondary card", () => {
  const result = computeComposerLayout({
    ...baseInput,
    layoutTemplate: "scripture_focus",
    cameraLayerIds: ["a", "b"],
    selectedMainLayerId: "a",
  });

  assert.equal(result.placements.a.width > result.placements.b.width, true);
  assert.equal(result.placements.b.styleAdjustments.rounded >= 16, true);
});

test("layout render meta carries theme styling and safe margins", () => {
  const result = computeComposerLayout({
    ...baseInput,
    layoutTemplate: "main_thumbs",
    cameraLayerIds: ["a", "b"],
    themeId: "broadcast_studio",
    backgroundStyle: "gradient_motion",
    frameStyle: "glass",
    motionStyle: "gentle",
  });

  assert.equal(result.renderMeta.backgroundStyle, "gradient_motion");
  assert.equal(result.renderMeta.frameStyle, "glass");
  assert.equal(result.renderMeta.motionStyle, "gentle");
  assert.equal(result.renderMeta.safeMargins.left > 0, true);
  assert.equal(result.renderMeta.defaultMediaFitMode, "contain");
  assert.equal(result.renderMeta.guides.length >= 6, true);
});

test("composed media defaults to contain so layouts preserve full frame", () => {
  const result = computeComposerLayout({
    ...baseInput,
    layoutTemplate: "sermon_split_left",
    cameraLayerIds: ["lumina", "cam"],
    selectedMainLayerId: "lumina",
    themeId: "sermon_split",
    aspectRatioBehavior: "contain",
  });

  assert.equal(result.renderMeta.aspectRatioBehavior, "contain");
  assert.equal(result.placements.lumina.styleAdjustments.aspectMode, "contain");
  assert.equal(result.placements.cam.styleAdjustments.aspectMode, "contain");
});

test("swapped roles promote the secondary layer to main", () => {
  const result = computeComposerLayout({
    ...baseInput,
    layoutTemplate: "side_by_side",
    cameraLayerIds: ["lumina", "cam"],
    selectedMainLayerId: "lumina",
    swappedRoles: true,
  });

  assert.equal(result.resolvedMainLayerId, "cam");
  assert.equal(result.placements.cam.x, 74);
});

test("visible placements are clamped inside the working canvas bounds", () => {
  const result = computeComposerLayout({
    ...baseInput,
    layoutTemplate: "sermon_split_right",
    cameraLayerIds: ["lumina", "cam", "cam2", "cam3"],
    selectedMainLayerId: "lumina",
    maxComposedCameras: 4,
  });

  for (const layerId of result.visibleLayerIds) {
    const placement = result.placements[layerId];
    assert.equal(placement.x >= 64, true);
    assert.equal(placement.y >= 54, true);
    assert.equal(placement.x + placement.width <= 1920 - 64, true);
    assert.equal(placement.y + placement.height <= 1080 - 54, true);
  }
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
  assert.equal(result.renderMeta.guides.length >= 6, true);
});

test("freeform snap locks to center and safe guides", () => {
  const centerSnap = computeFreeformSnap({
    x: 640 - 150 + 6,
    y: 360 - 90 + 4,
    width: 300,
    height: 180,
    canvasWidth: 1280,
    canvasHeight: 720,
  });

  assert.equal(centerSnap.snappedX, true);
  assert.equal(centerSnap.snappedY, true);
  assert.equal(centerSnap.guides.some((guide) => guide.kind === "center"), true);

  const edgeSnap = computeFreeformSnap({
    x: 70,
    y: 60,
    width: 280,
    height: 160,
    canvasWidth: 1280,
    canvasHeight: 720,
  });

  assert.equal(edgeSnap.snappedX, true);
  assert.equal(edgeSnap.snappedY, true);
  assert.equal(edgeSnap.guides.some((guide) => guide.kind === "safe"), true);
});

test("computeTransitionAlpha ramps up then down then returns to zero", () => {
  assert.equal(computeTransitionAlpha(0, 300), 0);
  assert.equal(computeTransitionAlpha(75, 300) > 0, true);
  assert.equal(computeTransitionAlpha(150, 300), 1);
  assert.equal(computeTransitionAlpha(225, 300) > 0, true);
  assert.equal(computeTransitionAlpha(300, 300), 0);
  assert.equal(computeTransitionAlpha(500, 300), 0);
});

// ─── Layout Studio: z-index guarantees for image overlay stability ───────────

test("main camera placement z-index is well above typical image layer starting value", () => {
  // Image layers are added at zIndex = layers.length + 1 (typically 1–5).
  // applyComposerLayoutState boosts image layers to maxPlacementZIndex + 10.
  // This test confirms the main placement z-index is >=100 so the boost fires.
  const result = computeComposerLayout({
    ...baseInput,
    layoutTemplate: "main_thumbs",
    cameraLayerIds: ["cam"],
    selectedMainLayerId: "cam",
  });

  const mainPlacement = result.placements["cam"];
  assert.equal(mainPlacement.visible, true);
  assert.equal(mainPlacement.zIndex >= 100, true,
    "main camera placement must be >= 100 so image overlay boost logic fires");
});

test("pip_corner secondary placements have higher z-index than the main background", () => {
  const result = computeComposerLayout({
    ...baseInput,
    layoutTemplate: "pip_corner",
    cameraLayerIds: ["a", "b", "c"],
    selectedMainLayerId: "a",
  });

  assert.equal(result.placements.b.zIndex > result.placements.a.zIndex, true,
    "PiP overlays must render above the main background");
});

test("all visible placements have z-index > 0", () => {
  const layouts = ["main_thumbs", "side_by_side", "grid_2x2", "speaker_focus", "scripture_focus"];
  for (const layoutTemplate of layouts) {
    const result = computeComposerLayout({
      ...baseInput,
      layoutTemplate,
      cameraLayerIds: ["a", "b", "c", "d"],
      selectedMainLayerId: "a",
    });
    for (const layerId of result.visibleLayerIds) {
      const p = result.placements[layerId];
      assert.equal(p.zIndex > 0, true,
        `visible layer ${layerId} in ${layoutTemplate} must have zIndex > 0`);
    }
  }
});

// ─── Scene Preset: layout round-trip ─────────────────────────────────────────

test("scene preset layout round-trip preserves main layer and theme", () => {
  // Simulates saving and reloading a scene preset: apply layout, verify
  // resolvedMainLayerId and renderMeta are consistent.
  const result = computeComposerLayout({
    ...baseInput,
    layoutTemplate: "sermon_split_left",
    cameraLayerIds: ["lumina", "cam"],
    selectedMainLayerId: "lumina",
    themeId: "sermon_split",
  });

  assert.equal(result.resolvedMainLayerId, "lumina");
  assert.equal(result.renderMeta.backgroundStyle !== undefined, true);
  assert.equal(result.visibleLayerIds.includes("lumina"), true);
  assert.equal(result.visibleLayerIds.includes("cam"), true);
});

test("loading a scene preset with swappedRoles promotes secondary to main", () => {
  const normal = computeComposerLayout({
    ...baseInput,
    layoutTemplate: "side_by_side",
    cameraLayerIds: ["lumina", "cam"],
    selectedMainLayerId: "lumina",
    swappedRoles: false,
  });
  const swapped = computeComposerLayout({
    ...baseInput,
    layoutTemplate: "side_by_side",
    cameraLayerIds: ["lumina", "cam"],
    selectedMainLayerId: "lumina",
    swappedRoles: true,
  });

  assert.notEqual(normal.resolvedMainLayerId, swapped.resolvedMainLayerId);
  assert.equal(swapped.resolvedMainLayerId, "cam");
});

test("scene preset with image overlay: non-camera layers are not in placements", () => {
  // Image layers are not passed as cameraLayerIds; they must NOT appear in
  // result.placements so applyComposerLayoutState can detect and boost them.
  const result = computeComposerLayout({
    ...baseInput,
    layoutTemplate: "main_thumbs",
    cameraLayerIds: ["cam1", "cam2"],
    selectedMainLayerId: "cam1",
  });

  assert.equal("image-overlay" in result.placements, false,
    "image layers must not appear in composer placements");
  assert.equal("cam1" in result.placements, true);
});
