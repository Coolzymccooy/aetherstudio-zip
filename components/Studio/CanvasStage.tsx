import React, { useRef, useEffect, useState } from 'react';
import { Layer, SourceType } from '../../types';

interface CanvasStageProps {
  layers: Layer[];
  selectedLayerId: string | null;
  onSelectLayer: (id: string | null) => void;
  onUpdateLayer: (id: string, updates: Partial<Layer>) => void;
  onCanvasReady: (canvas: HTMLCanvasElement) => void;
}

export const CanvasStage: React.FC<CanvasStageProps> = ({ 
  layers, 
  selectedLayerId, 
  onSelectLayer, 
  onUpdateLayer,
  onCanvasReady 
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const requestRef = useRef<number | null>(null);
  const hiddenContainerRef = useRef<HTMLDivElement>(null);
  
  // Manual DOM Management for Video Elements
  const videoElementsRef = useRef<Map<string, HTMLVideoElement>>(new Map());
  
  // State for animations (like text scrolling)
  const scrollOffsetsRef = useRef<Map<string, number>>(new Map());

  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });

  useEffect(() => {
    if (canvasRef.current) {
      onCanvasReady(canvasRef.current);
    }
  }, [onCanvasReady]);

  // --- Video Lifecycle Management ---
  useEffect(() => {
    const container = hiddenContainerRef.current;
    if (!container) return;

    // 1. Identify active video layers
    const activeVideoLayers = layers.filter(l => 
        (l.type === SourceType.CAMERA || l.type === SourceType.SCREEN) && l.src instanceof MediaStream
    );
    const activeIds = new Set(activeVideoLayers.map(l => l.id));

    // 2. Cleanup Removed Sources
    Array.from(videoElementsRef.current.keys()).forEach(id => {
        if (!activeIds.has(id)) {
            const video = videoElementsRef.current.get(id);
            if (video) {
                video.pause();
                video.srcObject = null;
                video.remove();
            }
            videoElementsRef.current.delete(id);
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
            
            // Critical: Set sufficient size so browser doesn't optimize it away
            video.width = 1280;
            video.height = 720;
            
            Object.assign(video.style, {
                position: 'absolute',
                top: '0',
                left: '0',
                width: '1px',
                height: '1px', // Minimal but present
                opacity: '0.01',
                zIndex: '-10',
                pointerEvents: 'none',
            });

            // Re-trigger play on any interruption
            const forcePlay = () => {
                if (video && (video.paused || video.ended)) {
                    video.play().catch(() => {});
                }
            };
            video.addEventListener('loadedmetadata', forcePlay);
            video.addEventListener('canplay', forcePlay);
            video.addEventListener('pause', forcePlay);

            container.appendChild(video);
            videoElementsRef.current.set(layer.id, video);
        }

        // Attach Stream
        if (layer.src instanceof MediaStream) {
            const currentStream = video.srcObject as MediaStream;
            
            // Only reassign if strictly different ID to avoid flickering
            if (!currentStream || currentStream.id !== layer.src.id) {
                console.log(`[Canvas] Updating stream for layer ${layer.id}`);
                video.srcObject = layer.src;
                video.play().catch(console.error);
            } else if (video.paused) {
                video.play().catch(console.error);
            }
        }
    });

  }, [layers]);


  // --- Interaction Handlers ---
  const handleMouseDown = (e: React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    
    const clickX = (e.clientX - rect.left) * scaleX;
    const clickY = (e.clientY - rect.top) * scaleY;

    // Check collision in reverse z-order (top first)
    const clickedLayer = [...layers].sort((a, b) => b.zIndex - a.zIndex).find(layer => {
        if (!layer.visible) return false;
        const width = layer.width * (layer.style.scale || 1);
        const height = layer.height * (layer.style.scale || 1);
        return (
            clickX >= layer.x &&
            clickX <= layer.x + width &&
            clickY >= layer.y &&
            clickY <= layer.y + height
        );
    });

    if (clickedLayer) {
        onSelectLayer(clickedLayer.id);
        setIsDragging(true);
        setDragOffset({ x: clickX - clickedLayer.x, y: clickY - clickedLayer.y });
    } else {
        onSelectLayer(null);
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging || !selectedLayerId) return;
    
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    
    const mouseX = (e.clientX - rect.left) * scaleX;
    const mouseY = (e.clientY - rect.top) * scaleY;

    onUpdateLayer(selectedLayerId, {
        x: mouseX - dragOffset.x,
        y: mouseY - dragOffset.y
    });
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  // --- Main Draw Loop ---
  const draw = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    // 1. Clear & Background
    ctx.fillStyle = '#0f0518';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // 2. Sort layers by zIndex
    const sortedLayers = [...layers].sort((a, b) => a.zIndex - b.zIndex);

    sortedLayers.forEach(layer => {
      if (!layer.visible) return;

      const scale = layer.style.scale || 1;
      const width = layer.width * scale;
      const height = layer.height * scale;

      ctx.save();
      
      // -- Clipping / Rounded Corners --
      ctx.beginPath();
      if (layer.style.circular) {
        ctx.arc(layer.x + width / 2, layer.y + height / 2, Math.min(width, height) / 2, 0, Math.PI * 2);
        ctx.closePath();
        ctx.clip();
      } else if (layer.style.rounded) {
        ctx.roundRect(layer.x, layer.y, width, height, layer.style.rounded);
        ctx.clip();
      }

      // -- Filter Effects --
      if (layer.style.filter) {
        ctx.filter = layer.style.filter;
      }

      // -- Draw Content --
      if (layer.type === SourceType.IMAGE && typeof layer.src === 'string') {
        const img = new Image();
        img.src = layer.src;
        if (img.complete) {
           ctx.drawImage(img, layer.x, layer.y, width, height);
        }
      } else if ((layer.type === SourceType.CAMERA || layer.type === SourceType.SCREEN) && layer.src) {
        
        const videoElement = videoElementsRef.current.get(layer.id);
        
        if (videoElement) {
             // Try to play if paused (aggressive)
             if (videoElement.paused) videoElement.play().catch(() => {});
             
             // Draw frame if available
             if (videoElement.readyState >= 2) {
                 ctx.drawImage(videoElement, layer.x, layer.y, width, height);
             } else {
                 // Draw placeholder/loading state
                 ctx.fillStyle = '#1a0b2e';
                 ctx.fillRect(layer.x, layer.y, width, height);
                 ctx.fillStyle = 'rgba(255,255,255,0.2)';
                 ctx.font = '20px sans-serif';
                 ctx.fillText('Loading Video...', layer.x + 10, layer.y + 30);
             }
        }
      } else if (layer.type === SourceType.TEXT) {
        // --- TEXT STYLING LOGIC ---
        const baseSize = layer.style.fontSize || 48;
        const finalSize = baseSize * scale;
        const family = layer.style.fontFamily || 'Inter';
        const weight = layer.style.fontWeight || 'normal';
        const color = layer.style.color || '#ffffff';
        
        ctx.font = `${weight} ${finalSize}px "${family}"`;
        ctx.fillStyle = color;
        ctx.shadowColor = 'rgba(0,0,0,0.8)';
        ctx.shadowBlur = 4;
        
        const content = layer.content || '';

        if (layer.style.scrolling) {
          // --- SCROLLING TEXT LOGIC ---
          ctx.beginPath();
          ctx.rect(layer.x, layer.y, width, height);
          ctx.clip();

          const speed = layer.style.scrollSpeed || 2;
          let offset = scrollOffsetsRef.current.get(layer.id) || 0;
          
          offset += speed;
          
          const textMetrics = ctx.measureText(content);
          const textWidth = textMetrics.width;
          
          let drawX = layer.x + width - offset;

          if (drawX + textWidth < layer.x) {
             offset = 0; // Reset
             drawX = layer.x + width;
          }
          
          scrollOffsetsRef.current.set(layer.id, offset);
          
          ctx.textBaseline = 'middle';
          ctx.fillText(content, drawX, layer.y + height / 2);
          
        } else {
          // --- STATIC TEXT LOGIC ---
          ctx.fillText(content, layer.x, layer.y + finalSize);
        }
      }

      ctx.restore();

      // -- Selection Highlight --
      if (selectedLayerId === layer.id) {
        ctx.save();
        ctx.strokeStyle = '#d946ef'; 
        ctx.lineWidth = 2;
        
        if (layer.style.circular) {
             ctx.beginPath();
             ctx.arc(layer.x + width / 2, layer.y + height / 2, Math.min(width, height) / 2, 0, Math.PI * 2);
             ctx.stroke();
        } else {
             if (layer.style.rounded) {
                 ctx.beginPath();
                 ctx.roundRect(layer.x, layer.y, width, height, layer.style.rounded);
                 ctx.stroke();
             } else {
                 ctx.strokeRect(layer.x, layer.y, width, height);
             }
        }
        ctx.restore();
      }
    });

    requestRef.current = requestAnimationFrame(draw);
  };

  useEffect(() => {
    requestRef.current = requestAnimationFrame(draw);
    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, [layers, selectedLayerId, isDragging, dragOffset]);

  return (
    <div className="w-full h-full flex items-center justify-center bg-[#05010a] relative shadow-2xl overflow-hidden select-none">
      
      {/* 
         HIDDEN SOURCE CONTAINER 
      */}
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
        width={1920} 
        height={1080}
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