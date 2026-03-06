export type CanvasViewportSize = {
  width: number;
  height: number;
};

export function coerceViewportSize(
  previous: CanvasViewportSize,
  next: Partial<CanvasViewportSize> | null | undefined
): CanvasViewportSize {
  const width = Math.max(0, Math.floor(next?.width || 0));
  const height = Math.max(0, Math.floor(next?.height || 0));

  if (width > 0 && height > 0) {
    return { width, height };
  }

  return previous;
}

export function computeCanvasDisplaySize(
  viewport: CanvasViewportSize,
  aspectRatio = 1280 / 720
): CanvasViewportSize | null {
  const maxWidth = Math.max(0, viewport.width || 0);
  const maxHeight = Math.max(0, viewport.height || 0);
  if (!maxWidth || !maxHeight) return null;

  let width = maxWidth;
  let height = width / aspectRatio;
  if (height > maxHeight) {
    height = maxHeight;
    width = height * aspectRatio;
  }

  return {
    width: Math.max(1, Math.floor(width)),
    height: Math.max(1, Math.floor(height)),
  };
}
