import test from "node:test";
import assert from "node:assert/strict";
import {
  inferIntentFromLuminaState,
  inferThemeFromLuminaState,
  normalizeLuminaState,
} from "./luminaSync.ts";

test("normalizeLuminaState detects scripture payloads", () => {
  const state = normalizeLuminaState("lumina.state.sync", {
    scripture: true,
    sceneName: "Romans 8",
    projectorActive: true,
  });

  assert.equal(state.contentMode, "scripture");
  assert.equal(state.hasProjectorContent, true);
  assert.equal(inferIntentFromLuminaState(state), "scriptureFocus");
  assert.equal(inferThemeFromLuminaState(state), "scripture_focus");
});

test("normalizeLuminaState detects speaker events from heuristics", () => {
  const state = normalizeLuminaState("speaker.camera.active", {
    speaker: "Pastor Joy",
  });

  assert.equal(state.contentMode, "speaker");
  assert.equal(inferIntentFromLuminaState(state), "speakerFocus");
  assert.equal(inferThemeFromLuminaState(state), "speaker_focus");
});

test("presentation events resolve to broadcast emphasis", () => {
  const state = normalizeLuminaState("lumina.scene.switch", {
    contentType: "presentation",
    title: "Announcements",
  });

  assert.equal(state.contentMode, "presentation");
  assert.equal(inferIntentFromLuminaState(state), "broadcastFocus");
  assert.equal(inferThemeFromLuminaState(state), "broadcast_studio");
});
