import React, { useEffect, useRef, useState } from 'react';
import { Mic, MicOff, Volume2, VolumeX, Sparkles, Activity, Smartphone, Settings, Headphones, CheckCircle2, AlertTriangle, Zap } from 'lucide-react';
import { AudioTrackConfig } from '../../types';

interface AudioMixerProps {
  tracks: AudioTrackConfig[];
  onUpdateTrack: (id: string, updates: Partial<AudioTrackConfig>) => void;
  onOpenSettings: (trackId: string) => void;
  audioContext: AudioContext | null;
  isLive: boolean;
  masterMonitorVolume: number;
  onUpdateMasterMonitorVolume: (vol: number) => void;
  onOpenDeviceSettings: () => void;
}

interface TrackStats {
  rms: number;           // 0-100
  peak: number;          // 0-100
  peakHold: number;      // 0-100
  voicePower: number;    // 0-100 (Power in 300Hz-3kHz range)
  quality: 'silent' | 'low' | 'optimal' | 'hot' | 'clipping';
}

export const AudioMixer: React.FC<AudioMixerProps> = ({
  tracks,
  onUpdateTrack,
  onOpenSettings,
  audioContext,
  isLive,
  masterMonitorVolume,
  onUpdateMasterMonitorVolume,
  onOpenDeviceSettings
}) => {
  const [stats, setStats] = useState<Record<string, TrackStats>>({});
  const analysersRef = useRef<Map<string, AnalyserNode>>(new Map());
  const peakHoldRef = useRef<Map<string, { val: number, time: number }>>(new Map());
  const rafRef = useRef<number | null>(null);

  // Update analysers using parent AudioContext
  useEffect(() => {
    if (!audioContext) return;
    const currentIds = new Set(tracks.map(t => t.id));

    analysersRef.current.forEach((val, id) => {
      if (!currentIds.has(id)) {
        try { val.disconnect(); } catch { }
        analysersRef.current.delete(id);
        peakHoldRef.current.delete(id);
      }
    });

    tracks.forEach(track => {
      if (track.stream && !analysersRef.current.has(track.id)) {
        try {
          const source = audioContext.createMediaStreamSource(track.stream);
          const analyser = audioContext.createAnalyser();
          analyser.fftSize = 512;
          analyser.smoothingTimeConstant = 0.4;
          source.connect(analyser);
          analysersRef.current.set(track.id, analyser);
        } catch (e) { }
      }
    });
  }, [tracks, audioContext]);

  // High-precision level analysis
  useEffect(() => {
    const timeData = new Float32Array(512);
    const freqData = new Uint8Array(256);

    const analyze = () => {
      const newStats: Record<string, TrackStats> = {};
      const now = performance.now();

      tracks.forEach(track => {
        const analyser = analysersRef.current.get(track.id);
        if (analyser && !track.muted) {

          // 1. Time domain for RMS & Peak
          analyser.getFloatTimeDomainData(timeData);
          let sum = 0;
          let peak = 0;
          for (let i = 0; i < timeData.length; i++) {
            const val = Math.abs(timeData[i]);
            sum += val * val;
            if (val > peak) peak = val;
          }
          const rms = Math.sqrt(sum / timeData.length);

          // 2. Frequency domain for Voice power (300Hz - 3kHz)
          analyser.getByteFrequencyData(freqData);
          // Frequency per bin = sampleRate / fftSize. Assuming 48kHz / 512 = ~93Hz per bin.
          // 300Hz ~ bin 3, 3000Hz ~ bin 32
          let voiceSum = 0;
          for (let i = 3; i < 33; i++) voiceSum += freqData[i];
          const voicePower = (voiceSum / 30) / 255; // Normalized 0-1

          // Map normalized values to 0-100 for meters
          const rmsPct = Math.min(100, rms * 250);
          const peakPct = Math.min(100, peak * 100);

          // Peak Hold Logic
          let ph = peakHoldRef.current.get(track.id) || { val: 0, time: 0 };
          if (peakPct >= ph.val) {
            ph = { val: peakPct, time: now };
          } else if (now - ph.time > 1500) {
            ph.val = Math.max(0, ph.val - 2); // Slow decay
          }
          peakHoldRef.current.set(track.id, ph);

          // Quality Categorization
          let quality: TrackStats['quality'] = 'optimal';
          if (peakPct > 98) quality = 'clipping';
          else if (peakPct > 85) quality = 'hot';
          else if (rmsPct < 5) quality = 'silent';
          else if (rmsPct < 15) quality = 'low';

          newStats[track.id] = {
            rms: rmsPct,
            peak: peakPct,
            peakHold: ph.val,
            voicePower: voicePower * 100,
            quality
          };
        } else {
          newStats[track.id] = { rms: 0, peak: 0, peakHold: 0, voicePower: 0, quality: 'silent' };
        }
      });

      setStats(newStats);
      rafRef.current = requestAnimationFrame(analyze);
    };

    rafRef.current = requestAnimationFrame(analyze);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [tracks]);

  // Master output calculation
  const activeStats = Object.values(stats) as TrackStats[];
  const masterRMS = activeStats.length ? activeStats.reduce((s, t) => s + t.rms, 0) / activeStats.length : 0;
  const masterPeak = activeStats.length ? Math.max(...activeStats.map(t => t.peak)) : 0;

  return (
    <div className="shrink-0 bg-[#0b0816] border-t border-aether-700/50 px-2 pt-1.5 pb-1 overflow-hidden relative" style={{ minHeight: '80px', maxHeight: '108px' }}>
      {/* ── Single-row header ── */}
      <div className="flex items-center gap-2 mb-1.5">
        <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest flex items-center gap-1.5 shrink-0">
          <Activity size={13} className="text-aether-400" /> Audio Signal Center
        </h3>
        <div className={`flex items-center gap-1 px-1.5 py-0.5 rounded border text-[9px] font-bold shrink-0 ${isLive ? 'bg-green-500/10 border-green-500/20 text-green-400' : 'bg-gray-500/10 border-gray-500/20 text-gray-400'}`}>
          {isLive ? <CheckCircle2 size={9} /> : <Activity size={9} />}
          {isLive ? 'LIVE' : 'IDLE'}
        </div>
        {/* Master meter */}
        <div className="flex-1 relative h-2 bg-black/60 rounded-sm overflow-hidden border border-white/5 flex gap-[1px] p-[0.5px] min-w-0">
          {Array.from({ length: 20 }).map((_, i) => {
            const fill = (masterRMS / 100) * 20;
            const active = i < fill;
            const color = i > 17 ? 'bg-red-500' : i > 14 ? 'bg-yellow-400' : 'bg-green-500';
            return <div key={i} className={`flex-1 h-full rounded-[0.5px] transition-all duration-75 ${active ? color : 'bg-gray-900/40'}`} />;
          })}
          <div className="absolute top-0 h-full w-[2px] bg-white/80 transition-all duration-75" style={{ left: `${masterPeak}%` }} />
        </div>
        {/* Monitor vol */}
        <div className="flex items-center gap-1 shrink-0 w-[80px]">
          <Headphones size={10} className="text-gray-500 shrink-0" />
          <input type="range" min="0" max="100" value={masterMonitorVolume}
            onChange={(e) => onUpdateMasterMonitorVolume(parseInt(e.target.value))}
            className="flex-1 h-1 bg-black rounded-lg appearance-none cursor-pointer accent-aether-500" />
          <span className="text-[9px] font-mono text-gray-500 w-5 shrink-0">{masterMonitorVolume}%</span>
        </div>
        <button onClick={onOpenDeviceSettings} className="shrink-0 text-[8px] font-bold text-aether-400 hover:text-white uppercase flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-aether-900/60 border border-aether-700/50">
          <Settings size={9} /> Out
        </button>
        <div className="text-[9px] text-gray-600 font-mono shrink-0 hidden lg:block">48k|24b</div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-1.5 overflow-hidden">
        {tracks.map((track) => {
          const s = stats[track.id] || { rms: 0, peak: 0, peakHold: 0, voicePower: 0, quality: 'silent' };
          const isVoiceActive = s.voicePower > 15;

          // Single flat row: [icon+label+quality] [VU meter] [vol slider] [buttons]
          return (
            <div key={track.id} className={`flex items-center gap-1.5 rounded border px-1.5 py-1 transition-all ${track.monitoring ? 'border-aether-500/50 bg-aether-900/60' : 'border-aether-700/25 bg-aether-900/30'}`}>
              {/* Label + quality dot */}
              <div className="flex items-center gap-1 min-w-0 w-[90px] shrink-0">
                {track.id === 'mobile-mic-track' ? <Smartphone size={9} className="text-blue-400 shrink-0" /> : <Mic size={9} className="text-aether-400 shrink-0" />}
                <span className="text-[9px] font-bold text-white truncate">{track.label}</span>
                <span className={`shrink-0 w-1.5 h-1.5 rounded-full ${
                  s.quality === 'clipping' ? 'bg-red-500 animate-pulse' :
                  s.quality === 'hot' ? 'bg-yellow-400' :
                  s.quality === 'optimal' ? 'bg-green-500' : 'bg-gray-600'
                }`} title={s.quality} />
              </div>
              {/* VU meter */}
              <div className="flex-1 relative h-2 bg-black rounded-[1px] overflow-hidden border border-white/5 flex gap-[0.5px] p-[0.5px] min-w-0">
                {Array.from({ length: 24 }).map((_, i) => {
                  const fill = (s.rms / 100) * 24;
                  const active = i < fill;
                  const color = i > 21 ? 'bg-red-500' : i > 17 ? 'bg-yellow-400' : 'bg-green-500';
                  return <div key={i} className={`flex-1 h-full rounded-[0.5px] transition-all duration-75 ${active ? color : 'bg-gray-950'}`} />;
                })}
                <div className="absolute top-0 h-full w-[1px] bg-white/90 transition-all duration-75" style={{ left: `${s.peakHold}%` }} />
              </div>
              {/* Volume slider */}
              <div className="flex items-center gap-1 w-[52px] shrink-0">
                <input type="range" min="0" max="100" value={track.volume}
                  onChange={(e) => onUpdateTrack(track.id, { volume: parseInt(e.target.value) })}
                  className="flex-1 h-1 bg-black rounded-lg appearance-none cursor-pointer accent-aether-500" />
                <span className="text-[8px] font-mono text-gray-600 w-4 text-right">{track.volume}</span>
              </div>
              {/* Controls */}
              <div className="flex gap-0.5 shrink-0">
                <button onClick={() => onUpdateTrack(track.id, { noiseCancellation: !track.noiseCancellation })}
                  className={`p-0.5 rounded border transition-all ${track.noiseCancellation ? 'bg-purple-500/20 border-purple-500/40 text-purple-300' : 'bg-black/30 border-aether-700/40 text-gray-600 hover:text-gray-400'}`}
                  title="Noise Gate">
                  <Sparkles size={10} />
                </button>
                <button onClick={() => onUpdateTrack(track.id, { monitoring: !track.monitoring })}
                  className={`p-0.5 rounded border transition-all ${track.monitoring ? 'bg-blue-500/20 border-blue-500/40 text-blue-400' : 'bg-black/30 border-aether-700/40 text-gray-600 hover:text-gray-400'}`}
                  title="Monitor">
                  <Headphones size={10} />
                </button>
                <button onClick={() => onUpdateTrack(track.id, { muted: !track.muted })}
                  className={`p-0.5 rounded border transition-all ${track.muted ? 'bg-red-500/20 border-red-500/30 text-red-400' : 'bg-black/30 border-aether-700/40 text-gray-500 hover:text-white'}`}
                  title={track.muted ? 'Unmute' : 'Mute'}>
                  {track.muted ? <MicOff size={10} /> : <Mic size={10} />}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
