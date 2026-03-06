import test from "node:test";
import assert from "node:assert/strict";
import {
  clampLayerPositionToCanvas,
  pickInteractiveLayerAtPoint,
  resolveComposerMainLayerId,
  resolveProgramLayerId,
} from "./studioInteraction.ts";

test("composer main resolution stays stable when selection changes", () => {
  const first = resolveComposerMainLayerId({
    mediaLayerIds: ["lumina", "cam", "cam2"],
    composerMainLayerId: "lumina",
    selectedLayerId: "cam",
  });
  const second = resolveComposerMainLayerId({
    mediaLayerIds: ["lumina", "cam", "cam2"],
    composerMainLayerId: "lumina",
    selectedLayerId: "cam2",
  });

  assert.equal(first, "lumina");
  assert.equal(second, "lumina");
});

test("program layer prefers composer main while composer mode is active", () => {
  assert.equal(
    resolveProgramLayerId({
      composerMode: true,
      composerMainLayerId: "hero",
      selectedLayerId: "pip",
    }),
    "hero"
  );
});

test("hit testing prefers the topmost rendered smaller card over a larger overlapping layer", () => {
  const picked = pickInteractiveLayerAtPoint(
    [
      {
        layerId: "main",
        zIndex: 100,
        paintOrder: 1,
        hitRect: { x: 0, y: 0, width: 1280, height: 720 },
      },
      {
        layerId: "pip",
        zIndex: 220,
        paintOrder: 2,
        hitRect: { x: 920, y: 520, width: 260, height: 150 },
      },
    ],
    1000,
    560
  );

  assert.equal(picked, "pip");
});

test("drag clamping keeps layers fully inside the canvas", () => {
  const clamped = clampLayerPositionToCanvas({
    x: 1180,
    y: 690,
    width: 220,
    height: 120,
    canvasWidth: 1280,
    canvasHeight: 720,
  });

  assert.deepEqual(clamped, { x: 1060, y: 600 });
});
