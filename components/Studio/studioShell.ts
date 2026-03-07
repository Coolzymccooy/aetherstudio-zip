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

export type GlobalScrollNodeSnapshot = {
  id: string;
  maxScrollTop: number;
  scrollTop: number;
};

export type GlobalScrollSegment = {
  id: string;
  start: number;
  end: number;
  span: number;
};

export type GlobalScrollSegments = {
  segments: GlobalScrollSegment[];
  totalScrollable: number;
};

export function buildGlobalScrollSegments(input: {
  nodes: GlobalScrollNodeSnapshot[];
}): GlobalScrollSegments {
  let cursor = 0;
  const segments: GlobalScrollSegment[] = [];

  for (const node of input.nodes || []) {
    const span = Math.max(0, Math.round(node.maxScrollTop || 0));
    if (span <= 0) continue;
    const start = cursor;
    const end = start + span;
    segments.push({
      id: node.id,
      start,
      end,
      span,
    });
    cursor = end;
  }

  return {
    segments,
    totalScrollable: cursor,
  };
}

export function mapGlobalProgressToNodeScrollTop(input: {
  nodes: GlobalScrollNodeSnapshot[];
  segments: GlobalScrollSegments;
  progress: number;
}): Record<string, number> {
  const result: Record<string, number> = {};
  const nodes = input.nodes || [];
  const totalScrollable = Math.max(0, input.segments.totalScrollable || 0);
  const progress = Math.max(0, Math.min(1, Number(input.progress) || 0));
  const targetDistance = totalScrollable * progress;

  for (const node of nodes) {
    result[node.id] = 0;
  }

  if (totalScrollable <= 0) return result;

  for (const segment of input.segments.segments) {
    const value = Math.max(0, Math.min(segment.span, targetDistance - segment.start));
    result[segment.id] = value;
  }

  return result;
}

export function mapGlobalNodeScrollTopToProgress(input: {
  nodes: GlobalScrollNodeSnapshot[];
  segments: GlobalScrollSegments;
}): number {
  const totalScrollable = Math.max(0, input.segments.totalScrollable || 0);
  if (totalScrollable <= 0) return 0;

  const nodeById = new Map<string, GlobalScrollNodeSnapshot>(
    (input.nodes || []).map((node) => [node.id, node])
  );

  let globalDistance = 0;
  for (const segment of input.segments.segments) {
    const node = nodeById.get(segment.id);
    if (!node) continue;
    const local = Math.max(0, Math.min(segment.span, Number(node.scrollTop) || 0));
    globalDistance = Math.max(globalDistance, segment.start + local);
  }

  return Math.max(0, Math.min(1, globalDistance / totalScrollable));
}

export type InputSectionBodyHeights = {
  compact: number;
  standard: number;
  medium: number;
  layoutStudio: number;
};

export function computeInputSectionBodyHeights(input: {
  railHeight: number;
}): InputSectionBodyHeights {
  const railHeight = Math.max(0, Math.round(input.railHeight || 0));
  const usableHeight = Math.max(320, railHeight - 280);

  return {
    compact: Math.max(112, Math.min(Math.round(usableHeight * 0.32), 180)),
    standard: Math.max(148, Math.min(Math.round(usableHeight * 0.42), 248)),
    medium: Math.max(184, Math.min(Math.round(usableHeight * 0.56), 320)),
    layoutStudio: Math.max(240, Math.min(Math.round(usableHeight * 0.8), 460)),
  };
}

export function buildCanvasLayoutRevision(input: {
  rightPanelTab?: string;
  railWidth: number;
  railHeight?: number; // ignored – rail height tracks window height, already captured by viewportHeight
  viewportWidth?: number;
  viewportHeight?: number;
  composerMode?: boolean;
}): string {
  return [
    input.composerMode ? "armed" : "standby",
    `${Math.round(input.railWidth || 0)}`,
    `${Math.round(input.viewportWidth || 0)}x${Math.round(input.viewportHeight || 0)}`,
  ].join(":");
}
