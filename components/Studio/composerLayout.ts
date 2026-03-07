import type {
  AspectRatioBehavior,
  BackgroundStyleId,
  ComposerLayoutTemplate,
  FrameStyleId,
  LayoutSafeMargins,
  LayoutThemeId,
  MotionStyleId,
} from "./cinematicLayout";

export type ComposerStyleAdjustments = {
  rounded?: number;
  frameStyle?: FrameStyleId;
  shadowColor?: string;
  shadowBlur?: number;
  shadowOpacity?: number;
  highlightOpacity?: number;
  cardPadding?: number;
  cardBackground?: string;
  aspectMode?: "cover" | "contain";
  focusRole?: "primary" | "secondary" | "support";
};

export type ComposerPlacement = {
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  visible: boolean;
  styleAdjustments?: ComposerStyleAdjustments;
};

export type ComposerGuide = {
  axis: "x" | "y";
  value: number;
  kind: "safe" | "center" | "third";
};

export type ComposerSnapResult = {
  x: number;
  y: number;
  snappedX: boolean;
  snappedY: boolean;
  guides: ComposerGuide[];
};

export type ComposerLayoutRenderMeta = {
  themeId?: LayoutThemeId | null;
  backgroundStyle: BackgroundStyleId;
  frameStyle: FrameStyleId;
  motionStyle: MotionStyleId;
  safeMargins: LayoutSafeMargins;
  aspectRatioBehavior: AspectRatioBehavior;
  defaultMediaFitMode: "contain" | "cover";
  guides: ComposerGuide[];
  transitionDurationMs: number;
  swappedRoles: boolean;
};

export type ComposerLayoutInput = {
  layoutTemplate: ComposerLayoutTemplate;
  cameraLayerIds: string[];
  selectedMainLayerId?: string | null;
  cameraOrderOverride?: string[];
  canvasWidth: number;
  canvasHeight: number;
  maxComposedCameras: number;
  backgroundStyle?: BackgroundStyleId;
  frameStyle?: FrameStyleId;
  motionStyle?: MotionStyleId;
  safeMargins?: LayoutSafeMargins;
  aspectRatioBehavior?: AspectRatioBehavior;
  themeId?: LayoutThemeId | null;
  swappedRoles?: boolean;
};

export type ComposerLayoutResult = {
  layoutTemplate: ComposerLayoutTemplate;
  resolvedMainLayerId: string | null;
  placements: Record<string, ComposerPlacement>;
  visibleLayerIds: string[];
  hiddenLayerIds: string[];
  cameraLayerOrder: string[];
  renderMeta: ComposerLayoutRenderMeta;
};

type Bounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

const MIN_VISIBLE_PADDING = 10;

const DEFAULT_SAFE_MARGINS: LayoutSafeMargins = {
  top: 54,
  right: 64,
  bottom: 54,
  left: 64,
};

export const computeTransitionAlpha = (elapsedMs: number, durationMs: number) => {
  const duration = Math.max(120, Number(durationMs || 0));
  const elapsed = Math.max(0, elapsedMs);
  const half = duration / 2;
  if (elapsed >= duration) return 0;
  if (elapsed <= half) return elapsed / half;
  return Math.max(0, 1 - (elapsed - half) / half);
};

const uniq = (values: string[]) => Array.from(new Set(values.filter(Boolean)));

const reorderByOverride = (cameraLayerIds: string[], override?: string[]) => {
  const base = uniq(cameraLayerIds);
  if (!Array.isArray(override) || override.length === 0) return base;

  const pinned = uniq(override).filter((id) => base.includes(id));
  const tail = base.filter((id) => !pinned.includes(id));
  return [...pinned, ...tail];
};

const resolveSafeMargins = (
  canvasWidth: number,
  canvasHeight: number,
  safeMargins?: LayoutSafeMargins
): LayoutSafeMargins => {
  const margins = safeMargins || DEFAULT_SAFE_MARGINS;
  return {
    top: Math.max(16, Math.min(canvasHeight * 0.18, margins.top)),
    right: Math.max(16, Math.min(canvasWidth * 0.18, margins.right)),
    bottom: Math.max(16, Math.min(canvasHeight * 0.18, margins.bottom)),
    left: Math.max(16, Math.min(canvasWidth * 0.18, margins.left)),
  };
};

const createWorkingBounds = (
  canvasWidth: number,
  canvasHeight: number,
  safeMargins: LayoutSafeMargins
): Bounds => ({
  x: safeMargins.left,
  y: safeMargins.top,
  width: Math.max(320, canvasWidth - safeMargins.left - safeMargins.right),
  height: Math.max(220, canvasHeight - safeMargins.top - safeMargins.bottom),
});

const insetBounds = (bounds: Bounds, padding: number): Bounds => ({
  x: bounds.x + padding,
  y: bounds.y + padding,
  width: Math.max(120, bounds.width - padding * 2),
  height: Math.max(120, bounds.height - padding * 2),
});

const clampPlacementToBounds = (
  placement: ComposerPlacement,
  bounds: Bounds
): ComposerPlacement => {
  if (!placement.visible) return placement;

  const width = Math.min(Math.max(48, placement.width), bounds.width);
  const height = Math.min(Math.max(48, placement.height), bounds.height);
  const x = Math.min(Math.max(placement.x, bounds.x), bounds.x + bounds.width - width);
  const y = Math.min(Math.max(placement.y, bounds.y), bounds.y + bounds.height - height);

  return {
    ...placement,
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height),
  };
};

const clampPlacementsToBounds = (
  placements: Record<string, ComposerPlacement>,
  bounds: Bounds
) => {
  const clampedBounds = insetBounds(bounds, MIN_VISIBLE_PADDING);
  Object.keys(placements).forEach((layerId) => {
    placements[layerId] = clampPlacementToBounds(placements[layerId], clampedBounds);
  });
};

const buildGuides = (canvasWidth: number, canvasHeight: number, safeMargins: LayoutSafeMargins): ComposerGuide[] => {
  const thirdsX = [canvasWidth / 3, (canvasWidth / 3) * 2];
  const thirdsY = [canvasHeight / 3, (canvasHeight / 3) * 2];
  return [
    { axis: "x", value: safeMargins.left, kind: "safe" },
    { axis: "x", value: canvasWidth - safeMargins.right, kind: "safe" },
    { axis: "y", value: safeMargins.top, kind: "safe" },
    { axis: "y", value: canvasHeight - safeMargins.bottom, kind: "safe" },
    { axis: "x", value: canvasWidth / 2, kind: "center" },
    { axis: "y", value: canvasHeight / 2, kind: "center" },
    { axis: "x", value: thirdsX[0], kind: "third" },
    { axis: "x", value: thirdsX[1], kind: "third" },
    { axis: "y", value: thirdsY[0], kind: "third" },
    { axis: "y", value: thirdsY[1], kind: "third" },
  ];
};

const frameAdjustmentsForRole = (
  role: "primary" | "secondary" | "support",
  frameStyle: FrameStyleId,
  aspectRatioBehavior: AspectRatioBehavior
): ComposerStyleAdjustments => {
  const isPrimary = role === "primary";
  const rounded = frameStyle === "flat" ? (isPrimary ? 10 : 8) : (isPrimary ? 18 : 16);
  return {
    rounded,
    frameStyle,
    shadowColor: isPrimary ? "rgba(15,23,42,0.65)" : "rgba(15,23,42,0.48)",
    shadowBlur: frameStyle === "flat" ? 10 : (isPrimary ? 26 : 18),
    shadowOpacity: frameStyle === "flat" ? 0.12 : (isPrimary ? 0.3 : 0.22),
    highlightOpacity: frameStyle === "glass" ? 0.32 : 0.18,
    cardPadding: frameStyle === "flat" ? 8 : 14,
    cardBackground: frameStyle === "glass"
      ? "rgba(15,23,42,0.14)"
      : frameStyle === "floating"
        ? "rgba(7,12,28,0.22)"
        : "rgba(10,14,26,0.08)",
    aspectMode: "contain",
    focusRole: role,
  };
};

const resolveMainLayerId = (cameraLayerIds: string[], requested?: string | null, swappedRoles?: boolean) => {
  const requestedMain = requested && cameraLayerIds.includes(requested) ? requested : (cameraLayerIds[0] || null);
  if (!swappedRoles || cameraLayerIds.length < 2 || !requestedMain) return requestedMain;
  return cameraLayerIds.find((id) => id !== requestedMain) || requestedMain;
};

const withHiddenPlacements = (
  placements: Record<string, ComposerPlacement>,
  hiddenLayerIds: string[]
) => {
  hiddenLayerIds.forEach((layerId) => {
    placements[layerId] = {
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      zIndex: 0,
      visible: false,
      styleAdjustments: { rounded: 0, frameStyle: "flat", focusRole: "support" },
    };
  });
};

const buildMainThumbs = (
  visibleLayerIds: string[],
  mainLayerId: string,
  bounds: Bounds,
  frameStyle: FrameStyleId,
  aspectRatioBehavior: AspectRatioBehavior
) => {
  const placements: Record<string, ComposerPlacement> = {};
  const pad = 18;
  const thumbW = Math.round(bounds.width * 0.19);
  const thumbH = Math.round(thumbW * 0.56);
  let thumbIdx = 0;

  visibleLayerIds.forEach((layerId) => {
    if (layerId === mainLayerId) {
      placements[layerId] = {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
        zIndex: 100,
        visible: true,
        styleAdjustments: frameAdjustmentsForRole("primary", frameStyle, aspectRatioBehavior),
      };
      return;
    }

    const x = bounds.x + bounds.width - thumbW;
    const y = bounds.y + thumbIdx * (thumbH + pad);
    thumbIdx += 1;
    placements[layerId] = {
      x,
      y,
      width: thumbW,
      height: thumbH,
      zIndex: 200 + thumbIdx,
      visible: true,
      styleAdjustments: frameAdjustmentsForRole("secondary", frameStyle, aspectRatioBehavior),
    };
  });

  return placements;
};

const buildSideBySide = (
  visibleLayerIds: string[],
  mainLayerId: string,
  bounds: Bounds,
  frameStyle: FrameStyleId,
  aspectRatioBehavior: AspectRatioBehavior
) => {
  const placements: Record<string, ComposerPlacement> = {};
  const pad = 18;
  const thumbW = Math.round(bounds.width * 0.17);
  const thumbH = Math.round(thumbW * 0.56);
  const secondary = visibleLayerIds.filter((id) => id !== mainLayerId);
  const secondMain = secondary[0] || null;
  const extras = secondary.slice(1);
  const columnWidth = Math.floor((bounds.width - pad) / 2);

  if (!secondMain) {
    placements[mainLayerId] = {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      zIndex: 100,
      visible: true,
      styleAdjustments: frameAdjustmentsForRole("primary", frameStyle, aspectRatioBehavior),
    };
    return placements;
  }

  placements[mainLayerId] = {
    x: bounds.x,
    y: bounds.y,
    width: columnWidth,
    height: bounds.height,
    zIndex: 100,
    visible: true,
    styleAdjustments: frameAdjustmentsForRole("primary", frameStyle, aspectRatioBehavior),
  };
  placements[secondMain] = {
    x: bounds.x + columnWidth + pad,
    y: bounds.y,
    width: columnWidth,
    height: bounds.height,
    zIndex: 101,
    visible: true,
    styleAdjustments: frameAdjustmentsForRole("secondary", frameStyle, aspectRatioBehavior),
  };

  extras.forEach((layerId, idx) => {
    placements[layerId] = {
      x: bounds.x + bounds.width - thumbW,
      y: bounds.y + idx * (thumbH + pad),
      width: thumbW,
      height: thumbH,
      zIndex: 200 + idx,
      visible: true,
      styleAdjustments: frameAdjustmentsForRole("support", frameStyle, aspectRatioBehavior),
    };
  });

  return placements;
};

const buildPipCorner = (
  visibleLayerIds: string[],
  mainLayerId: string,
  bounds: Bounds,
  frameStyle: FrameStyleId,
  aspectRatioBehavior: AspectRatioBehavior
) => {
  const placements: Record<string, ComposerPlacement> = {};
  const pipW = Math.round(bounds.width * 0.24);
  const pipH = Math.round(pipW * 0.56);
  const pad = 24;

  placements[mainLayerId] = {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    zIndex: 100,
    visible: true,
    styleAdjustments: frameAdjustmentsForRole("primary", frameStyle, aspectRatioBehavior),
  };

  const others = visibleLayerIds.filter((id) => id !== mainLayerId).slice(0, 3);
  others.forEach((layerId, idx) => {
    placements[layerId] = {
      x: bounds.x + bounds.width - pipW,
      y: bounds.y + bounds.height - pipH - idx * (pipH + pad),
      width: pipW,
      height: pipH,
      zIndex: 200 + idx,
      visible: true,
      styleAdjustments: frameAdjustmentsForRole(idx === 0 ? "secondary" : "support", frameStyle, aspectRatioBehavior),
    };
  });

  return placements;
};

const buildGrid2x2 = (
  visibleLayerIds: string[],
  bounds: Bounds,
  frameStyle: FrameStyleId,
  aspectRatioBehavior: AspectRatioBehavior
) => {
  const placements: Record<string, ComposerPlacement> = {};
  const gap = 18;
  const cellW = Math.floor((bounds.width - gap) / 2);
  const cellH = Math.floor((bounds.height - gap) / 2);
  visibleLayerIds.slice(0, 4).forEach((layerId, idx) => {
    const col = idx % 2;
    const row = Math.floor(idx / 2);
    placements[layerId] = {
      x: bounds.x + col * (cellW + gap),
      y: bounds.y + row * (cellH + gap),
      width: cellW,
      height: cellH,
      zIndex: 100 + idx,
      visible: true,
      styleAdjustments: frameAdjustmentsForRole(idx === 0 ? "primary" : "secondary", frameStyle, aspectRatioBehavior),
    };
  });
  return placements;
};

// ── Projector + Speaker ─────────────────────────────────────────────────────
// Left panel  → screen/projector capture (contain, full slide visible)
// Right panel → live camera with floating frame + cover fill (no bars)
const buildProjectorSpeaker = (
  visibleLayerIds: string[],
  mainLayerId: string,
  bounds: Bounds,
  frameStyle: FrameStyleId
) => {
  const placements: Record<string, ComposerPlacement> = {};
  const gap = 14;
  const slideRatio = 0.58;
  const slideW = Math.round(bounds.width * slideRatio);
  const camW = bounds.width - slideW - gap;
  const camX = bounds.x + slideW + gap;
  const camYInset = Math.round(bounds.height * 0.03);
  const secondary = visibleLayerIds.filter((id) => id !== mainLayerId);

  // Slide / projector panel — flat frame, contain so the full slide is always visible
  placements[mainLayerId] = {
    x: bounds.x,
    y: bounds.y,
    width: slideW,
    height: bounds.height,
    zIndex: 100,
    visible: true,
    styleAdjustments: {
      rounded: 10,
      frameStyle: "flat",
      shadowColor: "rgba(15,23,42,0.4)",
      shadowBlur: 14,
      shadowOpacity: 0.12,
      highlightOpacity: 0,
      cardPadding: 0,
      cardBackground: "rgba(0,0,0,0)",
      aspectMode: "contain",
      focusRole: "primary",
    },
  };

  // Primary camera — fill the right panel with no empty bars
  const primaryCam = secondary[0];
  if (primaryCam) {
    placements[primaryCam] = {
      x: camX,
      y: bounds.y + camYInset,
      width: camW,
      height: bounds.height - 2 * camYInset,
      zIndex: 110,
      visible: true,
      styleAdjustments: {
        ...frameAdjustmentsForRole("secondary", frameStyle, "cover"),
        aspectMode: "cover",
      },
    };
  }

  // Extra cameras stacked as small thumbnails at bottom-right
  secondary.slice(1).forEach((layerId, idx) => {
    const thumbH = Math.round(camW * 0.38);
    placements[layerId] = {
      x: camX,
      y: bounds.y + bounds.height - thumbH * (idx + 1) - 10 * (idx + 1),
      width: camW,
      height: thumbH,
      zIndex: 200 + idx,
      visible: true,
      styleAdjustments: {
        ...frameAdjustmentsForRole("support", frameStyle, "cover"),
        aspectMode: "cover",
      },
    };
  });

  return placements;
};

const buildSermonSplit = (
  visibleLayerIds: string[],
  mainLayerId: string,
  bounds: Bounds,
  side: "left" | "right",
  frameStyle: FrameStyleId,
  aspectRatioBehavior: AspectRatioBehavior
) => {
  const placements: Record<string, ComposerPlacement> = {};
  const pad = 20;
  const gap = 18;
  const heroRatio = visibleLayerIds.length > 2 ? 0.61 : 0.64;
  const heroWidth = Math.round(bounds.width * heroRatio);
  const railWidth = Math.max(260, bounds.width - heroWidth - gap);
  const mainOnLeft = side === "left";
  const mainX = mainOnLeft ? bounds.x : bounds.x + railWidth;
  const railX = mainOnLeft ? bounds.x + heroWidth + gap : bounds.x;
  const secondary = visibleLayerIds.filter((id) => id !== mainLayerId);

  placements[mainLayerId] = {
    x: mainX,
    y: bounds.y,
    width: heroWidth - pad,
    height: bounds.height,
    zIndex: 120,
    visible: true,
    styleAdjustments: frameAdjustmentsForRole("primary", frameStyle, aspectRatioBehavior),
  };

  if (!secondary.length) return placements;

  const totalGap = gap * Math.max(secondary.length - 1, 0);
  const railItemHeight = Math.max(160, Math.floor((bounds.height - totalGap) / secondary.length));
  secondary.forEach((layerId, idx) => {
    placements[layerId] = {
      x: railX,
      y: bounds.y + idx * (railItemHeight + gap),
      width: railWidth,
      height: railItemHeight,
      zIndex: 220 + idx,
      visible: true,
      styleAdjustments: frameAdjustmentsForRole(idx === 0 ? "secondary" : "support", frameStyle, aspectRatioBehavior),
    };
  });

  return placements;
};

const createRenderMeta = (input: ComposerLayoutInput): ComposerLayoutRenderMeta => {
  const safeMargins = resolveSafeMargins(input.canvasWidth, input.canvasHeight, input.safeMargins);
  const motionStyle = input.motionStyle || "smooth";
  return {
    themeId: input.themeId || null,
    backgroundStyle: input.backgroundStyle || "gradient_motion",
    frameStyle: input.frameStyle || "floating",
    motionStyle,
    safeMargins,
    aspectRatioBehavior: input.aspectRatioBehavior || "contain",
    defaultMediaFitMode: "contain",
    guides: buildGuides(input.canvasWidth, input.canvasHeight, safeMargins),
    transitionDurationMs: motionStyle === "snappy" ? 220 : motionStyle === "gentle" ? 340 : 280,
    swappedRoles: !!input.swappedRoles,
  };
};

export const computeFreeformSnap = (input: {
  x: number;
  y: number;
  width: number;
  height: number;
  canvasWidth: number;
  canvasHeight: number;
  safeMargins?: LayoutSafeMargins;
  snapThreshold?: number;
}): ComposerSnapResult => {
  const safeMargins = resolveSafeMargins(input.canvasWidth, input.canvasHeight, input.safeMargins);
  const threshold = Math.max(8, input.snapThreshold ?? 22);
  const xCandidates = [
    { x: safeMargins.left, guide: { axis: "x" as const, value: safeMargins.left, kind: "safe" as const } },
    { x: input.canvasWidth / 3 - input.width / 2, guide: { axis: "x" as const, value: input.canvasWidth / 3, kind: "third" as const } },
    { x: input.canvasWidth / 2 - input.width / 2, guide: { axis: "x" as const, value: input.canvasWidth / 2, kind: "center" as const } },
    { x: (input.canvasWidth / 3) * 2 - input.width / 2, guide: { axis: "x" as const, value: (input.canvasWidth / 3) * 2, kind: "third" as const } },
    { x: input.canvasWidth - safeMargins.right - input.width, guide: { axis: "x" as const, value: input.canvasWidth - safeMargins.right, kind: "safe" as const } },
  ];
  const yCandidates = [
    { y: safeMargins.top, guide: { axis: "y" as const, value: safeMargins.top, kind: "safe" as const } },
    { y: input.canvasHeight / 3 - input.height / 2, guide: { axis: "y" as const, value: input.canvasHeight / 3, kind: "third" as const } },
    { y: input.canvasHeight / 2 - input.height / 2, guide: { axis: "y" as const, value: input.canvasHeight / 2, kind: "center" as const } },
    { y: (input.canvasHeight / 3) * 2 - input.height / 2, guide: { axis: "y" as const, value: (input.canvasHeight / 3) * 2, kind: "third" as const } },
    { y: input.canvasHeight - safeMargins.bottom - input.height, guide: { axis: "y" as const, value: input.canvasHeight - safeMargins.bottom, kind: "safe" as const } },
  ];

  let snappedX = input.x;
  let snappedY = input.y;
  let matchedX: ComposerGuide | null = null;
  let matchedY: ComposerGuide | null = null;

  xCandidates.forEach((candidate) => {
    if (Math.abs(candidate.x - input.x) <= threshold && (!matchedX || Math.abs(candidate.x - input.x) < Math.abs(snappedX - input.x))) {
      snappedX = Math.round(candidate.x);
      matchedX = candidate.guide;
    }
  });
  yCandidates.forEach((candidate) => {
    if (Math.abs(candidate.y - input.y) <= threshold && (!matchedY || Math.abs(candidate.y - input.y) < Math.abs(snappedY - input.y))) {
      snappedY = Math.round(candidate.y);
      matchedY = candidate.guide;
    }
  });

  return {
    x: snappedX,
    y: snappedY,
    snappedX: !!matchedX,
    snappedY: !!matchedY,
    guides: [matchedX, matchedY].filter((guide): guide is ComposerGuide => !!guide),
  };
};

export const computeComposerLayout = (input: ComposerLayoutInput): ComposerLayoutResult => {
  const orderedLayerIds = reorderByOverride(input.cameraLayerIds, input.cameraOrderOverride);
  const renderMeta = createRenderMeta(input);

  if (input.layoutTemplate === "freeform") {
    return {
      layoutTemplate: input.layoutTemplate,
      resolvedMainLayerId: resolveMainLayerId(orderedLayerIds, input.selectedMainLayerId, input.swappedRoles),
      placements: {},
      visibleLayerIds: [],
      hiddenLayerIds: [],
      cameraLayerOrder: orderedLayerIds,
      renderMeta,
    };
  }

  const composedLimit = Math.max(1, Math.floor(input.maxComposedCameras || 1));
  const composedLayerIds = orderedLayerIds.slice(0, composedLimit);

  if (composedLayerIds.length === 0) {
    return {
      layoutTemplate: input.layoutTemplate,
      resolvedMainLayerId: null,
      placements: {},
      visibleLayerIds: [],
      hiddenLayerIds: [],
      cameraLayerOrder: orderedLayerIds,
      renderMeta,
    };
  }

  const resolvedMainLayerId = resolveMainLayerId(
    composedLayerIds,
    input.selectedMainLayerId,
    input.swappedRoles
  );
  const placements: Record<string, ComposerPlacement> = {};
  let visibleLayerIds = [...composedLayerIds];
  let hiddenLayerIds = orderedLayerIds.slice(composedLimit);
  const bounds = createWorkingBounds(input.canvasWidth, input.canvasHeight, renderMeta.safeMargins);

  if (input.layoutTemplate === "side_by_side") {
    Object.assign(
      placements,
      buildSideBySide(
        composedLayerIds,
        resolvedMainLayerId as string,
        bounds,
        renderMeta.frameStyle,
        renderMeta.aspectRatioBehavior
      )
    );
  } else if (input.layoutTemplate === "pip_corner") {
    const pipVisible = [resolvedMainLayerId, ...composedLayerIds.filter((id) => id !== resolvedMainLayerId)]
      .filter(Boolean)
      .slice(0, 4) as string[];
    visibleLayerIds = pipVisible;
    hiddenLayerIds = uniq([...hiddenLayerIds, ...composedLayerIds.filter((id) => !pipVisible.includes(id))]);
    Object.assign(
      placements,
      buildPipCorner(
        pipVisible,
        resolvedMainLayerId as string,
        bounds,
        renderMeta.frameStyle,
        renderMeta.aspectRatioBehavior
      )
    );
  } else if (input.layoutTemplate === "grid_2x2") {
    const gridVisible = composedLayerIds.slice(0, 4);
    visibleLayerIds = gridVisible;
    hiddenLayerIds = uniq([...hiddenLayerIds, ...composedLayerIds.slice(4)]);
    Object.assign(
      placements,
      buildGrid2x2(gridVisible, bounds, renderMeta.frameStyle, renderMeta.aspectRatioBehavior)
    );
  } else if (input.layoutTemplate === "speaker_focus") {
    const speakerVisible = [resolvedMainLayerId, ...composedLayerIds.filter((id) => id !== resolvedMainLayerId)]
      .filter(Boolean)
      .slice(0, 2) as string[];
    visibleLayerIds = speakerVisible;
    hiddenLayerIds = uniq([...hiddenLayerIds, ...composedLayerIds.filter((id) => !speakerVisible.includes(id))]);
    Object.assign(
      placements,
      buildPipCorner(
        speakerVisible,
        resolvedMainLayerId as string,
        bounds,
        renderMeta.frameStyle,
        renderMeta.aspectRatioBehavior
      )
    );
  } else if (input.layoutTemplate === "scripture_focus") {
    Object.assign(
      placements,
      buildSermonSplit(
        composedLayerIds,
        resolvedMainLayerId as string,
        bounds,
        "left",
        renderMeta.frameStyle,
        renderMeta.aspectRatioBehavior
      )
    );
  } else if (input.layoutTemplate === "sermon_split_left") {
    Object.assign(
      placements,
      buildSermonSplit(
        composedLayerIds,
        resolvedMainLayerId as string,
        bounds,
        "left",
        renderMeta.frameStyle,
        renderMeta.aspectRatioBehavior
      )
    );
  } else if (input.layoutTemplate === "sermon_split_right") {
    Object.assign(
      placements,
      buildSermonSplit(
        composedLayerIds,
        resolvedMainLayerId as string,
        bounds,
        "right",
        renderMeta.frameStyle,
        renderMeta.aspectRatioBehavior
      )
    );
  } else if (input.layoutTemplate === "projector_speaker") {
    Object.assign(
      placements,
      buildProjectorSpeaker(
        composedLayerIds,
        resolvedMainLayerId as string,
        bounds,
        renderMeta.frameStyle
      )
    );
  } else {
    Object.assign(
      placements,
      buildMainThumbs(
        composedLayerIds,
        resolvedMainLayerId as string,
        bounds,
        renderMeta.frameStyle,
        renderMeta.aspectRatioBehavior
      )
    );
  }

  withHiddenPlacements(placements, hiddenLayerIds);
  clampPlacementsToBounds(placements, bounds);

  return {
    layoutTemplate: input.layoutTemplate,
    resolvedMainLayerId,
    placements,
    visibleLayerIds,
    hiddenLayerIds,
    cameraLayerOrder: orderedLayerIds,
    renderMeta,
  };
};

export type {
  AspectRatioBehavior,
  BackgroundStyleId,
  ComposerLayoutTemplate,
  FrameStyleId,
  LayoutSafeMargins,
  LayoutThemeId,
  MotionStyleId,
} from "./cinematicLayout";
