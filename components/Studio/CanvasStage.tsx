import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Layer, SourceType } from '../../types';
import { SelfieSegmentation } from "@mediapipe/selfie_segmentation";

interface CanvasStageProps {
  layers: Layer[];
  selectedLayerId: string | null;
  onSelectLayer: (id: string | null) => void;
  onUpdateLayer: (id: string, updates: Partial<Layer>) => void;
  onCanvasReady: (canvas: HTMLCanvasElement) => void;
  isPro: boolean;
  transitionOverlay?: { alpha: number; color: string; type?: 'black' | 'white' };
}

export const CanvasStage: React.FC<CanvasStageProps> = ({
  layers,
  selectedLayerId,
  onSelectLayer,
  onUpdateLayer,
  onCanvasReady,
  isPro,
  transitionOverlay
}) => {
  const safeLayers = Array.isArray(layers) ? layers : [];
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const requestRef = useRef<number | null>(null);
  const hiddenContainerRef = useRef<HTMLDivElement>(null);

  // Manual DOM Management for Video Elements
  const videoElementsRef = useRef<Map<string, HTMLVideoElement>>(new Map());

  // Persistent image element cache keyed by layerId. Avoids creating a new
  // Image() on every animation frame which causes GC pressure and UI stutter.
  const imageElementsRef = useRef<Map<string, HTMLImageElement>>(new Map());

  // State for animations (like text scrolling)
  const scrollOffsetsRef = useRef<Map<string, number>>(new Map());
  // Slide-in animation progress per layer (0 = off-screen left, 1 = at target position)
  const slideAnimRef = useRef<Map<string, number>>(new Map());

  const [isDragging, setIsDragging] = useState(false);
  const dragOffsetRef = useRef({ x: 0, y: 0 });
  const layersRef = useRef<Layer[]>(safeLayers);
  const selectedLayerIdRef = useRef<string | null>(selectedLayerId);
  const isProRef = useRef<boolean>(isPro);
  const transitionOverlayRef = useRef<typeof transitionOverlay>(transitionOverlay);

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

  // --- AI Segmentation State ---
  const segmenterRef = useRef<SelfieSegmentation | null>(null);
  const masksRef = useRef<Map<string, ImageBitmap | HTMLCanvasElement>>(new Map());
  const processingRef = useRef<boolean>(false);
  const offscreenCanvasRef = useRef<HTMLCanvasElement | null>(null); // For compositing

  useEffect(() => {
    if (canvasRef.current) {
      onCanvasReady(canvasRef.current);
    }
  }, [onCanvasReady]);

  // --- Initialize Segmentation ---
  useEffect(() => {
    const seg = new SelfieSegmentation({
      locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/${file}`,
    });
    seg.setOptions({ modelSelection: 1 }); // 1 = Landscape (faster)

    seg.onResults((results) => {
      if (!results.segmentationMask || !processingRef.current) return;
      // We need to capture this mask. Since we process serially, we check which layer is 'active' in the loop?
      // Actually, we can't easily pass context. 
      // Strategy: The loop sets a ref 'currentLayerId' before sending.
    });

    segmenterRef.current = seg;

    // Create offscreen buffer
    const osc = document.createElement('canvas');
    osc.width = 1280; osc.height = 720; // Match main canvas
    offscreenCanvasRef.current = osc;
  }, []);

  // --- Video Lifecycle Management ---
  useEffect(() => {
    const container = hiddenContainerRef.current;
    if (!container) return;

    // 1. Identify active video layers
    const activeVideoLayers = safeLayers.filter(l =>
      (l.type === SourceType.CAMERA || l.type === SourceType.SCREEN) && l.src instanceof MediaStream
    );
    const activeIds = new Set(activeVideoLayers.map(l => l.id));

    // 2. Cleanup Removed Sources
    const allLayerIds = new Set(safeLayers.map(l => l.id));
    Array.from(videoElementsRef.current.keys()).forEach(id => {
      if (!activeIds.has(id)) {
        const video = videoElementsRef.current.get(id);
        if (video) {
          video.pause();
          video.srcObject = null;
          video.remove();
        }
        videoElementsRef.current.delete(id);
        masksRef.current.delete(id);
      }
    });
    // Cleanup stale image cache entries for removed layers
    Array.from(imageElementsRef.current.keys()).forEach(id => {
      if (!allLayerIds.has(id)) {
        imageElementsRef.current.delete(id);
      }
    });

    // 3. Create/Update Active Sources
    activeVideoLayers.forEach(layer => {
      let video = videoElementsRef.current.get(layer.id);

      if (!video) {
        video = document.createElement('video');
        video.muted = true;
        video.autoplay = true;
        video.playsInline = true;
        video.setAttribute('playsinline', '');
        video.setAttribute('webkit-playsinline', '');

        video.width = 1280; // Optimize for 720p analysis
        video.height = 720;

        Object.assign(video.style, {
          position: 'absolute',
          top: '0',
          left: '0',
          width: '1px', height: '1px', opacity: '0.01', zIndex: '-10', pointerEvents: 'none',
        });

        const forcePlay = () => {
          if (video && (video.paused || video.ended)) {
            video.play().catch(() => { });
          }
        };
        video.addEventListener('loadedmetadata', forcePlay);
        video.addEventListener('canplay', forcePlay);
        video.addEventListener('pause', forcePlay);

        const reportSize = () => {
          const w = video?.videoWidth;
          const h = video?.videoHeight;
          if (w && h) {
            window.dispatchEvent(
              new CustomEvent("aether:video-size", {
                detail: { layerId: layer.id, width: w, height: h }
              })
            );
          }
        };
        video.addEventListener("loadedmetadata", reportSize);
        video.addEventListener("resize", reportSize as any);

        container.appendChild(video);
        videoElementsRef.current.set(layer.id, video);
      }

      if (layer.src instanceof MediaStream) {
        const currentStream = video.srcObject as MediaStream;
        if (!currentStream || currentStream.id !== layer.src.id) {
          video.srcObject = layer.src;
          video.play().catch(console.error);
        } else if (video.paused) {
          video.play().catch(console.error);
        }
      }
    });

  }, [safeLayers]);

  // --- Segmentation Loop (Throttled for Performance) ---
  useEffect(() => {
    let active = true;
    let lastRun = 0;
    const TARGET_FPS = 15; // Limit AI to 15fps to save CPU for encoding
    const INTERVAL = 1000 / TARGET_FPS;

    const loop = async (now: number) => {
      if (!active) return;

      const delta = now - lastRun;

      if (delta >= INTERVAL) {
        const seg = segmenterRef.current;
        if (seg) {
          // Find layers needing segmentation
          const layersToProcess = layersRef.current.filter(l =>
            l.visible &&
            l.backgroundRemoval &&
            videoElementsRef.current.has(l.id)
          );

          for (const layer of layersToProcess) {
            const video = videoElementsRef.current.get(layer.id);
            if (video && video.readyState >= 2 && !video.paused) {
              try {
                await new Promise<void>(resolve => {
                  seg.onResults((results) => {
                    if (results.segmentationMask) {
                      const maskCache = document.createElement('canvas');
                      maskCache.width = results.image.width;
                      maskCache.height = results.image.height;
                      const mCtx = maskCache.getContext('2d');
                      if (mCtx) {
                        mCtx.drawImage(results.segmentationMask, 0, 0);
                        masksRef.current.set(layer.id, maskCache);
                      }
                    }
                    resolve();
                  });
                  seg.send({ image: video });
                });
              } catch (e) { }
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


  // --- Interaction Handlers ---
  const handleMouseDown = (e: React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const clickX = (e.clientX - rect.left) * scaleX;
    const clickY = (e.clientY - rect.top) * scaleY;

    const clickedLayer = [...layersRef.current].sort((a, b) => b.zIndex - a.zIndex).find(layer => {
      if (!layer.visible) return false;
      const width = layer.width * (layer.style.scale || 1);
      const height = layer.height * (layer.style.scale || 1);
      return (clickX >= layer.x && clickX <= layer.x + width && clickY >= layer.y && clickY <= layer.y + height);
    });

    if (clickedLayer) {
      onSelectLayer(clickedLayer.id);
      setIsDragging(true);
      const offset = { x: clickX - clickedLayer.x, y: clickY - clickedLayer.y };
      dragOffsetRef.current = offset;
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
    onUpdateLayer(selectedLayerIdRef.current, {
      x: mouseX - dragOffsetRef.current.x,
      y: mouseY - dragOffsetRef.current.y,
    });
  };

  const handleMouseUp = () => setIsDragging(false);

  // --- Main Draw Loop ---
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const osc = offscreenCanvasRef.current;
    if (!canvas || !osc) return;
    const ctx = canvas.getContext('2d', { alpha: false });
    const osCtx = osc.getContext('2d', { willReadFrequently: true });
    if (!ctx || !osCtx) return;

    // 1. Clear & Background
    ctx.fillStyle = '#0f0518';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // 2. Sort layers
    const currentLayers = layersRef.current;
    const currentSelectedLayerId = selectedLayerIdRef.current;
    const currentTransitionOverlay = transitionOverlayRef.current;
    const currentIsPro = isProRef.current;
    const sortedLayers = [...currentLayers].sort((a, b) => a.zIndex - b.zIndex);

    sortedLayers.forEach(layer => {
      if (!layer.visible) return;

      const style = layer.style || {};
      const scale = style.scale || 1;
      const width = layer.width * scale;
      const height = layer.height * scale;

      ctx.save();

      // -- Clipping / Rounded Corners --
      ctx.beginPath();
      if (style.circular) {
        ctx.arc(layer.x + width / 2, layer.y + height / 2, Math.min(width, height) / 2, 0, Math.PI * 2);
        ctx.closePath();
        ctx.clip();
      } else if (style.rounded) {
        ctx.roundRect(layer.x, layer.y, width, height, style.rounded);
        ctx.clip();
      }

      // -- Filter Effects --
      if (style.filter) ctx.filter = style.filter;

      // -- Draw Content --
      if (layer.type === SourceType.IMAGE && typeof layer.src === 'string') {
        // Use persistent image cache instead of creating new Image() per frame
        let img = imageElementsRef.current.get(layer.id);
        if (!img || img.src !== layer.src) {
          img = new Image();
          img.src = layer.src;
          imageElementsRef.current.set(layer.id, img);
        }
        if (img.complete && img.naturalWidth > 0) ctx.drawImage(img, layer.x, layer.y, width, height);
      } else if ((layer.type === SourceType.CAMERA || layer.type === SourceType.SCREEN) && layer.src) {

        const videoElement = videoElementsRef.current.get(layer.id);

        if (videoElement && videoElement.readyState >= 2) {

          // --- BACKGROUND REMOVAL LOGIC ---
          if (layer.backgroundRemoval && masksRef.current.has(layer.id)) {
            const mask = masksRef.current.get(layer.id);
            if (mask) {
              // Compositing dance:
              // 1. Clear offscreen
              osCtx.globalCompositeOperation = 'source-over';
              osCtx.clearRect(0, 0, osc.width, osc.height);

              // 2. Draw Mask (Grayscale)
              // Scaling mask to video size
              osCtx.drawImage(mask, 0, 0, osc.width, osc.height);

              // 3. Source-In Video (Keeps video only where mask is white)
              osCtx.globalCompositeOperation = 'source-in';
              osCtx.drawImage(videoElement, 0, 0, osc.width, osc.height);

              // 4. Draw result to main canvas
              ctx.drawImage(osc, 0, 0, osc.width, osc.height, layer.x, layer.y, width, height);
            } else {
              ctx.drawImage(videoElement, layer.x, layer.y, width, height);
            }
          } else {
            ctx.drawImage(videoElement, layer.x, layer.y, width, height);
          }

        } else {
          // Placeholder
          ctx.fillStyle = '#1a0b2e';
          ctx.fillRect(layer.x, layer.y, width, height);
          ctx.fillStyle = 'rgba(255,255,255,0.2)';
          ctx.font = '20px sans-serif';
          ctx.fillText('Loading...', layer.x + 10, layer.y + 30);
        }
      } else if (layer.type === SourceType.TEXT) {
        const baseSize = style.fontSize || 48;
        const finalSize = baseSize * scale;
        const family = style.fontFamily || 'Inter';
        const weight = style.fontWeight || 'normal';
        const color = style.color || '#ffffff';
        const content = layer.content || '';
        const pad = style.bgPadding ?? 0;

        // --- Slide-in animation ---
        let slideOffsetX = 0;
        if (style.slideIn) {
          let progress = slideAnimRef.current.get(layer.id) ?? 0;
          if (layer.visible) {
            // Animate in: ease-out from 0 → 1
            progress = Math.min(1, progress + (style.slideSpeed ?? 60) / 1000);
          } else {
            // Animate out
            progress = Math.max(0, progress - (style.slideSpeed ?? 60) / 1000);
          }
          slideAnimRef.current.set(layer.id, progress);
          // Ease-out cubic
          const eased = 1 - Math.pow(1 - progress, 3);
          slideOffsetX = -(1 - eased) * (width + pad * 2 + 80);
        } else if (layer.visible) {
          slideAnimRef.current.set(layer.id, 1);
        }

        const drawX = layer.x + slideOffsetX;
        const drawY = layer.y;

        // --- Background box ---
        if (style.bgColor) {
          const boxX = drawX - pad;
          const boxY = drawY - pad;
          const boxW = width + pad * 2;
          const boxH = height + pad * 2;
          ctx.fillStyle = style.bgColor;
          if (style.bgRounding) {
            ctx.beginPath();
            ctx.roundRect(boxX, boxY, boxW, boxH, style.bgRounding);
            ctx.fill();
          } else {
            ctx.fillRect(boxX, boxY, boxW, boxH);
          }

          // --- Accent bar (left edge) ---
          if (style.accentColor) {
            const barW = style.accentWidth ?? 4;
            ctx.fillStyle = style.accentColor;
            if (style.bgRounding) {
              ctx.beginPath();
              ctx.roundRect(boxX, boxY, barW, boxH, [style.bgRounding, 0, 0, style.bgRounding]);
              ctx.fill();
            } else {
              ctx.fillRect(boxX, boxY, barW, boxH);
            }
          }
        }

        ctx.font = `${weight} ${finalSize}px "${family}"`;
        ctx.fillStyle = color;
        ctx.shadowColor = 'rgba(0,0,0,0.8)';
        ctx.shadowBlur = 4;

        if (style.scrolling) {
          // --- Scrolling ticker ---
          // Draw subtle gradient background strip for ticker
          if (!style.bgColor) {
            ctx.fillStyle = 'rgba(0,0,0,0.55)';
            ctx.fillRect(layer.x, layer.y, width, height);
          }
          ctx.beginPath();
          ctx.rect(layer.x, layer.y, width, height);
          ctx.clip();
          ctx.fillStyle = color;
          const speed = style.scrollSpeed || 2;
          let offset = scrollOffsetsRef.current.get(layer.id) || 0;
          offset += speed;
          const textMetrics = ctx.measureText(content);
          let textX = layer.x + width - offset;
          if (textX + textMetrics.width < layer.x) offset = 0;
          scrollOffsetsRef.current.set(layer.id, offset);
          ctx.textBaseline = 'middle';
          ctx.fillText(content, textX, layer.y + height / 2);
        } else {
          ctx.fillText(content, drawX, drawY + finalSize);
        }
      }

      ctx.restore();

      // -- Selection Highlight --
      if (currentSelectedLayerId === layer.id) {
        ctx.save();
        ctx.strokeStyle = '#d946ef';
        ctx.lineWidth = 2;
        if (style.circular) {
          ctx.beginPath();
          ctx.arc(layer.x + width / 2, layer.y + height / 2, Math.min(width, height) / 2, 0, Math.PI * 2);
          ctx.stroke();
        } else if (style.rounded) {
          ctx.beginPath();
          ctx.roundRect(layer.x, layer.y, width, height, style.rounded);
          ctx.stroke();
        } else {
          ctx.strokeRect(layer.x, layer.y, width, height);
        }
        ctx.restore();
      }
    });

    // --- WATERMARK (Free Version) ---
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
  }, []);

  useEffect(() => {
    requestRef.current = requestAnimationFrame(draw);
    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, [draw]);

  return (
    <div className="w-full h-full flex items-center justify-center bg-[#05010a] relative shadow-2xl overflow-hidden select-none">
      <div
        ref={hiddenContainerRef}
        style={{
          position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', overflow: 'hidden', zIndex: -1, pointerEvents: 'none',
        }}
      />
      <canvas
        ref={canvasRef}
        width={1280} height={720} // Optimized for 720p streaming & AI performance
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        className="max-w-full max-h-full aspect-video border border-aether-700 bg-aether-900 shadow-2xl cursor-pointer relative z-10"
      />
      <div className="absolute top-4 right-4 bg-red-500/10 text-red-500 px-3 py-1 rounded-full border border-red-500/20 text-xs font-mono animate-pulse pointer-events-none z-20">
        LIVE PREVIEW
      </div>
    </div>
  );
};
