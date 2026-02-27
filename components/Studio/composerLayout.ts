export type ComposerLayoutTemplate =
  | "freeform"
  | "main_thumbs"
  | "grid_2x2"
  | "side_by_side"
  | "pip_corner";

export type ComposerStyleAdjustments = {
  rounded?: number;
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

export type ComposerLayoutInput = {
  layoutTemplate: ComposerLayoutTemplate;
  cameraLayerIds: string[];
  selectedMainLayerId?: string | null;
  cameraOrderOverride?: string[];
  canvasWidth: number;
  canvasHeight: number;
  maxComposedCameras: number;
};

export type ComposerLayoutResult = {
  layoutTemplate: ComposerLayoutTemplate;
  resolvedMainLayerId: string | null;
  placements: Record<string, ComposerPlacement>;
  visibleLayerIds: string[];
  hiddenLayerIds: string[];
  cameraLayerOrder: string[];
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

const resolveMainLayerId = (cameraLayerIds: string[], requested?: string | null) => {
  if (requested && cameraLayerIds.includes(requested)) return requested;
  return cameraLayerIds[0] || null;
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
      styleAdjustments: { rounded: 0 },
    };
  });
};

const buildMainThumbs = (
  visibleLayerIds: string[],
  mainLayerId: string,
  canvasWidth: number,
  canvasHeight: number
) => {
  const placements: Record<string, ComposerPlacement> = {};
  const PAD = 16;
  const THUMB_W = 320;
  const THUMB_H = 180;
  let thumbIdx = 0;

  visibleLayerIds.forEach((layerId) => {
    if (layerId === mainLayerId) {
      placements[layerId] = {
        x: 0,
        y: 0,
        width: canvasWidth,
        height: canvasHeight,
        zIndex: 100,
        visible: true,
        styleAdjustments: { rounded: 0 },
      };
      return;
    }

    const x = canvasWidth - THUMB_W - PAD;
    const y = PAD + thumbIdx * (THUMB_H + PAD);
    thumbIdx += 1;
    placements[layerId] = {
      x,
      y,
      width: THUMB_W,
      height: THUMB_H,
      zIndex: 200 + thumbIdx,
      visible: true,
      styleAdjustments: { rounded: 0 },
    };
  });

  return placements;
};

const buildSideBySide = (
  visibleLayerIds: string[],
  mainLayerId: string,
  canvasWidth: number,
  canvasHeight: number
) => {
  const placements: Record<string, ComposerPlacement> = {};
  const PAD = 16;
  const THUMB_W = 280;
  const THUMB_H = 158;
  const secondary = visibleLayerIds.filter((id) => id !== mainLayerId);
  const secondMain = secondary[0] || null;
  const extras = secondary.slice(1);

  if (!secondMain) {
    placements[mainLayerId] = {
      x: 0,
      y: 0,
      width: canvasWidth,
      height: canvasHeight,
      zIndex: 100,
      visible: true,
      styleAdjustments: { rounded: 0 },
    };
    return placements;
  }

  placements[mainLayerId] = {
    x: 0,
    y: 0,
    width: canvasWidth / 2,
    height: canvasHeight,
    zIndex: 100,
    visible: true,
    styleAdjustments: { rounded: 0 },
  };
  placements[secondMain] = {
    x: canvasWidth / 2,
    y: 0,
    width: canvasWidth / 2,
    height: canvasHeight,
    zIndex: 101,
    visible: true,
    styleAdjustments: { rounded: 0 },
  };

  extras.forEach((layerId, idx) => {
    placements[layerId] = {
      x: canvasWidth - THUMB_W - PAD,
      y: PAD + idx * (THUMB_H + PAD),
      width: THUMB_W,
      height: THUMB_H,
      zIndex: 200 + idx,
      visible: true,
      styleAdjustments: { rounded: 0 },
    };
  });

  return placements;
};

const buildPipCorner = (
  visibleLayerIds: string[],
  mainLayerId: string,
  canvasWidth: number,
  canvasHeight: number
) => {
  const placements: Record<string, ComposerPlacement> = {};
  const PIP_W = 320;
  const PIP_H = 180;
  const PAD = 24;

  placements[mainLayerId] = {
    x: 0,
    y: 0,
    width: canvasWidth,
    height: canvasHeight,
    zIndex: 100,
    visible: true,
    styleAdjustments: { rounded: 0 },
  };

  const others = visibleLayerIds.filter((id) => id !== mainLayerId).slice(0, 3);
  others.forEach((layerId, idx) => {
    placements[layerId] = {
      x: canvasWidth - PIP_W - PAD,
      y: canvasHeight - PIP_H - PAD - idx * (PIP_H + 8),
      width: PIP_W,
      height: PIP_H,
      zIndex: 200 + idx,
      visible: true,
      styleAdjustments: { rounded: 12 },
    };
  });

  return placements;
};

const buildGrid2x2 = (visibleLayerIds: string[], canvasWidth: number, canvasHeight: number) => {
  const placements: Record<string, ComposerPlacement> = {};
  const cellW = canvasWidth / 2;
  const cellH = canvasHeight / 2;
  visibleLayerIds.slice(0, 4).forEach((layerId, idx) => {
    const col = idx % 2;
    const row = Math.floor(idx / 2);
    placements[layerId] = {
      x: col * cellW,
      y: row * cellH,
      width: cellW,
      height: cellH,
      zIndex: 100 + idx,
      visible: true,
      styleAdjustments: { rounded: 0 },
    };
  });
  return placements;
};

export const computeComposerLayout = (input: ComposerLayoutInput): ComposerLayoutResult => {
  const orderedLayerIds = reorderByOverride(input.cameraLayerIds, input.cameraOrderOverride);

  if (input.layoutTemplate === "freeform") {
    return {
      layoutTemplate: input.layoutTemplate,
      resolvedMainLayerId: resolveMainLayerId(orderedLayerIds, input.selectedMainLayerId),
      placements: {},
      visibleLayerIds: [],
      hiddenLayerIds: [],
      cameraLayerOrder: orderedLayerIds,
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
    };
  }

  const resolvedMainLayerId = resolveMainLayerId(composedLayerIds, input.selectedMainLayerId);
  const placements: Record<string, ComposerPlacement> = {};
  let visibleLayerIds = [...composedLayerIds];
  let hiddenLayerIds = orderedLayerIds.slice(composedLimit);

  if (input.layoutTemplate === "side_by_side") {
    Object.assign(
      placements,
      buildSideBySide(
        composedLayerIds,
        resolvedMainLayerId as string,
        input.canvasWidth,
        input.canvasHeight
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
        input.canvasWidth,
        input.canvasHeight
      )
    );
  } else if (input.layoutTemplate === "grid_2x2") {
    const gridVisible = composedLayerIds.slice(0, 4);
    visibleLayerIds = gridVisible;
    hiddenLayerIds = uniq([...hiddenLayerIds, ...composedLayerIds.slice(4)]);
    Object.assign(placements, buildGrid2x2(gridVisible, input.canvasWidth, input.canvasHeight));
  } else {
    Object.assign(
      placements,
      buildMainThumbs(
        composedLayerIds,
        resolvedMainLayerId as string,
        input.canvasWidth,
        input.canvasHeight
      )
    );
  }

  withHiddenPlacements(placements, hiddenLayerIds);

  return {
    layoutTemplate: input.layoutTemplate,
    resolvedMainLayerId,
    placements,
    visibleLayerIds,
    hiddenLayerIds,
    cameraLayerOrder: orderedLayerIds,
  };
};
