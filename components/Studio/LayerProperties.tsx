import React from 'react';
import { Layer, SourceType } from '../../types';
import { Sliders, Trash2, Circle, Square, Type, Play, Bold, Maximize, Move, RotateCcw, Sparkles } from 'lucide-react';

interface LayerPropertiesProps {
  layer: Layer | null;
  onUpdate: (id: string, updates: Partial<Layer> | { style: any }) => void;
  onDelete: (id: string) => void;
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

export const LayerProperties: React.FC<LayerPropertiesProps> = ({ layer, onUpdate, onDelete }) => {
  if (!layer) return (
    <div className="w-80 bg-aether-900 border-l border-aether-700 p-6 flex flex-col items-center justify-center text-gray-500 text-center">
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
    // Center based on 1920x1080 canvas
    const width = layer.width * (layer.style.scale || 1);
    const height = layer.height * (layer.style.scale || 1);
    onUpdate(layer.id, {
        x: (1920 - width) / 2,
        y: (1080 - height) / 2
    });
  };

  const fitToScreen = () => {
    onUpdate(layer.id, {
        x: 0,
        y: 0,
        width: 1920,
        height: 1080,
        style: { ...layer.style, scale: 1 }
    });
  };

  return (
    <div className="w-80 bg-aether-900 border-l border-aether-700 flex flex-col h-full overflow-y-auto">
      <div className="p-4 border-b border-aether-700 bg-aether-800/50">
        <h3 className="font-semibold text-white flex items-center justify-between">
          <span className="truncate">{layer.label}</span>
          <span className="text-xs px-2 py-0.5 rounded bg-aether-700 text-aether-300 font-mono">{layer.type}</span>
        </h3>
      </div>

      <div className="p-6 space-y-8">
        
        {/* --- Layout Controls (New) --- */}
        <div className="space-y-3">
            <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Layout</label>
            <div className="flex gap-2">
                <button 
                  onClick={fitToScreen}
                  className="flex-1 bg-aether-800 hover:bg-aether-700 text-gray-300 p-2 rounded text-xs flex flex-col items-center gap-1 border border-aether-700 transition-colors"
                  title="Fit to Screen"
                >
                    <Maximize size={16} /> Fill
                </button>
                <button 
                  onClick={centerLayer}
                  className="flex-1 bg-aether-800 hover:bg-aether-700 text-gray-300 p-2 rounded text-xs flex flex-col items-center gap-1 border border-aether-700 transition-colors"
                  title="Center Layer"
                >
                    <Move size={16} /> Center
                </button>
                <button 
                  onClick={() => onUpdate(layer.id, { x: 0, y: 0, style: { ...layer.style, scale: 1 } })}
                  className="flex-1 bg-aether-800 hover:bg-aether-700 text-gray-300 p-2 rounded text-xs flex flex-col items-center gap-1 border border-aether-700 transition-colors"
                  title="Reset Position"
                >
                    <RotateCcw size={16} /> Reset
                </button>
            </div>
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
        <div className="space-y-3">
           <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Transform</label>
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
        <div className="space-y-3">
          <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Shape & Crop</label>
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
        </div>
        )}

        {/* --- Filters (Camo Style) --- */}
        {(layer.type === SourceType.CAMERA || layer.type === SourceType.IMAGE) && (
          <div className="space-y-3">
            <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Filters</label>
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

        {/* --- AI Effects (Green Screen) --- */}
        {layer.type === SourceType.CAMERA && (
          <div className="space-y-3 border-t border-aether-800 pt-4">
            <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-2">
              <Sparkles size={12} className="text-fuchsia-400" /> AI Effects
            </label>
            <div className="flex items-center justify-between bg-aether-800 p-2 rounded border border-aether-700">
              <span className="text-sm text-gray-300">Remove Background</span>
              <button 
                onClick={() => onUpdate(layer.id, { backgroundRemoval: !layer.backgroundRemoval } as any)}
                className={`w-10 h-5 rounded-full relative transition-colors ${layer.backgroundRemoval ? 'bg-fuchsia-500' : 'bg-gray-700'}`}
              >
                <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all ${layer.backgroundRemoval ? 'left-6' : 'left-1'}`} />
              </button>
            </div>
          </div>
        )}

        <div className="pt-6 border-t border-aether-800">
          <button
            onClick={() => onDelete(layer.id)}
            className="w-full flex items-center justify-center gap-2 bg-red-500/10 hover:bg-red-500/20 text-red-500 py-2 rounded-lg text-sm transition-colors border border-red-500/20"
          >
            <Trash2 size={16} /> Remove Source
          </button>
        </div>
      </div>
    </div>
  );
};