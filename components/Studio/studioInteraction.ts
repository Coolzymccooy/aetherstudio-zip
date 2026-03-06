export type Rect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type InteractiveLayerTarget = {
  layerId: string;
  zIndex: number;
  paintOrder: number;
  hitRect: Rect;
  selectable?: boolean;
};

const pointInRect = (x: number, y: number, rect: Rect) =>
  x >= rect.x
  && x <= rect.x + rect.width
  && y >= rect.y
  && y <= rect.y + rect.height;

const rectArea = (rect: Rect) => Math.max(0, rect.width) * Math.max(0, rect.height);

export const pickInteractiveLayerAtPoint = (
  targets: InteractiveLayerTarget[],
  x: number,
  y: number
) => {
  const matches = targets.filter((target) =>
    target.selectable !== false
    && target.hitRect.width > 0
    && target.hitRect.height > 0
    && pointInRect(x, y, target.hitRect)
  );

  if (!matches.length) return null;

  matches.sort((a, b) => {
    if (b.zIndex !== a.zIndex) return b.zIndex - a.zIndex;
    if (b.paintOrder !== a.paintOrder) return b.paintOrder - a.paintOrder;
    return rectArea(a.hitRect) - rectArea(b.hitRect);
  });

  return matches[0]?.layerId || null;
};

export const clampLayerPositionToCanvas = (input: {
  x: number;
  y: number;
  width: number;
  height: number;
  canvasWidth: number;
  canvasHeight: number;
}) => {
  const width = Math.max(1, input.width);
  const height = Math.max(1, input.height);
  const maxX = input.canvasWidth - width;
  const maxY = input.canvasHeight - height;

  return {
    x: maxX >= 0 ? Math.min(Math.max(0, input.x), maxX) : Math.round((input.canvasWidth - width) / 2),
    y: maxY >= 0 ? Math.min(Math.max(0, input.y), maxY) : Math.round((input.canvasHeight - height) / 2),
  };
};

export const resolveComposerMainLayerId = (input: {
  mediaLayerIds: string[];
  composerMainLayerId?: string | null;
  selectedLayerId?: string | null;
}) => {
  const { mediaLayerIds, composerMainLayerId, selectedLayerId } = input;
  if (!mediaLayerIds.length) return null;
  if (composerMainLayerId && mediaLayerIds.includes(composerMainLayerId)) return composerMainLayerId;
  if (selectedLayerId && mediaLayerIds.includes(selectedLayerId)) return selectedLayerId;
  return mediaLayerIds[0] || null;
};

export const resolveProgramLayerId = (input: {
  composerMode: boolean;
  composerMainLayerId?: string | null;
  selectedLayerId?: string | null;
}) => {
  if (input.composerMode && input.composerMainLayerId) return input.composerMainLayerId;
  return input.selectedLayerId || input.composerMainLayerId || null;
};
