import React, { useEffect, useRef, useState } from 'react';
import { Mic, MicOff, Volume2, VolumeX, Sparkles, Activity, Smartphone, Settings, Headphones } from 'lucide-react';
import { AudioTrackConfig } from '../../types';

interface AudioMixerProps {
  tracks: AudioTrackConfig[];
  onUpdateTrack: (id: string, updates: Partial<AudioTrackConfig>) => void;
  onOpenSettings: (trackId: string) => void;
}

export const AudioMixer: React.FC<AudioMixerProps> = ({ tracks, onUpdateTrack, onOpenSettings }) => {
  // Real audio levels using AnalyserNode
  const [levels, setLevels] = useState<Record<string, number>>({});
  const analysersRef = useRef<Map<string, { analyser: AnalyserNode; ctx: AudioContext }>>(new Map());
  const rafRef = useRef<number | null>(null);

  // Create/update analysers for each track that has a stream
  useEffect(() => {
    const currentIds = new Set(tracks.map(t => t.id));

    // Cleanup removed tracks
    analysersRef.current.forEach((val, id) => {
      if (!currentIds.has(id)) {
        try { val.analyser.disconnect(); } catch { }
        analysersRef.current.delete(id);
      }
    });

    // Create analysers for new tracks
    tracks.forEach(track => {
      if (track.stream && !analysersRef.current.has(track.id)) {
        try {
          const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
          const ctx = new AudioCtx();
          const source = ctx.createMediaStreamSource(track.stream);
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 256;
          analyser.smoothingTimeConstant = 0.8;
          source.connect(analyser);
          // Don't connect to destination — monitor only, no feedback
          analysersRef.current.set(track.id, { analyser, ctx });
        } catch (e) {
          // Fallback if stream is unavailable
        }
      }
    });
  }, [tracks]);

  // Read levels from analysers at ~30fps
  useEffect(() => {
    const dataArrays = new Map<string, Float32Array>();

    const readLevels = () => {
      const newLevels: Record<string, number> = {};

      tracks.forEach(track => {
        const entry = analysersRef.current.get(track.id);
        if (entry && !track.muted) {
          let arr = dataArrays.get(track.id);
          if (!arr || arr.length !== entry.analyser.frequencyBinCount) {
            arr = new Float32Array(entry.analyser.frequencyBinCount);
            dataArrays.set(track.id, arr);
          }
          entry.analyser.getFloatTimeDomainData(arr);
          // Calculate RMS for level display
          let sum = 0;
          for (let i = 0; i < arr.length; i++) sum += arr[i] * arr[i];
          const rms = Math.sqrt(sum / arr.length);
          // Convert to 0-100 percentage (mapping ~0.0-0.5 RMS to 0-100)
          const pct = Math.min(100, rms * 200);
          newLevels[track.id] = pct * (track.volume / 100);
        } else {
          newLevels[track.id] = 0;
        }
      });

      setLevels(newLevels);
      rafRef.current = requestAnimationFrame(readLevels);
    };

    // Only start if we have tracks with analysers
    if (tracks.some(t => analysersRef.current.has(t.id))) {
      rafRef.current = requestAnimationFrame(readLevels);
    } else {
      // Fallback: simulate levels for tracks without streams
      const interval = setInterval(() => {
        const fallback: Record<string, number> = {};
        tracks.forEach(t => {
          fallback[t.id] = t.muted ? 0 : (Math.random() * 60 + 20) * (t.volume / 100);
        });
        setLevels(fallback);
      }, 120);
      return () => clearInterval(interval);
    }

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [tracks]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      analysersRef.current.forEach(val => {
        try { val.ctx.close(); } catch { }
      });
      analysersRef.current.clear();
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  // Compute master output level (average of all active tracks)
  const activeTracks = tracks.filter(t => !t.muted);
  const masterLevel = activeTracks.length > 0
    ? activeTracks.reduce((sum, t) => sum + (levels[t.id] || 0), 0) / activeTracks.length
    : 0;

  return (
    <div className="bg-aether-800 border-t border-aether-700 p-4 h-40 md:h-48 overflow-y-auto">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-xs font-semibold text-gray-300 uppercase tracking-wider flex items-center gap-2">
          <Activity size={16} className="text-aether-400" /> Audio Mixer
        </h3>
        <div className="flex items-center gap-3">
          {/* Master Output Monitor */}
          <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-aether-900/60 border border-aether-700/50">
            <Headphones size={13} className="text-aether-400" />
            <div className="relative w-20 h-2 bg-black rounded-sm overflow-hidden border border-white/5">
              <div
                className="absolute top-0 left-0 h-full bg-gradient-to-r from-green-500 via-yellow-400 to-red-500 transition-all duration-75"
                style={{ width: `${masterLevel}%` }}
              />
            </div>
            <span className="text-[9px] font-mono text-gray-500 w-6 text-right">{Math.round(masterLevel)}%</span>
          </div>
          <div className="text-[10px] text-gray-500 font-mono">48kHz Stereo</div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {tracks.map((track) => {
          const level = levels[track.id] || 0;
          // Color coding: green < 60%, yellow 60-85%, red > 85%
          const isClipping = level > 85;
          const isHot = level > 60;

          return (
            <div key={track.id} className="bg-aether-900/50 rounded-lg p-3 border border-aether-700/50 hover:border-aether-600 transition-colors">
              <div className="flex justify-between items-center mb-2">
                <span className="text-xs font-bold text-gray-300 truncate flex items-center gap-2">
                  {track.id === 'mobile-mic-track' ? <Smartphone size={12} className="text-blue-400" /> : <Mic size={12} className="text-aether-400" />}
                  {track.label}
                  {isClipping && <span className="text-[8px] text-red-400 font-mono animate-pulse">CLIP</span>}
                </span>
                <div className="flex gap-1">
                  {track.isMic && (
                    <>
                      <button
                        onClick={() => onOpenSettings(track.id)}
                        className="p-1.5 rounded bg-aether-800 text-gray-400 hover:text-white hover:bg-aether-700 transition-colors"
                        title="Change Input Device"
                      >
                        <Settings size={14} />
                      </button>
                      <button
                        onClick={() => onUpdateTrack(track.id, { noiseCancellation: !track.noiseCancellation })}
                        className={`p-1.5 rounded transition-all flex items-center gap-1 ${track.noiseCancellation
                            ? 'bg-aether-500 text-white shadow-[0_0_10px_rgba(124,58,237,0.5)]'
                            : 'bg-aether-800 text-gray-500 hover:bg-aether-700'
                          }`}
                        title="Toggle AI Noise Cancellation"
                      >
                        <Sparkles size={14} />
                      </button>
                    </>
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
                <div className="relative flex-1 h-2.5 bg-black rounded-sm overflow-hidden border border-white/5">
                  {/* Real Peak Meter */}
                  <div
                    className={`absolute top-0 left-0 h-full transition-all duration-75 ${track.muted ? 'bg-gray-800' :
                        isClipping ? 'bg-gradient-to-r from-green-500 via-yellow-400 to-red-500' :
                          isHot ? 'bg-gradient-to-r from-green-500 via-yellow-400 to-yellow-500' :
                            'bg-gradient-to-r from-green-500 to-green-400'
                      }`}
                    style={{ width: `${track.muted ? 0 : level}%` }}
                  />
                </div>
                <span className="text-[10px] font-mono w-8 text-right text-gray-500">{track.volume}%</span>
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
          );
        })}
      </div>
    </div>
  );
};
