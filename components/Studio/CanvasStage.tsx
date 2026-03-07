import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Layer, SourceType } from '../../types';
import { SelfieSegmentation } from "@mediapipe/selfie_segmentation";
import {
  computeFreeformSnap,
  type ComposerGuide,
  type ComposerLayoutRenderMeta,
} from './composerLayout';
import {
  clampLayerPositionToCanvas,
  pickInteractiveLayerAtPoint,
  type InteractiveLayerTarget,
  type Rect,
} from './studioInteraction';
import {
  coerceViewportSize,
  computeCanvasDisplaySize,
  type CanvasViewportSize,
} from './canvasViewport';

interface CanvasStageProps {
  layers: Layer[];
  selectedLayerId: string | null;
  onSelectLayer: (id: string | null) => void;
  onUpdateLayer: (id: string, updates: Partial<Layer>) => void;
  onCanvasReady: (canvas: HTMLCanvasElement) => void;
  isPro: boolean;
  transitionOverlay?: { alpha: number; color: string; type?: 'black' | 'white' };
  cinematicMeta?: ComposerLayoutRenderMeta;
  brandColors?: string[];
  backgroundSourceLayerId?: string | null;
  freeformSnapEnabled?: boolean;
  layoutRevision?: string | number;
}

const DEFAULT_META: ComposerLayoutRenderMeta = {
  backgroundStyle: 'gradient_motion',
  frameStyle: 'floating',
  motionStyle: 'smooth',
  safeMargins: { top: 54, right: 64, bottom: 54, left: 64 },
  aspectRatioBehavior: 'contain',
  defaultMediaFitMode: 'contain',
  guides: [],
  transitionDurationMs: 280,
  swappedRoles: false,
};

const drawRoundRectPath = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
) => {
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, Math.max(0, radius));
};

const drawCoverMedia = (
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  rect: Rect
) => {
  const sourceWidth = (source as HTMLVideoElement).videoWidth || (source as HTMLImageElement).naturalWidth || rect.width;
  const sourceHeight = (source as HTMLVideoElement).videoHeight || (source as HTMLImageElement).naturalHeight || rect.height;
  if (!sourceWidth || !sourceHeight) return;
  const scale = Math.max(rect.width / sourceWidth, rect.height / sourceHeight);
  const drawWidth = sourceWidth * scale;
  const drawHeight = sourceHeight * scale;
  const x = rect.x + (rect.width - drawWidth) / 2;
  const y = rect.y + (rect.height - drawHeight) / 2;
  ctx.drawImage(source, x, y, drawWidth, drawHeight);
};

const drawContainMedia = (
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  rect: Rect
) => {
  const sourceWidth = (source as HTMLVideoElement).videoWidth || (source as HTMLImageElement).naturalWidth || rect.width;
  const sourceHeight = (source as HTMLVideoElement).videoHeight || (source as HTMLImageElement).naturalHeight || rect.height;
  if (!sourceWidth || !sourceHeight) return;
  const scale = Math.min(rect.width / sourceWidth, rect.height / sourceHeight);
  const drawWidth = sourceWidth * scale;
  const drawHeight = sourceHeight * scale;
  const x = rect.x + (rect.width - drawWidth) / 2;
  const y = rect.y + (rect.height - drawHeight) / 2;
  ctx.drawImage(source, x, y, drawWidth, drawHeight);
};

const drawContainedMediaWithBackdrop = (
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  rect: Rect
) => {
  ctx.save();
  ctx.filter = 'blur(20px) brightness(0.52) saturate(0.82)';
  drawCoverMedia(ctx, source, {
    x: rect.x - 14,
    y: rect.y - 14,
    width: rect.width + 28,
    height: rect.height + 28,
  });
  ctx.restore();

  const overlay = ctx.createLinearGradient(rect.x, rect.y, rect.x, rect.y + rect.height);
  overlay.addColorStop(0, 'rgba(5,10,22,0.14)');
  overlay.addColorStop(1, 'rgba(2,6,23,0.36)');
  ctx.fillStyle = overlay;
  ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
  drawContainMedia(ctx, source, rect);
};

// Draws a source with per-side crop insets (0–50, percent of natural dimension).
// When all insets are 0 (default) falls back to standard cover drawing.
const drawCroppedSource = (
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  rect: Rect,
  cropLeft = 0,
  cropRight = 0,
  cropTop = 0,
  cropBottom = 0
) => {
  const nw = (source as HTMLVideoElement).videoWidth || (source as HTMLImageElement).naturalWidth || rect.width;
  const nh = (source as HTMLVideoElement).videoHeight || (source as HTMLImageElement).naturalHeight || rect.height;
  if (!nw || !nh) return;
  const cl = Math.max(0, Math.min(49, cropLeft)) / 100;
  const cr = Math.max(0, Math.min(49, cropRight)) / 100;
  const ct = Math.max(0, Math.min(49, cropTop)) / 100;
  const cb = Math.max(0, Math.min(49, cropBottom)) / 100;
  const sx = cl * nw;
  const sy = ct * nh;
  const sw = nw * (1 - cl - cr);
  const sh = nh * (1 - ct - cb);
  if (sw <= 0 || sh <= 0) return;
  ctx.drawImage(source, sx, sy, sw, sh, rect.x, rect.y, rect.width, rect.height);
};

const easeFactorForMotion = (motionStyle?: ComposerLayoutRenderMeta['motionStyle']) => {
  if (motionStyle === 'snappy') return 0.32;
  if (motionStyle === 'gentle') return 0.14;
  return 0.22;
};

export const CanvasStage: React.FC<CanvasStageProps> = ({
  layers,
  selectedLayerId,
  onSelectLayer,
  onUpdateLayer,
  onCanvasReady,
  isPro,
  transitionOverlay,
  cinematicMeta,
  brandColors,
  backgroundSourceLayerId,
  freeformSnapEnabled,
  layoutRevision,
}) => {
  const safeLayers = Array.isArray(layers) ? layers : [];
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageWrapperRef = useRef<HTMLDivElement>(null);
  const requestRef = useRef<number | null>(null);
  const hiddenContainerRef = useRef<HTMLDivElement>(null);
  const videoElementsRef = useRef<Map<string, HTMLVideoElement>>(new Map());
  const imageElementsRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const animatedRectsRef = useRef<Map<string, Rect>>(new Map());
  const interactiveTargetsRef = useRef<Map<string, InteractiveLayerTarget>>(new Map());
  const grainCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const scrollOffsetsRef = useRef<Map<string, number>>(new Map());
  const slideAnimRef = useRef<Map<string, number>>(new Map());

  const [isDragging, setIsDragging] = useState(false);
  const [activeSnapGuides, setActiveSnapGuides] = useState<ComposerGuide[]>([]);
  const dragOffsetRef = useRef({ x: 0, y: 0 });
  const layersRef = useRef<Layer[]>(safeLayers);
  const selectedLayerIdRef = useRef<string | null>(selectedLayerId);
  const isProRef = useRef<boolean>(isPro);
  const transitionOverlayRef = useRef<typeof transitionOverlay>(transitionOverlay);
  const cinematicMetaRef = useRef<ComposerLayoutRenderMeta>(cinematicMeta || DEFAULT_META);
  const brandColorsRef = useRef<string[]>(brandColors || []);
  const backgroundSourceLayerIdRef = useRef<string | null>(backgroundSourceLayerId || null);
  const freeformSnapEnabledRef = useRef<boolean>(!!freeformSnapEnabled);
  const segmenterRef = useRef<SelfieSegmentation | null>(null);
  const masksRef = useRef<Map<string, ImageBitmap | HTMLCanvasElement>>(new Map());
  const processingRef = useRef<boolean>(false);
  const offscreenCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [viewportSize, setViewportSize] = useState<CanvasViewportSize>({ width: 0, height: 0 });
  const lastValidViewportRef = useRef<CanvasViewportSize>({ width: 0, height: 0 });

  useEffect(() => {
    layersRef.current = safeLayers;
  }, [safeLayers]);

  useEffect(() => {
    selectedLayerIdRef.current = selectedLayerId;
  }, [selectedLayerId]);

  useEffect(() => {
    isProRef.current = isPro;
  }, [isPro]);

  useEffect(() => {
    transitionOverlayRef.current = transitionOverlay;
  }, [transitionOverlay]);

  useEffect(() => {
    cinematicMetaRef.current = cinematicMeta || DEFAULT_META;
  }, [cinematicMeta]);

  useEffect(() => {
    brandColorsRef.current = brandColors || [];
  }, [brandColors]);

  useEffect(() => {
    backgroundSourceLayerIdRef.current = backgroundSourceLayerId || null;
  }, [backgroundSourceLayerId]);

  useEffect(() => {
    freeformSnapEnabledRef.current = !!freeformSnapEnabled;
  }, [freeformSnapEnabled]);

  useEffect(() => {
    if (canvasRef.current) {
      onCanvasReady(canvasRef.current);
    }
  }, [onCanvasReady]);

  const measureViewport = useCallback(() => {
    const wrapper = stageWrapperRef.current;
    if (!wrapper) return;
    const nextViewport = coerceViewportSize(lastValidViewportRef.current, {
      width: wrapper.clientWidth || 0,
      height: wrapper.clientHeight || 0,
    });
    if (nextViewport.width > 0 && nextViewport.height > 0) {
      lastValidViewportRef.current = nextViewport;
    }
    setViewportSize((prev) =>
      prev.width === nextViewport.width && prev.height === nextViewport.height
        ? prev
        : nextViewport
    );
  }, []);

  useEffect(() => {
    measureViewport();
    const wrapper = stageWrapperRef.current;
    if (!wrapper) return;

    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(() => {
        measureViewport();
      });
      resizeObserver.observe(wrapper);
    }

    window.addEventListener("resize", measureViewport);
    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", measureViewport);
    };
  }, [measureViewport]);

  useEffect(() => {
    animatedRectsRef.current.clear();
    interactiveTargetsRef.current.clear();
    setActiveSnapGuides([]);
    measureViewport();
  }, [layoutRevision, measureViewport]);

  useEffect(() => {
    const seg = new SelfieSegmentation({
      locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/${file}`,
    });
    seg.setOptions({ modelSelection: 1 });
    seg.onResults((results) => {
      if (!results.segmentationMask || !processingRef.current) return;
    });
    segmenterRef.current = seg;

    const osc = document.createElement('canvas');
    osc.width = 1280;
    osc.height = 720;
    offscreenCanvasRef.current = osc;

    const grain = document.createElement('canvas');
    grain.width = 180;
    grain.height = 100;
    const grainCtx = grain.getContext('2d');
    if (grainCtx) {
      const imageData = grainCtx.createImageData(grain.width, grain.height);
      for (let i = 0; i < imageData.data.length; i += 4) {
        const v = Math.floor(Math.random() * 255);
        imageData.data[i] = v;
        imageData.data[i + 1] = v;
        imageData.data[i + 2] = v;
        imageData.data[i + 3] = Math.random() > 0.78 ? 26 : 0;
      }
      grainCtx.putImageData(imageData, 0, 0);
    }
    grainCanvasRef.current = grain;
  }, []);

  useEffect(() => {
    const container = hiddenContainerRef.current;
    if (!container) return;

    const activeVideoLayers = safeLayers.filter((layer) =>
      (layer.type === SourceType.CAMERA || layer.type === SourceType.SCREEN) && layer.src instanceof MediaStream
    );
    const activeIds = new Set(activeVideoLayers.map((layer) => layer.id));
    const allLayerIds = new Set(safeLayers.map((layer) => layer.id));

    Array.from(videoElementsRef.current.keys()).forEach((id) => {
      if (!activeIds.has(id)) {
        const video = videoElementsRef.current.get(id);
        if (video) {
          video.pause();
          video.srcObject = null;
          video.remove();
        }
        videoElementsRef.current.delete(id);
        masksRef.current.delete(id);
        animatedRectsRef.current.delete(id);
        interactiveTargetsRef.current.delete(id);
      }
    });

    Array.from(imageElementsRef.current.keys()).forEach((id) => {
      if (!allLayerIds.has(id)) {
        imageElementsRef.current.delete(id);
        interactiveTargetsRef.current.delete(id);
      }
    });

    activeVideoLayers.forEach((layer) => {
      let video = videoElementsRef.current.get(layer.id);
      if (!video) {
        video = document.createElement('video');
        video.muted = true;
        video.autoplay = true;
        video.playsInline = true;
        video.setAttribute('playsinline', '');
        video.setAttribute('webkit-playsinline', '');
        video.width = 1280;
        video.height = 720;
        Object.assign(video.style, {
          position: 'absolute',
          top: '0',
          left: '0',
          width: '1px',
          height: '1px',
          opacity: '0.01',
          zIndex: '-10',
          pointerEvents: 'none',
        });

        const forcePlay = () => {
          if (video && (video.paused || video.ended)) {
            video.play().catch(() => { });
          }
        };
        video.addEventListener('loadedmetadata', forcePlay);
        video.addEventListener('canplay', forcePlay);
        video.addEventListener('pause', forcePlay);
        video.addEventListener('loadedmetadata', () => {
          if (video?.videoWidth && video?.videoHeight) {
            window.dispatchEvent(
              new CustomEvent('aether:video-size', {
                detail: { layerId: layer.id, width: video.videoWidth, height: video.videoHeight },
              })
            );
          }
        });
        container.appendChild(video);
        videoElementsRef.current.set(layer.id, video);
      }

      if (layer.src instanceof MediaStream) {
        const currentStream = video.srcObject as MediaStream;
        if (!currentStream || currentStream.id !== layer.src.id) {
          video.srcObject = layer.src;
          video.play().catch(() => { });
        } else if (video.paused) {
          video.play().catch(() => { });
        }
      }
    });
  }, [safeLayers]);

  useEffect(() => {
    let active = true;
    let lastRun = 0;
    const targetFps = 15;
    const interval = 1000 / targetFps;

    const loop = async (now: number) => {
      if (!active) return;
      if (now - lastRun >= interval) {
        const seg = segmenterRef.current;
        if (seg) {
          const layersToProcess = layersRef.current.filter((layer) =>
            layer.visible && layer.backgroundRemoval && videoElementsRef.current.has(layer.id)
          );

          for (const layer of layersToProcess) {
            const video = videoElementsRef.current.get(layer.id);
            if (video && video.readyState >= 2 && !video.paused) {
              try {
                processingRef.current = true;
                await new Promise<void>((resolve) => {
                  seg.onResults((results) => {
                    if (results.segmentationMask) {
                      const maskCache = document.createElement('canvas');
                      maskCache.width = results.image.width;
                      maskCache.height = results.image.height;
                      const maskCtx = maskCache.getContext('2d');
                      if (maskCtx) {
                        maskCtx.drawImage(results.segmentationMask, 0, 0);
                        masksRef.current.set(layer.id, maskCache);
                      }
                    }
                    resolve();
                  });
                  seg.send({ image: video });
                });
              } catch {
              } finally {
                processingRef.current = false;
              }
            }
          }
        }
        lastRun = now;
      }

      requestAnimationFrame(loop);
    };

    requestAnimationFrame(loop);
    return () => { active = false; };
  }, []);

  const getAnimatedRect = useCallback((layer: Layer) => {
    const style = layer.style || {};
    const target: Rect = {
      x: layer.x,
      y: layer.y,
      width: layer.width * (style.scale || 1),
      height: layer.height * (style.scale || 1),
    };
    const prev = animatedRectsRef.current.get(layer.id);
    const ease = easeFactorForMotion(cinematicMetaRef.current.motionStyle);
    const isActiveDrag = isDragging && selectedLayerIdRef.current === layer.id;
    if (!prev || isActiveDrag) {
      animatedRectsRef.current.set(layer.id, target);
      return target;
    }

    const next: Rect = {
      x: prev.x + (target.x - prev.x) * ease,
      y: prev.y + (target.y - prev.y) * ease,
      width: prev.width + (target.width - prev.width) * ease,
      height: prev.height + (target.height - prev.height) * ease,
    };

    if (
      Math.abs(next.x - target.x) < 0.35 &&
      Math.abs(next.y - target.y) < 0.35 &&
      Math.abs(next.width - target.width) < 0.35 &&
      Math.abs(next.height - target.height) < 0.35
    ) {
      animatedRectsRef.current.set(layer.id, target);
      return target;
    }

    animatedRectsRef.current.set(layer.id, next);
    return next;
  }, [isDragging]);

  const drawCinematicBackground = useCallback((
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    sortedLayers: Layer[]
  ) => {
    const meta = cinematicMetaRef.current || DEFAULT_META;
    const colors = brandColorsRef.current.length ? brandColorsRef.current : ['#0b1020', '#1d0f2e', '#121a40'];
    const now = performance.now();
    const backgroundLayerId = backgroundSourceLayerIdRef.current;
    const videoLayer = (backgroundLayerId
      ? sortedLayers.find((layer) => layer.id === backgroundLayerId)
      : [...sortedLayers].reverse().find((layer) =>
        layer.visible && (layer.type === SourceType.CAMERA || layer.type === SourceType.SCREEN)
      )) || null;
    const video = videoLayer ? videoElementsRef.current.get(videoLayer.id) : null;

    ctx.fillStyle = '#080814';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (meta.backgroundStyle === 'blurred_camera' && video && video.readyState >= 2) {
      ctx.save();
      ctx.filter = 'blur(28px) brightness(0.52) saturate(0.88)';
      drawCoverMedia(ctx, video, { x: -24, y: -24, width: canvas.width + 48, height: canvas.height + 48 });
      ctx.restore();
      const overlay = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
      overlay.addColorStop(0, 'rgba(8,12,24,0.42)');
      overlay.addColorStop(1, 'rgba(2,6,23,0.74)');
      ctx.fillStyle = overlay;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    } else if (meta.backgroundStyle === 'light_studio') {
      const bg = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
      bg.addColorStop(0, '#f6f1ea');
      bg.addColorStop(0.5, '#dce4ef');
      bg.addColorStop(1, '#ced6e4');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      const glow = ctx.createRadialGradient(canvas.width * 0.2, canvas.height * 0.15, 80, canvas.width * 0.2, canvas.height * 0.15, canvas.width * 0.7);
      glow.addColorStop(0, 'rgba(255,255,255,0.85)');
      glow.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    } else {
      const phase = (Math.sin(now / 1800) + 1) / 2;
      const gradient = ctx.createLinearGradient(
        canvas.width * (0.1 + phase * 0.15),
        0,
        canvas.width * (0.9 - phase * 0.15),
        canvas.height
      );
      gradient.addColorStop(0, colors[0] || '#0b1020');
      gradient.addColorStop(0.5, colors[1] || '#1d0f2e');
      gradient.addColorStop(1, colors[2] || '#121a40');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = meta.backgroundStyle === 'brand_wave'
        ? 'rgba(255,255,255,0.03)'
        : 'rgba(15,23,42,0.24)';
      for (let i = 0; i < 3; i += 1) {
        const radius = canvas.width * (0.22 + i * 0.1);
        const x = canvas.width * (0.2 + i * 0.25 + Math.sin(now / (1600 + i * 300)) * 0.03);
        const y = canvas.height * (0.22 + i * 0.2 + Math.cos(now / (2000 + i * 240)) * 0.03);
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    if (grainCanvasRef.current) {
      ctx.save();
      ctx.globalAlpha = meta.backgroundStyle === 'light_studio' ? 0.05 : 0.08;
      const pattern = ctx.createPattern(grainCanvasRef.current, 'repeat');
      if (pattern) {
        ctx.fillStyle = pattern;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      ctx.restore();
    }
  }, []);

  const drawGuides = useCallback((
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    guides: ComposerGuide[],
    activeOnly = false
  ) => {
    if (!guides.length) return;
    guides.forEach((guide) => {
      ctx.save();
      const emphasis = guide.kind === 'center' ? 0.35 : guide.kind === 'safe' ? 0.2 : 0.14;
      ctx.strokeStyle = activeOnly ? 'rgba(56,189,248,0.95)' : `rgba(148,163,184,${emphasis})`;
      ctx.lineWidth = activeOnly ? 1.8 : 1;
      ctx.setLineDash(activeOnly ? [6, 6] : [4, 8]);
      ctx.beginPath();
      if (guide.axis === 'x') {
        ctx.moveTo(guide.value, 0);
        ctx.lineTo(guide.value, canvas.height);
      } else {
        ctx.moveTo(0, guide.value);
        ctx.lineTo(canvas.width, guide.value);
      }
      ctx.stroke();
      ctx.restore();
    });
  }, []);

  const drawFrame = useCallback((
    ctx: CanvasRenderingContext2D,
    rect: Rect,
    layer: Layer
  ) => {
    const style = layer.style || {};
    const frameStyle = style.frameStyle || cinematicMetaRef.current.frameStyle;
    const radius = style.rounded ?? 16;
    const shadowOpacity = style.shadowOpacity ?? (frameStyle === 'flat' ? 0.12 : 0.24);
    const shadowBlur = style.shadowBlur ?? (frameStyle === 'flat' ? 12 : 24);
    const cardBackground = style.cardBackground || (frameStyle === 'glass' ? 'rgba(255,255,255,0.06)' : 'rgba(2,6,23,0.12)');

    ctx.save();
    ctx.shadowColor = `rgba(15,23,42,${shadowOpacity})`;
    ctx.shadowBlur = shadowBlur;
    ctx.shadowOffsetY = frameStyle === 'flat' ? 5 : 12;
    ctx.fillStyle = cardBackground;
    drawRoundRectPath(ctx, rect.x, rect.y, rect.width, rect.height, radius);
    ctx.fill();
    ctx.restore();

    if (frameStyle === 'glass' || frameStyle === 'floating') {
      ctx.save();
      const stroke = ctx.createLinearGradient(rect.x, rect.y, rect.x, rect.y + rect.height);
      stroke.addColorStop(0, `rgba(255,255,255,${style.highlightOpacity ?? 0.24})`);
      stroke.addColorStop(1, 'rgba(255,255,255,0.02)');
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 1.2;
      drawRoundRectPath(ctx, rect.x + 0.5, rect.y + 0.5, rect.width - 1, rect.height - 1, radius);
      ctx.stroke();
      ctx.restore();
    }
  }, []);

  const handleMouseDown = (e: React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const clickX = (e.clientX - rect.left) * scaleX;
    const clickY = (e.clientY - rect.top) * scaleY;

    const sortedLayers = [...layersRef.current].sort((a, b) => a.zIndex - b.zIndex);
    const targets = sortedLayers.map((layer, paintOrder) => {
      const fallbackRect = animatedRectsRef.current.get(layer.id) || {
        x: layer.x,
        y: layer.y,
        width: layer.width * (layer.style.scale || 1),
        height: layer.height * (layer.style.scale || 1),
      };
      return interactiveTargetsRef.current.get(layer.id) || {
        layerId: layer.id,
        zIndex: layer.zIndex,
        paintOrder,
        hitRect: fallbackRect,
        selectable: layer.visible,
      };
    });
    const clickedLayerId = pickInteractiveLayerAtPoint(targets, clickX, clickY);
    const clickedLayer = clickedLayerId
      ? layersRef.current.find((layer) => layer.id === clickedLayerId)
      : undefined;

    if (clickedLayer) {
      const animated = interactiveTargetsRef.current.get(clickedLayer.id)?.hitRect || animatedRectsRef.current.get(clickedLayer.id) || {
        x: clickedLayer.x,
        y: clickedLayer.y,
        width: clickedLayer.width,
        height: clickedLayer.height,
      };
      onSelectLayer(clickedLayer.id);
      setIsDragging(true);
      dragOffsetRef.current = { x: clickX - animated.x, y: clickY - animated.y };
    } else {
      onSelectLayer(null);
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging || !selectedLayerIdRef.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const mouseX = (e.clientX - rect.left) * scaleX;
    const mouseY = (e.clientY - rect.top) * scaleY;

    const layer = layersRef.current.find((entry) => entry.id === selectedLayerIdRef.current);
    const scale = layer?.style?.scale || 1;
    let nextX = mouseX - dragOffsetRef.current.x;
    let nextY = mouseY - dragOffsetRef.current.y;

    if (freeformSnapEnabledRef.current && layer) {
      const snap = computeFreeformSnap({
        x: nextX,
        y: nextY,
        width: layer.width * scale,
        height: layer.height * scale,
        canvasWidth: 1280,
        canvasHeight: 720,
        safeMargins: cinematicMetaRef.current.safeMargins,
      });
      nextX = snap.x;
      nextY = snap.y;
      setActiveSnapGuides(snap.guides);
    }

    if (layer) {
      const clamped = clampLayerPositionToCanvas({
        x: nextX,
        y: nextY,
        width: layer.width * scale,
        height: layer.height * scale,
        canvasWidth: 1280,
        canvasHeight: 720,
      });
      nextX = clamped.x;
      nextY = clamped.y;
    }

    onUpdateLayer(selectedLayerIdRef.current, {
      x: nextX,
      y: nextY,
    });
  };

  const handleMouseUp = () => {
    setIsDragging(false);
    setActiveSnapGuides([]);
  };

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const osc = offscreenCanvasRef.current;
    if (!canvas || !osc) return;
    const ctx = canvas.getContext('2d', { alpha: false });
    const osCtx = osc.getContext('2d', { willReadFrequently: true });
    if (!ctx || !osCtx) return;

    const currentLayers = layersRef.current;
    const currentSelectedLayerId = selectedLayerIdRef.current;
    const currentTransitionOverlay = transitionOverlayRef.current;
    const currentIsPro = isProRef.current;
    const currentMeta = cinematicMetaRef.current || DEFAULT_META;
    const sortedLayers = [...currentLayers].sort((a, b) => a.zIndex - b.zIndex);
    interactiveTargetsRef.current.clear();

    drawCinematicBackground(ctx, canvas, sortedLayers);
    drawGuides(ctx, canvas, currentMeta.guides);
    if (activeSnapGuides.length) {
      drawGuides(ctx, canvas, activeSnapGuides, true);
    }

    sortedLayers.forEach((layer, paintOrder) => {
      if (!layer.visible) return;

      const style = layer.style || {};
      const animated = getAnimatedRect(layer);
      const opacity = style.opacity ?? 1;
      const framePadding = style.frameStyle ? (style.cardPadding ?? 14) : (style.cardPadding ?? 0);
      const frameRect = animated;
      const contentRect: Rect = {
        x: animated.x + framePadding,
        y: animated.y + framePadding,
        width: Math.max(10, animated.width - framePadding * 2),
        height: Math.max(10, animated.height - framePadding * 2),
      };
      interactiveTargetsRef.current.set(layer.id, {
        layerId: layer.id,
        zIndex: layer.zIndex,
        paintOrder,
        hitRect: frameRect,
        selectable: layer.visible && frameRect.width > 0 && frameRect.height > 0,
      });

      ctx.save();
      ctx.globalAlpha = opacity;

      if (layer.type !== SourceType.TEXT && (style.frameStyle || currentMeta.frameStyle !== 'flat')) {
        drawFrame(ctx, frameRect, layer);
      }

      if (layer.type !== SourceType.TEXT) {
        if (style.circular) {
          ctx.beginPath();
          ctx.arc(contentRect.x + contentRect.width / 2, contentRect.y + contentRect.height / 2, Math.min(contentRect.width, contentRect.height) / 2, 0, Math.PI * 2);
          ctx.closePath();
          ctx.clip();
        } else if (style.rounded || style.frameStyle) {
          drawRoundRectPath(ctx, contentRect.x, contentRect.y, contentRect.width, contentRect.height, style.rounded || 16);
          ctx.clip();
        }
      }

      if (style.filter) ctx.filter = style.filter;

      const hasCrop = (style.cropLeft || 0) + (style.cropRight || 0) + (style.cropTop || 0) + (style.cropBottom || 0) > 0;

      if (layer.type === SourceType.IMAGE && typeof layer.src === 'string') {
        let img = imageElementsRef.current.get(layer.id);
        if (!img || img.src !== layer.src) {
          img = new Image();
          img.src = layer.src;
          imageElementsRef.current.set(layer.id, img);
        }
        if (img.complete && img.naturalWidth > 0) {
          if (hasCrop) {
            drawCroppedSource(ctx, img, contentRect, style.cropLeft, style.cropRight, style.cropTop, style.cropBottom);
          } else if ((style.aspectMode || currentMeta.defaultMediaFitMode) === 'contain') {
            drawContainedMediaWithBackdrop(ctx, img, contentRect);
          } else {
            drawCoverMedia(ctx, img, contentRect);
          }
        }
      } else if ((layer.type === SourceType.CAMERA || layer.type === SourceType.SCREEN) && layer.src) {
        const videoElement = videoElementsRef.current.get(layer.id);
        if (videoElement && videoElement.readyState >= 2) {
          if (layer.backgroundRemoval && masksRef.current.has(layer.id)) {
            const mask = masksRef.current.get(layer.id);
            if (mask) {
              osCtx.globalCompositeOperation = 'source-over';
              osCtx.clearRect(0, 0, osc.width, osc.height);
              osCtx.drawImage(mask, 0, 0, osc.width, osc.height);
              osCtx.globalCompositeOperation = 'source-in';
              osCtx.drawImage(videoElement, 0, 0, osc.width, osc.height);
              if (hasCrop) {
                drawCroppedSource(ctx, osc, contentRect, style.cropLeft, style.cropRight, style.cropTop, style.cropBottom);
              } else if ((style.aspectMode || currentMeta.defaultMediaFitMode) === 'contain') {
                drawContainedMediaWithBackdrop(ctx, osc, contentRect);
              } else {
                drawCoverMedia(ctx, osc, contentRect);
              }
            } else if (hasCrop) {
              drawCroppedSource(ctx, videoElement, contentRect, style.cropLeft, style.cropRight, style.cropTop, style.cropBottom);
            } else if ((style.aspectMode || currentMeta.defaultMediaFitMode) === 'contain') {
              drawContainedMediaWithBackdrop(ctx, videoElement, contentRect);
            } else {
              drawCoverMedia(ctx, videoElement, contentRect);
            }
          } else if (hasCrop) {
            drawCroppedSource(ctx, videoElement, contentRect, style.cropLeft, style.cropRight, style.cropTop, style.cropBottom);
          } else if ((style.aspectMode || currentMeta.defaultMediaFitMode) === 'contain') {
            drawContainedMediaWithBackdrop(ctx, videoElement, contentRect);
          } else {
            drawCoverMedia(ctx, videoElement, contentRect);
          }
        } else {
          ctx.fillStyle = '#1a0b2e';
          ctx.fillRect(contentRect.x, contentRect.y, contentRect.width, contentRect.height);
          ctx.fillStyle = 'rgba(255,255,255,0.3)';
          ctx.font = '20px sans-serif';
          ctx.fillText('Loading...', contentRect.x + 14, contentRect.y + 28);
        }
      } else if (layer.type === SourceType.TEXT) {
        const scale = style.scale || 1;
        const baseSize = style.fontSize || 48;
        const finalSize = baseSize * scale;
        const family = style.fontFamily || 'Inter';
        const weight = style.fontWeight || 'normal';
        const color = style.color || '#ffffff';
        const content = layer.content || '';
        const pad = style.bgPadding ?? 0;

        let slideOffsetX = 0;
        if (style.slideIn) {
          let progress = slideAnimRef.current.get(layer.id) ?? 0;
          if (layer.visible) {
            progress = Math.min(1, progress + (style.slideSpeed ?? 60) / 1000);
          } else {
            progress = Math.max(0, progress - (style.slideSpeed ?? 60) / 1000);
          }
          slideAnimRef.current.set(layer.id, progress);
          const eased = 1 - Math.pow(1 - progress, 3);
          slideOffsetX = -(1 - eased) * (animated.width + pad * 2 + 80);
        } else if (layer.visible) {
          slideAnimRef.current.set(layer.id, 1);
        }

        const drawX = animated.x + slideOffsetX;
        const drawY = animated.y;

        if (style.bgColor) {
          const boxX = drawX - pad;
          const boxY = drawY - pad;
          const boxW = animated.width + pad * 2;
          const boxH = animated.height + pad * 2;
          ctx.fillStyle = style.bgColor;
          if (style.bgRounding) {
            drawRoundRectPath(ctx, boxX, boxY, boxW, boxH, style.bgRounding);
            ctx.fill();
          } else {
            ctx.fillRect(boxX, boxY, boxW, boxH);
          }

          if (style.accentColor) {
            const barW = style.accentWidth ?? 4;
            ctx.fillStyle = style.accentColor;
            if (style.bgRounding) {
              drawRoundRectPath(ctx, boxX, boxY, barW, boxH, style.bgRounding);
              ctx.fill();
            } else {
              ctx.fillRect(boxX, boxY, barW, boxH);
            }
          }
        }

        ctx.font = `${weight} ${finalSize}px "${family}"`;
        ctx.fillStyle = color;
        ctx.shadowColor = 'rgba(0,0,0,0.82)';
        ctx.shadowBlur = 4;

        if (style.scrolling) {
          if (!style.bgColor) {
            ctx.fillStyle = 'rgba(0,0,0,0.55)';
            ctx.fillRect(animated.x, animated.y, animated.width, animated.height);
          }
          ctx.beginPath();
          ctx.rect(animated.x, animated.y, animated.width, animated.height);
          ctx.clip();
          ctx.fillStyle = color;
          const speed = style.scrollSpeed || 2;
          let offset = scrollOffsetsRef.current.get(layer.id) || 0;
          offset += speed;
          const textMetrics = ctx.measureText(content);
          let textX = animated.x + animated.width - offset;
          if (textX + textMetrics.width < animated.x) offset = 0;
          scrollOffsetsRef.current.set(layer.id, offset);
          ctx.textBaseline = 'middle';
          ctx.fillText(content, textX, animated.y + animated.height / 2);
        } else {
          ctx.fillText(content, drawX, drawY + finalSize);
        }
      }

      ctx.restore();

      if (currentSelectedLayerId === layer.id) {
        ctx.save();
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 2;
        if (style.circular) {
          ctx.beginPath();
          ctx.arc(frameRect.x + frameRect.width / 2, frameRect.y + frameRect.height / 2, Math.min(frameRect.width, frameRect.height) / 2, 0, Math.PI * 2);
          ctx.stroke();
        } else if (style.rounded || style.frameStyle) {
          drawRoundRectPath(ctx, frameRect.x, frameRect.y, frameRect.width, frameRect.height, style.rounded || 16);
          ctx.stroke();
        } else {
          ctx.strokeRect(frameRect.x, frameRect.y, frameRect.width, frameRect.height);
        }
        ctx.restore();
      }
    });

    if (!currentIsPro) {
      ctx.save();
      const text = "AetherStudio Free";
      ctx.font = "bold 24px Inter, sans-serif";
      ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
      ctx.shadowColor = "rgba(0,0,0,0.8)";
      ctx.shadowBlur = 4;
      const metrics = ctx.measureText(text);
      const pad = 20;
      ctx.fillText(text, canvas.width - metrics.width - pad, canvas.height - pad);
      ctx.restore();
    }

    if (currentTransitionOverlay && currentTransitionOverlay.alpha > 0) {
      ctx.save();
      ctx.globalAlpha = currentTransitionOverlay.alpha;
      ctx.fillStyle = currentTransitionOverlay.color;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.restore();
    }

    requestRef.current = requestAnimationFrame(draw);
  }, [activeSnapGuides, drawCinematicBackground, drawFrame, drawGuides, getAnimatedRect]);

  useEffect(() => {
    requestRef.current = requestAnimationFrame(draw);
    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, [draw]);

  const displaySize =
    computeCanvasDisplaySize(viewportSize) ||
    computeCanvasDisplaySize(lastValidViewportRef.current);

  return (
    <div ref={stageWrapperRef} className="w-full h-full flex items-center justify-center bg-[#05010a] relative shadow-2xl overflow-hidden select-none">
      <div
        ref={hiddenContainerRef}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          overflow: 'hidden',
          zIndex: -1,
          pointerEvents: 'none',
        }}
      />
      <canvas
        ref={canvasRef}
        width={1280}
        height={720}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        style={displaySize ? { width: `${displaySize.width}px`, height: `${displaySize.height}px` } : undefined}
        className="max-w-full max-h-full aspect-video border border-aether-700 bg-aether-900 shadow-2xl cursor-pointer relative z-10"
      />
      <div className="absolute top-4 right-4 bg-cyan-500/10 text-cyan-300 px-3 py-1 rounded-full border border-cyan-400/20 text-xs font-mono pointer-events-none z-20">
        LIVE PREVIEW
      </div>
    </div>
  );
};
