import type { LayoutThemeId } from "./cinematicLayout";

export type LuminaContentMode =
  | "idle"
  | "speaker"
  | "scripture"
  | "presentation"
  | "sermon"
  | "audience"
  | "unknown";

export type SmartBroadcastIntent =
  | "speakerFocus"
  | "scriptureFocus"
  | "broadcastFocus"
  | "audienceInteraction";

export type NormalizedLuminaState = {
  event: string;
  sceneName: string | null;
  contentMode: LuminaContentMode;
  hasProjectorContent: boolean;
  title: string | null;
  presenter: string | null;
  shouldAutoSwitch: boolean;
  payload: any;
  ts: number;
};

const asText = (value: unknown) => {
  const text = typeof value === "string" ? value.trim() : "";
  return text || null;
};

const includesAny = (value: string, parts: string[]) => parts.some((part) => value.includes(part));

export const normalizeLuminaState = (eventName: string, payload?: any): NormalizedLuminaState => {
  const event = String(eventName || "").trim();
  const eventLc = event.toLowerCase();
  const sceneName = asText(payload?.sceneName)
    || asText(payload?.target)
    || asText(payload?.scene)
    || asText(payload?.name);
  const title = asText(payload?.title) || asText(payload?.slideTitle) || asText(payload?.subtitle);
  const presenter = asText(payload?.speaker) || asText(payload?.presenter) || asText(payload?.host);
  const joined = [
    eventLc,
    sceneName?.toLowerCase() || "",
    title?.toLowerCase() || "",
    presenter?.toLowerCase() || "",
    typeof payload?.contentType === "string" ? payload.contentType.toLowerCase() : "",
    typeof payload?.mode === "string" ? payload.mode.toLowerCase() : "",
    typeof payload?.state === "string" ? payload.state.toLowerCase() : "",
  ].join(" ");

  let contentMode: LuminaContentMode = "unknown";
  if (!eventLc) {
    contentMode = "idle";
  } else if (payload?.scripture === true || includesAny(joined, ["scripture", "verse", "slidechanged", "slide.change"])) {
    contentMode = "scripture";
  } else if (includesAny(joined, ["sermon", "homily", "message"])) {
    contentMode = "sermon";
  } else if (includesAny(joined, ["presentation", "slides", "projector", "deck"])) {
    contentMode = "presentation";
  } else if (includesAny(joined, ["audience", "question", "comment", "chat"])) {
    contentMode = "audience";
  } else if (includesAny(joined, ["speaker", "camera", "audio", "mic"])) {
    contentMode = "speaker";
  }

  const hasProjectorContent = contentMode === "scripture"
    || contentMode === "presentation"
    || contentMode === "sermon"
    || payload?.hasSlides === true
    || payload?.projectorActive === true;

  return {
    event,
    sceneName,
    contentMode,
    hasProjectorContent,
    title,
    presenter,
    shouldAutoSwitch: payload?.autoSwitch !== false,
    payload: payload || {},
    ts: Date.now(),
  };
};

export const inferIntentFromLuminaState = (
  state: NormalizedLuminaState
): SmartBroadcastIntent | null => {
  switch (state.contentMode) {
    case "scripture":
      return "scriptureFocus";
    case "presentation":
    case "sermon":
      return "broadcastFocus";
    case "audience":
      return "audienceInteraction";
    case "speaker":
      return "speakerFocus";
    default:
      return state.hasProjectorContent ? "broadcastFocus" : null;
  }
};

export const inferThemeFromLuminaState = (state: NormalizedLuminaState): LayoutThemeId | null => {
  switch (state.contentMode) {
    case "scripture":
      return "scripture_focus";
    case "sermon":
      return "sermon_split";
    case "presentation":
      return "broadcast_studio";
    case "speaker":
      return "speaker_focus";
    default:
      return state.hasProjectorContent ? "dual_frame" : null;
  }
};
