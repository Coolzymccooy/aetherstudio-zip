export type ComposerLayoutTemplate =
  | "freeform"
  | "main_thumbs"
  | "grid_2x2"
  | "side_by_side"
  | "pip_corner"
  | "speaker_focus"
  | "scripture_focus"
  | "sermon_split_left"
  | "sermon_split_right"
  | "projector_speaker";

export type BackgroundStyleId =
  | "blurred_camera"
  | "gradient_motion"
  | "brand_wave"
  | "light_studio";

export type FrameStyleId = "floating" | "flat" | "glass";

export type MotionStyleId = "smooth" | "snappy" | "gentle";

export type LayoutPackId =
  | "core_broadcast"
  | "church_broadcast"
  | "conference_pack"
  | "creator_pack";

export type LayoutThemeId =
  | "sermon_split"
  | "speaker_focus"
  | "scripture_focus"
  | "dual_frame"
  | "broadcast_studio"
  | "clean_minimal"
  | "cinematic_dark"
  | "creator_mode"
  | "projector_speaker";

export type AspectRatioBehavior = "cover" | "contain" | "smart";

export type LayoutSafeMargins = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

export type LayoutPreviewTile = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  primary?: boolean;
};

export type LayoutThemeDefinition = {
  id: LayoutThemeId;
  name: string;
  packId: LayoutPackId;
  layoutTemplate: ComposerLayoutTemplate;
  description: string;
  backgroundStyle: BackgroundStyleId;
  frameStyle: FrameStyleId;
  motionStyle: MotionStyleId;
  safeMargins: LayoutSafeMargins;
  aspectRatioBehavior: AspectRatioBehavior;
  preview: LayoutPreviewTile[];
};

export type LayoutPackDefinition = {
  id: LayoutPackId;
  name: string;
  description: string;
};

export type CinematicLayoutSelection = {
  themeId: LayoutThemeId;
  layoutTemplate: ComposerLayoutTemplate;
  backgroundStyle: BackgroundStyleId;
  frameStyle: FrameStyleId;
  motionStyle: MotionStyleId;
  safeMargins: LayoutSafeMargins;
  aspectRatioBehavior: AspectRatioBehavior;
  packId: LayoutPackId;
};

export const DEFAULT_SAFE_MARGINS: LayoutSafeMargins = {
  top: 54,
  right: 64,
  bottom: 54,
  left: 64,
};

export const DEFAULT_BRAND_COLORS = ["#6d28d9", "#0f172a", "#22c55e"] as const;

export const DEFAULT_LAYOUT_THEME_ID: LayoutThemeId = "broadcast_studio";

export const LAYOUT_PACKS: LayoutPackDefinition[] = [
  {
    id: "core_broadcast",
    name: "Core Broadcast",
    description: "Default premium layouts for general streaming.",
  },
  {
    id: "church_broadcast",
    name: "Church Broadcast Pack",
    description: "Themes tuned for sermon, scripture, and worship moments.",
  },
  {
    id: "conference_pack",
    name: "Conference Pack",
    description: "Presentation-forward layouts for teaching and talks.",
  },
  {
    id: "creator_pack",
    name: "Creator Pack",
    description: "Clean creator and podcast-oriented compositions.",
  },
];

export const LAYOUT_THEMES: LayoutThemeDefinition[] = [
  {
    id: "sermon_split",
    name: "Sermon Split",
    packId: "church_broadcast",
    layoutTemplate: "sermon_split_left",
    description: "Slides lead, speaker supports from a cinematic side rail.",
    backgroundStyle: "blurred_camera",
    frameStyle: "floating",
    motionStyle: "smooth",
    safeMargins: DEFAULT_SAFE_MARGINS,
    aspectRatioBehavior: "contain",
    preview: [
      { id: "lumina", x: 0.02, y: 0.08, width: 0.63, height: 0.82, primary: true },
      { id: "cam", x: 0.71, y: 0.22, width: 0.2, height: 0.26 },
      { id: "cam-2", x: 0.71, y: 0.54, width: 0.2, height: 0.18 },
    ],
  },
  {
    id: "projector_speaker",
    name: "Projector + Speaker",
    packId: "church_broadcast",
    layoutTemplate: "projector_speaker",
    description: "Projector/screen fills the left panel, live speaker camera fills the right — one-click church broadcast layout.",
    backgroundStyle: "light_studio",
    frameStyle: "floating",
    motionStyle: "smooth",
    safeMargins: { top: 14, right: 18, bottom: 14, left: 18 },
    aspectRatioBehavior: "contain",
    preview: [
      { id: "lumina", x: 0.0, y: 0.0, width: 0.57, height: 1.0, primary: true },
      { id: "cam",   x: 0.59, y: 0.04, width: 0.39, height: 0.92 },
    ],
  },
  {
    id: "speaker_focus",
    name: "Speaker Focus",
    packId: "core_broadcast",
    layoutTemplate: "speaker_focus",
    description: "Large speaker frame with supporting presentation PiP.",
    backgroundStyle: "blurred_camera",
    frameStyle: "glass",
    motionStyle: "smooth",
    safeMargins: DEFAULT_SAFE_MARGINS,
    aspectRatioBehavior: "contain",
    preview: [
      { id: "cam", x: 0.03, y: 0.06, width: 0.86, height: 0.84, primary: true },
      { id: "lumina", x: 0.68, y: 0.62, width: 0.22, height: 0.2 },
    ],
  },
  {
    id: "scripture_focus",
    name: "Scripture Focus",
    packId: "church_broadcast",
    layoutTemplate: "scripture_focus",
    description: "Scripture or slide content becomes the hero composition.",
    backgroundStyle: "gradient_motion",
    frameStyle: "floating",
    motionStyle: "gentle",
    safeMargins: DEFAULT_SAFE_MARGINS,
    aspectRatioBehavior: "contain",
    preview: [
      { id: "lumina", x: 0.04, y: 0.08, width: 0.68, height: 0.78, primary: true },
      { id: "cam", x: 0.77, y: 0.2, width: 0.15, height: 0.22 },
      { id: "cam-2", x: 0.75, y: 0.49, width: 0.18, height: 0.16 },
    ],
  },
  {
    id: "dual_frame",
    name: "Dual Frame",
    packId: "conference_pack",
    layoutTemplate: "side_by_side",
    description: "Balanced dual-card layout for speaker and Lumina content.",
    backgroundStyle: "gradient_motion",
    frameStyle: "floating",
    motionStyle: "smooth",
    safeMargins: DEFAULT_SAFE_MARGINS,
    aspectRatioBehavior: "contain",
    preview: [
      { id: "lumina", x: 0.04, y: 0.12, width: 0.42, height: 0.72, primary: true },
      { id: "cam", x: 0.54, y: 0.12, width: 0.42, height: 0.72 },
    ],
  },
  {
    id: "broadcast_studio",
    name: "Broadcast Studio",
    packId: "core_broadcast",
    layoutTemplate: "main_thumbs",
    description: "Hero program with a premium support rail and strong safe areas.",
    backgroundStyle: "gradient_motion",
    frameStyle: "floating",
    motionStyle: "smooth",
    safeMargins: DEFAULT_SAFE_MARGINS,
    aspectRatioBehavior: "contain",
    preview: [
      { id: "hero", x: 0.03, y: 0.08, width: 0.7, height: 0.82, primary: true },
      { id: "aux-1", x: 0.78, y: 0.12, width: 0.16, height: 0.18 },
      { id: "aux-2", x: 0.78, y: 0.36, width: 0.16, height: 0.18 },
      { id: "aux-3", x: 0.78, y: 0.6, width: 0.16, height: 0.18 },
    ],
  },
  {
    id: "clean_minimal",
    name: "Clean Minimal",
    packId: "conference_pack",
    layoutTemplate: "pip_corner",
    description: "Quiet teaching layout with restrained motion and soft studio light.",
    backgroundStyle: "light_studio",
    frameStyle: "flat",
    motionStyle: "gentle",
    safeMargins: DEFAULT_SAFE_MARGINS,
    aspectRatioBehavior: "contain",
    preview: [
      { id: "lumina", x: 0.03, y: 0.08, width: 0.86, height: 0.82, primary: true },
      { id: "cam", x: 0.7, y: 0.64, width: 0.18, height: 0.16 },
    ],
  },
  {
    id: "cinematic_dark",
    name: "Cinematic Dark",
    packId: "church_broadcast",
    layoutTemplate: "sermon_split_right",
    description: "Dark premium presentation layout with glass frames and deep contrast.",
    backgroundStyle: "gradient_motion",
    frameStyle: "glass",
    motionStyle: "smooth",
    safeMargins: DEFAULT_SAFE_MARGINS,
    aspectRatioBehavior: "contain",
    preview: [
      { id: "cam", x: 0.05, y: 0.08, width: 0.22, height: 0.28 },
      { id: "lumina", x: 0.31, y: 0.08, width: 0.61, height: 0.82, primary: true },
      { id: "cam-2", x: 0.07, y: 0.48, width: 0.18, height: 0.16 },
    ],
  },
  {
    id: "creator_mode",
    name: "Creator Mode",
    packId: "creator_pack",
    layoutTemplate: "pip_corner",
    description: "Clean creator layout with a content-first canvas and compact host card.",
    backgroundStyle: "brand_wave",
    frameStyle: "glass",
    motionStyle: "snappy",
    safeMargins: DEFAULT_SAFE_MARGINS,
    aspectRatioBehavior: "contain",
    preview: [
      { id: "lumina", x: 0.03, y: 0.08, width: 0.84, height: 0.8, primary: true },
      { id: "cam", x: 0.68, y: 0.62, width: 0.2, height: 0.2 },
    ],
  },
];

export const getLayoutThemeDefinition = (themeId?: LayoutThemeId | null) => {
  if (!themeId) return LAYOUT_THEMES.find((theme) => theme.id === DEFAULT_LAYOUT_THEME_ID) as LayoutThemeDefinition;
  return LAYOUT_THEMES.find((theme) => theme.id === themeId)
    || (LAYOUT_THEMES.find((theme) => theme.id === DEFAULT_LAYOUT_THEME_ID) as LayoutThemeDefinition);
};

export const layoutThemeIdFromTemplate = (layoutTemplate?: ComposerLayoutTemplate | null): LayoutThemeId => {
  switch (layoutTemplate) {
    case "speaker_focus":
      return "speaker_focus";
    case "scripture_focus":
      return "scripture_focus";
    case "side_by_side":
      return "dual_frame";
    case "pip_corner":
      return "clean_minimal";
    case "sermon_split_right":
      return "cinematic_dark";
    case "sermon_split_left":
      return "sermon_split";
    case "freeform":
      return "creator_mode";
    case "grid_2x2":
    case "main_thumbs":
    default:
      return "broadcast_studio";
  }
};

export const buildLayoutSelection = (
  themeId?: LayoutThemeId | null,
  overrides?: Partial<Pick<CinematicLayoutSelection, "backgroundStyle" | "frameStyle" | "motionStyle">>
): CinematicLayoutSelection => {
  const theme = getLayoutThemeDefinition(themeId);
  return {
    themeId: theme.id,
    layoutTemplate: theme.layoutTemplate,
    backgroundStyle: overrides?.backgroundStyle || theme.backgroundStyle,
    frameStyle: overrides?.frameStyle || theme.frameStyle,
    motionStyle: overrides?.motionStyle || theme.motionStyle,
    safeMargins: theme.safeMargins,
    aspectRatioBehavior: theme.aspectRatioBehavior,
    packId: theme.packId,
  };
};
