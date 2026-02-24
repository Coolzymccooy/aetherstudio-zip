import React, { useEffect, useRef, useState } from 'react';
import { Mic, MicOff, Volume2, VolumeX, Sparkles, Activity, Smartphone, Settings, Headphones, CheckCircle2, AlertTriangle, Zap } from 'lucide-react';
import { AudioTrackConfig } from '../../types';

interface AudioMixerProps {
  tracks: AudioTrackConfig[];
  onUpdateTrack: (id: string, updates: Partial<AudioTrackConfig>) => void;
  onOpenSettings: (trackId: string) => void;
  audioContext: AudioContext | null;
  isLive: boolean;
}

interface TrackStats {
  rms: number;           // 0-100
  peak: number;          // 0-100
  peakHold: number;      // 0-100
  voicePower: number;    // 0-100 (Power in 300Hz-3kHz range)
  quality: 'silent' | 'low' | 'optimal' | 'hot' | 'clipping';
}

export const AudioMixer: React.FC<AudioMixerProps> = ({ tracks, onUpdateTrack, onOpenSettings, audioContext, isLive }) => {
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
    <div className="bg-[#0b0816] border-t border-aether-700/50 p-4 h-48 md:h-56 overflow-y-auto">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-4">
          <h3 className="text-xs font-bold text-gray-300 uppercase tracking-widest flex items-center gap-2">
            <Activity size={16} className="text-aether-400" /> Audio Signal Center
          </h3>
          <div className={`flex items-center gap-2 px-2.5 py-1 rounded border text-[10px] font-bold transition-all ${isLive ? 'bg-green-500/10 border-green-500/20 text-green-400' : 'bg-gray-500/10 border-gray-500/20 text-gray-400'}`}>
            {isLive ? <CheckCircle2 size={12} /> : <Activity size={12} />}
            {isLive ? 'STREAM FEED ACTIVE' : 'MONITORING IDLE'}
          </div>
        </div>

        <div className="flex items-center gap-6">
          {/* Master Output Meter */}
          <div className="flex flex-col items-end gap-1">
            <div className="flex items-center gap-2">
              <span className="text-[9px] text-gray-500 font-bold uppercase tracking-tighter">Master Out</span>
              <Headphones size={13} className="text-aether-400" />
            </div>
            <div className="relative w-40 h-3 bg-black/60 rounded-sm overflow-hidden border border-white/5 flex gap-[1px] p-[1px]">
              {Array.from({ length: 20 }).map((_, i) => {
                const fill = (masterRMS / 100) * 20;
                const active = i < fill;
                const color = i > 17 ? 'bg-red-500' : i > 14 ? 'bg-yellow-400' : 'bg-green-500';
                return <div key={i} className={`flex-1 h-full rounded-[1px] transition-all duration-75 ${active ? color : 'bg-gray-900/40'}`} />;
              })}
              {/* Peak Tick */}
              <div className="absolute top-0 h-full w-[2px] bg-white/80 transition-all duration-75" style={{ left: `${masterPeak}%` }} />
            </div>
          </div>
          <div className="text-[10px] text-gray-500 font-mono bg-black/30 px-2 py-1 rounded">SSL 48kHz | 24-bit</div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {tracks.map((track) => {
          const s = stats[track.id] || { rms: 0, peak: 0, peakHold: 0, voicePower: 0, quality: 'silent' };
          const isVoiceActive = s.voicePower > 15;

          return (
            <div key={track.id} className="bg-aether-900/40 rounded-xl p-3 border border-aether-700/30 hover:border-aether-500/40 transition-all group">
              <div className="flex justify-between items-start mb-2.5">
                <div className="flex flex-col gap-0.5 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-white truncate flex items-center gap-1.5">
                      {track.id === 'mobile-mic-track' ? <Smartphone size={12} className="text-blue-400" /> : <Mic size={12} className="text-aether-400" />}
                      {track.label}
                    </span>
                    {s.quality === 'clipping' && <span className="bg-red-500 text-white text-[8px] px-1 rounded font-black animate-pulse">CLIP</span>}
                  </div>

                  {/* Quality & Voice Indicators */}
                  <div className="flex items-center gap-2">
                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-tighter ${s.quality === 'optimal' ? 'text-green-400 bg-green-400/10' :
                      s.quality === 'hot' ? 'text-yellow-400 bg-yellow-400/10' :
                        s.quality === 'clipping' ? 'text-red-400 bg-red-400/10' :
                          'text-gray-500 bg-gray-500/10'
                      }`}>
                      {s.quality === 'optimal' ? 'Signal: Great' : s.quality === 'hot' ? 'Signal: Hot' : s.quality === 'clipping' ? 'Distorted' : 'Signal: Low'}
                    </span>
                    <div className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold transition-all ${isVoiceActive ? 'text-blue-400 bg-blue-400/10' : 'text-gray-600'}`}>
                      <Zap size={8} /> {isVoiceActive ? 'SPEECH DETECTED' : 'NO VOICE'}
                    </div>
                  </div>
                </div>

                <div className="flex gap-1 shrink-0">
                  <button onClick={() => onUpdateTrack(track.id, { noiseCancellation: !track.noiseCancellation })}
                    className={`p-1.5 rounded-lg border transition-all ${track.noiseCancellation ? 'bg-aether-500 border-aether-400 text-white shadow-lg' : 'bg-black/30 border-aether-700/50 text-gray-500 hover:text-gray-300'
                      }`} title="Voice Clarity Engine">
                    <Sparkles size={14} />
                  </button>
                  <button onClick={() => onUpdateTrack(track.id, { muted: !track.muted })}
                    className={`p-1.5 rounded-lg border transition-all ${track.muted ? 'bg-red-500/20 border-red-500/30 text-red-500' : 'bg-black/30 border-aether-700/50 text-gray-500 hover:text-white'}`}>
                    {track.muted ? <MicOff size={14} /> : <Mic size={14} />}
                  </button>
                </div>
              </div>

              {/* Segmented VU Meter */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <div className="flex-1 relative h-3 bg-black rounded-sm overflow-hidden border border-white/5 flex gap-[1px] p-[1px]">
                    {Array.from({ length: 40 }).map((_, i) => {
                      const fill = (s.rms / 100) * 40;
                      const active = i < fill;
                      const color = i > 35 ? 'bg-red-500' : i > 28 ? 'bg-yellow-400' : i > 15 ? 'bg-green-500' : 'bg-green-600/60';
                      return <div key={i} className={`flex-1 h-full rounded-[0.5px] transition-all duration-75 ${active ? color : 'bg-gray-950'}`} />;
                    })}
                    {/* Peak Hold Tick */}
                    <div className="absolute top-0 h-full w-[1.5px] bg-white/90 shadow-[0_0_4px_white] transition-all duration-75" style={{ left: `${s.peakHold}%` }} />

                    {/* Target Zone Marker */}
                    <div className="absolute top-0 h-full w-[20%] left-[60%] border-x border-white/20 bg-white/5 pointer-events-none" />
                  </div>
                  <span className="text-[10px] font-mono text-gray-400 w-10 text-right">{track.volume}%</span>
                </div>

                <div className="flex items-center gap-2">
                  <VolumeX size={10} className="text-gray-600" />
                  <input type="range" min="0" max="100" value={track.volume}
                    onChange={(e) => onUpdateTrack(track.id, { volume: parseInt(e.target.value) })}
                    className="flex-1 h-1 bg-black rounded-lg appearance-none cursor-pointer accent-aether-500" />
                  <Volume2 size={10} className="text-gray-600" />
                </div>
                <div className="flex justify-between px-1">
                  <span className="text-[8px] text-gray-600 uppercase">Silence</span>
                  <span className="text-[8px] text-aether-500 uppercase font-black">Clarity sweet spot</span>
                  <span className="text-[8px] text-gray-600 uppercase">Clip</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
