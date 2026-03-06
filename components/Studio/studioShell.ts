export type OperatorRailScrollState = {
  overflow: boolean;
  progress: number;
  thumbHeight: number;
  thumbTop: number;
  maxScrollTop: number;
};

export function computeOperatorRailScrollState(input: {
  clientHeight: number;
  scrollHeight: number;
  scrollTop: number;
  trackHeight: number;
  minThumbHeight?: number;
}): OperatorRailScrollState {
  const clientHeight = Math.max(0, input.clientHeight || 0);
  const scrollHeight = Math.max(0, input.scrollHeight || 0);
  const scrollTop = Math.max(0, input.scrollTop || 0);
  const trackHeight = Math.max(0, input.trackHeight || 0);
  const minThumbHeight = Math.max(24, input.minThumbHeight ?? 48);
  const maxScrollTop = Math.max(0, scrollHeight - clientHeight);
  const overflow = maxScrollTop > 1 && trackHeight > 0;

  if (!overflow) {
    return {
      overflow: false,
      progress: 0,
      thumbHeight: trackHeight,
      thumbTop: 0,
      maxScrollTop: 0,
    };
  }

  const visibleRatio = clientHeight / scrollHeight;
  const thumbHeight = Math.min(
    trackHeight,
    Math.max(minThumbHeight, Math.round(trackHeight * visibleRatio))
  );
  const maxThumbTop = Math.max(0, trackHeight - thumbHeight);
  const progress = maxScrollTop <= 0 ? 0 : Math.min(1, scrollTop / maxScrollTop);

  return {
    overflow: true,
    progress,
    thumbHeight,
    thumbTop: Math.round(maxThumbTop * progress),
    maxScrollTop,
  };
}

export function buildCanvasLayoutRevision(input: {
  rightPanelTab: string;
  railWidth: number;
  railHeight: number;
  viewportWidth?: number;
  viewportHeight?: number;
  composerMode?: boolean;
}): string {
  return [
    input.rightPanelTab,
    input.composerMode ? "armed" : "standby",
    `${Math.round(input.railWidth || 0)}x${Math.round(input.railHeight || 0)}`,
    `${Math.round(input.viewportWidth || 0)}x${Math.round(input.viewportHeight || 0)}`,
  ].join(":");
}
