import React from 'react';
import { Layer, SourceType } from '../../types';
import { Sliders, Trash2, Circle, Square, Type, Play, Bold, Maximize, Move, RotateCcw, Sparkles, AlertTriangle, Crop } from 'lucide-react';

interface LayerPropertiesProps {
  layer: Layer | null;
  onUpdate: (id: string, updates: Partial<Layer> | { style: any }) => void;
  onDelete: (id: string) => void;
  isPro?: boolean; // New prop
}

const FONT_OPTIONS = [
  { label: 'Inter (Default)', value: 'Inter' },
  { label: 'Arial', value: 'Arial' },
  { label: 'Helvetica', value: 'Helvetica' },
  { label: 'Times New Roman', value: 'Times New Roman' },
  { label: 'Courier New', value: 'Courier New' },
  { label: 'Impact', value: 'Impact' },
  { label: 'Georgia', value: 'Georgia' },
  { label: 'Verdana', value: 'Verdana' },
];

export const LayerProperties: React.FC<LayerPropertiesProps> = ({ layer, onUpdate, onDelete, isPro = false }) => {
  if (!layer) return (
    <div className="mx-auto h-full w-full max-w-[356px] min-w-0 bg-aether-900 p-6 flex flex-col items-center justify-center text-gray-500 text-center">
      <Sliders size={48} className="mb-4 opacity-20" />
      <p className="text-sm">Select a layer on the canvas to edit its properties.</p>
    </div>
  );

  const updateStyle = (key: string, value: any) => {
    onUpdate(layer.id, {
      style: { ...layer.style, [key]: value }
    });
  };

  const centerLayer = () => {
    // Center based on 1280x720 canvas
    const width = layer.width * (layer.style.scale || 1);
    const height = layer.height * (layer.style.scale || 1);
    onUpdate(layer.id, {
        x: (1280 - width) / 2,
        y: (720 - height) / 2
    });
  };

  const fitToScreen = () => {
    onUpdate(layer.id, {
        x: 0,
        y: 0,
        width: 1280,
        height: 720,
        style: { ...layer.style, scale: 1 }
    });
  };

  return (
    <div className="mx-auto w-full max-w-[356px] min-w-0 bg-aether-900 flex flex-col h-full overflow-hidden">
      <div className="px-3 py-2 border-b border-aether-700 bg-aether-800/50 shrink-0">
        <h3 className="text-sm font-semibold text-white flex items-center justify-between gap-2">
          <span className="truncate">{layer.label}</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-aether-700 text-aether-300 font-mono shrink-0">{layer.type}</span>
        </h3>
      </div>

      <div className="prop-scroll-area flex-1 min-h-0 overflow-y-auto px-3 py-3 space-y-5" style={{ scrollbarWidth: 'thin', scrollbarColor: '#22d3ee #050d18' }}>
        
        {/* --- Layout Controls --- */}
        <div className="space-y-2">
            <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Layout</label>
            <div className="flex gap-1.5">
                <button
                  onClick={fitToScreen}
                  className="flex-1 bg-aether-800 hover:bg-aether-700 text-gray-300 py-1.5 px-1 rounded text-[10px] flex items-center justify-center gap-1 border border-aether-700 transition-colors"
                  title="Fit to Screen"
                >
                    <Maximize size={12} /> Fill
                </button>
                <button
                  onClick={centerLayer}
                  className="flex-1 bg-aether-800 hover:bg-aether-700 text-gray-300 py-1.5 px-1 rounded text-[10px] flex items-center justify-center gap-1 border border-aether-700 transition-colors"
                  title="Center Layer"
                >
                    <Move size={12} /> Center
                </button>
                <button
                  onClick={() => onUpdate(layer.id, { x: 0, y: 0, style: { ...layer.style, scale: 1 } })}
                  className="flex-1 bg-aether-800 hover:bg-aether-700 text-gray-300 py-1.5 px-1 rounded text-[10px] flex items-center justify-center gap-1 border border-aether-700 transition-colors"
                  title="Reset Position"
                >
                    <RotateCcw size={12} /> Reset
                </button>
            </div>

            {/* ── Content Fill Mode (non-text only) ── */}
            {layer.type !== SourceType.TEXT && (() => {
              const mode = layer.style.aspectMode ?? 'contain';
              const slotRatio = layer.width / Math.max(1, layer.height);
              // Flag likely bars: contain mode + slot is notably landscape (camera/screen content is often 16:9 or portrait,
              // and gets letterboxed when placed in a differently-shaped grid cell).
              // Also flag for image layers where contain mode always shows the full image with potential bars.
              const likelyHasBars = mode === 'contain' && (
                layer.type === SourceType.CAMERA ||
                layer.type === SourceType.SCREEN ||
                (layer.type === SourceType.IMAGE && slotRatio > 1.2)
              );
              return (
                <div className="space-y-2 pt-2 border-t border-aether-800">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
                      <Crop size={11} /> Content Fit
                    </span>
                    {likelyHasBars && (
                      <span className="flex items-center gap-1 text-[10px] font-semibold text-amber-400 bg-amber-900/30 border border-amber-500/30 rounded px-2 py-0.5">
                        <AlertTriangle size={10} /> Empty bars detected
                      </span>
                    )}
                  </div>

                  {/* Fit / Fill pill toggle */}
                  <div className="flex rounded-lg overflow-hidden border border-aether-700 text-[11px] font-semibold">
                    <button
                      onClick={() => updateStyle('aspectMode', 'contain')}
                      className={`flex-1 py-1.5 flex items-center justify-center gap-1 transition-colors ${
                        mode === 'contain'
                          ? 'bg-aether-500 text-white'
                          : 'bg-aether-800 text-gray-400 hover:text-gray-200'
                      }`}
                      title="Show full content — empty areas filled with blurred backdrop"
                    >
                      Fit <span className="text-[9px] opacity-60 font-normal hidden sm:inline">full</span>
                    </button>
                    <button
                      onClick={() => updateStyle('aspectMode', 'cover')}
                      className={`flex-1 py-1.5 flex items-center justify-center gap-1 border-l border-aether-700 transition-colors ${
                        mode === 'cover'
                          ? 'bg-cyan-700 text-white'
                          : 'bg-aether-800 text-gray-400 hover:text-gray-200'
                      }`}
                      title="Fill grid slot completely — overflow is cropped"
                    >
                      Fill <span className="text-[9px] opacity-60 font-normal hidden sm:inline">no bars</span>
                    </button>
                  </div>

                  {mode === 'cover' && (
                    <p className="text-[10px] text-cyan-400/70 leading-snug">
                      Slot filled — use <strong>Crop</strong> sliders below to pan the visible area.
                    </p>
                  )}
                  {mode === 'contain' && likelyHasBars && (
                    <p className="text-[10px] text-amber-300/70 leading-snug">
                      Switch to <strong>Fill</strong> to remove empty bar areas.
                    </p>
                  )}
                </div>
              );
            })()}
        </div>

        {/* --- Text Specific Typography Controls --- */}
        {layer.type === SourceType.TEXT && (
           <div className="space-y-4">
             <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Typography</label>
             
             {/* Content */}
             <textarea 
                rows={3}
                value={layer.content || ''}
                onChange={(e) => onUpdate(layer.id, { content: e.target.value })}
                className="w-full bg-aether-800 border border-aether-700 rounded p-2 text-sm text-white focus:border-aether-500 outline-none resize-none"
                placeholder="Enter text..."
             />

             {/* Font Family */}
             <div className="space-y-1">
                <label className="text-xs text-gray-500">Font Family</label>
                <select 
                  value={layer.style.fontFamily || 'Inter'}
                  onChange={(e) => updateStyle('fontFamily', e.target.value)}
                  className="w-full bg-aether-800 border border-aether-700 rounded p-2 text-sm text-gray-200 outline-none"
                >
                  {FONT_OPTIONS.map(f => (
                    <option key={f.value} value={f.value}>{f.label}</option>
                  ))}
                </select>
             </div>

             {/* Font Size & Weight */}
             <div className="flex gap-2">
                <div className="flex-1 space-y-1">
                   <label className="text-xs text-gray-500">Size ({layer.style.fontSize || 48}px)</label>
                   <input
                    type="range"
                    min="12"
                    max="200"
                    value={layer.style.fontSize || 48}
                    onChange={(e) => updateStyle('fontSize', parseInt(e.target.value))}
                    className="w-full h-1.5 bg-aether-800 rounded-lg appearance-none cursor-pointer accent-aether-500"
                  />
                </div>
                <button 
                  onClick={() => updateStyle('fontWeight', layer.style.fontWeight === 'bold' ? 'normal' : 'bold')}
                  className={`p-2 rounded border mt-5 ${layer.style.fontWeight === 'bold' ? 'bg-aether-500 border-aether-400 text-white' : 'bg-aether-800 border-aether-700 text-gray-400'}`}
                  title="Toggle Bold"
                >
                  <Bold size={16} />
                </button>
             </div>

             {/* Color */}
             <div className="flex items-center gap-3 bg-aether-800 p-2 rounded border border-aether-700">
                <input 
                  type="color" 
                  value={layer.style.color || '#ffffff'}
                  onChange={(e) => updateStyle('color', e.target.value)}
                  className="w-8 h-8 rounded cursor-pointer border-none bg-transparent"
                />
                <div className="text-sm font-mono text-gray-400">{layer.style.color || '#ffffff'}</div>
             </div>

             <div className="pt-2 border-t border-aether-800">
               <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-2 mb-2">
                 <Play size={12} /> Ticker Animation
               </label>
               
               <div className="flex items-center justify-between bg-aether-800 p-2 rounded border border-aether-700 mb-2">
                 <span className="text-sm text-gray-300">Enable Scrolling</span>
                 <button 
                    onClick={() => updateStyle('scrolling', !layer.style.scrolling)}
                    className={`w-10 h-5 rounded-full relative transition-colors ${layer.style.scrolling ? 'bg-aether-500' : 'bg-gray-700'}`}
                 >
                    <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all ${layer.style.scrolling ? 'left-6' : 'left-1'}`} />
                 </button>
               </div>

               {layer.style.scrolling && (
                  <div className="space-y-1">
                    <div className="flex justify-between text-xs text-gray-400">
                      <span>Speed</span>
                      <span>{layer.style.scrollSpeed || 2}</span>
                    </div>
                    <input
                      type="range"
                      min="1"
                      max="20"
                      value={layer.style.scrollSpeed || 2}
                      onChange={(e) => updateStyle('scrollSpeed', parseInt(e.target.value))}
                      className="w-full h-1.5 bg-aether-800 rounded-lg appearance-none cursor-pointer accent-aether-500"
                    />
                  </div>
               )}
             </div>
           </div>
        )}

        {/* --- Generic Transform --- */}
        <div className="space-y-2">
           <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Transform</label>
           <div className="space-y-1">
              <div className="flex justify-between text-xs text-gray-400">
                <span>Scale</span>
                <span>{(layer.style.scale || 1).toFixed(1)}x</span>
              </div>
              <input
                type="range"
                min="0.1"
                max="3"
                step="0.1"
                value={layer.style.scale || 1}
                onChange={(e) => updateStyle('scale', parseFloat(e.target.value))}
                className="w-full h-1.5 bg-aether-800 rounded-lg appearance-none cursor-pointer accent-aether-500"
              />
            </div>
        </div>

        {/* --- Shapes (Non-Text) --- */}
        {layer.type !== SourceType.TEXT && (
        <div className="space-y-2">
          <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Shape & Crop</label>
          <div className="grid grid-cols-2 gap-2">
            <button 
              onClick={() => updateStyle('circular', false)}
              className={`p-2 rounded flex flex-col items-center gap-1 border ${!layer.style.circular ? 'bg-aether-500 border-aether-400 text-white' : 'bg-aether-800 border-aether-700 text-gray-400 hover:bg-aether-700'}`}
            >
              <Square size={16} /> <span className="text-[10px]">Rect</span>
            </button>
            <button 
              onClick={() => updateStyle('circular', true)}
              className={`p-2 rounded flex flex-col items-center gap-1 border ${layer.style.circular ? 'bg-aether-500 border-aether-400 text-white' : 'bg-aether-800 border-aether-700 text-gray-400 hover:bg-aether-700'}`}
            >
              <Circle size={16} /> <span className="text-[10px]">Circle</span>
            </button>
          </div>
          
          {!layer.style.circular && (
            <div className="space-y-1">
              <div className="flex justify-between text-xs text-gray-400">
                <span>Corner Radius</span>
                <span>{layer.style.rounded || 0}px</span>
              </div>
              <input
                type="range"
                min="0"
                max="100"
                value={layer.style.rounded || 0}
                onChange={(e) => updateStyle('rounded', parseInt(e.target.value))}
                className="w-full h-1.5 bg-aether-800 rounded-lg appearance-none cursor-pointer accent-aether-500"
              />
            </div>
          )}

          {/* ── Crop Insets ── */}
          <div className="space-y-3 pt-2 border-t border-aether-800">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Crop</span>
              {((layer.style.cropLeft || 0) + (layer.style.cropRight || 0) + (layer.style.cropTop || 0) + (layer.style.cropBottom || 0)) > 0 && (
                <button
                  onClick={() => {
                    updateStyle('cropLeft', 0);
                    updateStyle('cropRight', 0);
                    updateStyle('cropTop', 0);
                    updateStyle('cropBottom', 0);
                  }}
                  className="text-[10px] text-aether-400 hover:text-white px-2 py-0.5 rounded bg-aether-800 border border-aether-700"
                >
                  Reset
                </button>
              )}
            </div>

            {/* Horizontal crop */}
            <div className="space-y-2">
              <div className="text-xs text-gray-500">Horizontal (Left / Right)</div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-gray-500 w-6 text-right">{layer.style.cropLeft || 0}%</span>
                <div className="flex-1 relative h-5 flex items-center">
                  {/* Visual crop bar */}
                  <div className="absolute inset-x-0 h-2 bg-aether-800 rounded-full" />
                  <div
                    className="absolute h-2 bg-aether-500/40 rounded-full"
                    style={{
                      left: `${layer.style.cropLeft || 0}%`,
                      right: `${layer.style.cropRight || 0}%`,
                    }}
                  />
                  <input
                    type="range" min="0" max="49" step="1"
                    value={layer.style.cropLeft || 0}
                    onChange={(e) => updateStyle('cropLeft', parseInt(e.target.value))}
                    className="absolute inset-0 w-full opacity-0 cursor-pointer"
                    title="Crop from Left"
                  />
                </div>
                <span className="text-[10px] text-gray-500 w-6">{layer.style.cropRight || 0}%</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <div className="text-[10px] text-gray-500">Left {layer.style.cropLeft || 0}%</div>
                  <input type="range" min="0" max="49" step="1"
                    value={layer.style.cropLeft || 0}
                    onChange={(e) => updateStyle('cropLeft', parseInt(e.target.value))}
                    className="w-full h-1.5 bg-aether-800 rounded-lg appearance-none cursor-pointer accent-aether-500"
                  />
                </div>
                <div className="space-y-1">
                  <div className="text-[10px] text-gray-500">Right {layer.style.cropRight || 0}%</div>
                  <input type="range" min="0" max="49" step="1"
                    value={layer.style.cropRight || 0}
                    onChange={(e) => updateStyle('cropRight', parseInt(e.target.value))}
                    className="w-full h-1.5 bg-aether-800 rounded-lg appearance-none cursor-pointer accent-aether-500"
                  />
                </div>
              </div>
            </div>

            {/* Vertical crop */}
            <div className="space-y-2">
              <div className="text-xs text-gray-500">Vertical (Top / Bottom)</div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <div className="text-[10px] text-gray-500">Top {layer.style.cropTop || 0}%</div>
                  <input type="range" min="0" max="49" step="1"
                    value={layer.style.cropTop || 0}
                    onChange={(e) => updateStyle('cropTop', parseInt(e.target.value))}
                    className="w-full h-1.5 bg-aether-800 rounded-lg appearance-none cursor-pointer accent-aether-500"
                  />
                </div>
                <div className="space-y-1">
                  <div className="text-[10px] text-gray-500">Bottom {layer.style.cropBottom || 0}%</div>
                  <input type="range" min="0" max="49" step="1"
                    value={layer.style.cropBottom || 0}
                    onChange={(e) => updateStyle('cropBottom', parseInt(e.target.value))}
                    className="w-full h-1.5 bg-aether-800 rounded-lg appearance-none cursor-pointer accent-aether-500"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
        )}

        {/* --- Filters (Camo Style) --- */}
        {(layer.type === SourceType.CAMERA || layer.type === SourceType.IMAGE) && (
          <div className="space-y-2">
            <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Filters</label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { label: 'None', val: '' },
                { label: 'B&W', val: 'grayscale(100%)' },
                { label: 'Sepia', val: 'sepia(80%)' },
                { label: 'Vivid', val: 'saturate(150%) contrast(110%)' },
                { label: 'Cool', val: 'hue-rotate(180deg) saturate(80%)' },
                { label: 'Dim', val: 'brightness(70%)' },
              ].map(opt => (
                <button
                  key={opt.label}
                  onClick={() => updateStyle('filter', opt.val)}
                  className={`text-xs p-2 rounded border ${layer.style.filter === opt.val ? 'bg-aether-500 border-aether-400 text-white' : 'bg-aether-800 border-aether-700 text-gray-400 hover:bg-aether-700'}`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* --- AI Effects (Green Screen - PRO ONLY) --- */}
        {layer.type === SourceType.CAMERA && (
          <div className="space-y-3 border-t border-aether-800 pt-4">
            <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-2">
                <Sparkles size={12} className="text-aether-accent" /> AI Effects
                </label>
                {!isPro && <span className="text-[9px] bg-aether-700 px-1.5 py-0.5 rounded text-aether-300">PRO</span>}
            </div>
            
            <div className={`flex items-center justify-between bg-aether-800 p-2 rounded border ${!isPro ? 'border-aether-700/50 opacity-60 cursor-not-allowed' : 'border-aether-700'}`}>
              <span className="text-sm text-gray-300">Remove Background</span>
              <button 
                disabled={!isPro}
                onClick={() => isPro && onUpdate(layer.id, { backgroundRemoval: !layer.backgroundRemoval } as any)}
                className={`w-10 h-5 rounded-full relative transition-colors ${layer.backgroundRemoval ? 'bg-aether-accent' : 'bg-gray-700'}`}
              >
                <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all ${layer.backgroundRemoval ? 'left-6' : 'left-1'}`} />
              </button>
            </div>
            {!isPro && <p className="text-[10px] text-gray-500 italic">Upgrade license to unlock green screen.</p>}
          </div>
        )}

      </div>

      {/* Sticky footer — always visible regardless of scroll position */}
      <div className="shrink-0 px-3 py-2 border-t border-aether-800 bg-aether-900">
        <button
          onClick={() => onDelete(layer.id)}
          className="w-full flex items-center justify-center gap-2 bg-red-500/10 hover:bg-red-500/20 text-red-500 py-1.5 rounded-lg text-xs font-semibold transition-colors border border-red-500/20"
        >
          <Trash2 size={13} /> Remove Source
        </button>
      </div>
    </div>
  );
};
