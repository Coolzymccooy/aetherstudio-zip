import React, { useEffect, useRef, useState } from 'react';
import { Mic, MicOff, Volume2, VolumeX, Sparkles, Activity, Smartphone } from 'lucide-react';
import { AudioTrackConfig } from '../../types';

interface AudioMixerProps {
  tracks: AudioTrackConfig[];
  onUpdateTrack: (id: string, updates: Partial<AudioTrackConfig>) => void;
}

export const AudioMixer: React.FC<AudioMixerProps> = ({ tracks, onUpdateTrack }) => {
  // Visualizer simulation state
  const [levels, setLevels] = useState<Record<string, number>>({});
  
  useEffect(() => {
    const interval = setInterval(() => {
      const newLevels: Record<string, number> = {};
      tracks.forEach(track => {
        if (track.muted) {
          newLevels[track.id] = 0;
        } else {
          // Simulate audio levels fluctuating
          newLevels[track.id] = Math.random() * 80 + 20;
        }
      });
      setLevels(newLevels);
    }, 100);

    return () => clearInterval(interval);
  }, [tracks]);

  return (
    <div className="bg-aether-800 border-t border-aether-700 p-4 h-48 overflow-y-auto">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wider flex items-center gap-2">
          <Activity size={16} /> Audio Mixer
        </h3>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {tracks.map((track) => (
          <div key={track.id} className="bg-aether-900/50 rounded-lg p-3 border border-aether-700/50">
            <div className="flex justify-between items-center mb-2">
              <span className="text-xs font-medium text-gray-300 truncate flex items-center gap-2">
                  {track.id === 'mobile-mic-track' ? <Smartphone size={12} className="text-blue-400" /> : null}
                  {track.label}
              </span>
              <div className="flex gap-1">
                {track.isMic && (
                  <button
                    onClick={() => onUpdateTrack(track.id, { noiseCancellation: !track.noiseCancellation })}
                    className={`p-1.5 rounded transition-all flex items-center gap-1 ${
                      track.noiseCancellation 
                        ? 'bg-aether-500 text-white shadow-[0_0_10px_rgba(124,58,237,0.5)]' 
                        : 'bg-aether-800 text-gray-500 hover:bg-aether-700'
                    }`}
                    title="Toggle AI Noise Cancellation"
                  >
                    <Sparkles size={14} />
                    {track.noiseCancellation && <span className="text-[9px] font-bold">ON</span>}
                  </button>
                )}
                <button
                  onClick={() => onUpdateTrack(track.id, { muted: !track.muted })}
                  className={`p-1.5 rounded transition-colors ${track.muted ? 'bg-red-500/20 text-red-400' : 'bg-aether-800 text-gray-400 hover:bg-aether-700'}`}
                >
                  {track.muted ? <MicOff size={14} /> : <Mic size={14} />}
                </button>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="relative flex-1 h-2 bg-aether-900 rounded-full overflow-hidden">
                {/* Visualizer Bar */}
                <div 
                  className={`absolute top-0 left-0 h-full transition-all duration-75 ${track.muted ? 'bg-gray-700' : 'bg-gradient-to-r from-green-400 to-aether-500'}`}
                  style={{ width: `${track.muted ? 0 : (levels[track.id] || 0) * (track.volume / 100)}%` }}
                />
              </div>
              <span className="text-xs w-8 text-right text-gray-500">{track.volume}%</span>
            </div>
            
            <input
              type="range"
              min="0"
              max="100"
              value={track.volume}
              onChange={(e) => onUpdateTrack(track.id, { volume: parseInt(e.target.value) })}
              className="w-full mt-2 h-1 bg-aether-700 rounded-lg appearance-none cursor-pointer accent-aether-500"
            />
          </div>
        ))}
      </div>
    </div>
  );
};