import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Monitor, Camera, Image as ImageIcon, Type, Circle, Zap, Settings, PlaySquare, StopCircle, Radio, X, Sliders, Sparkles, Download, Package, FolderInput, Network, ExternalLink, AlertCircle, Smartphone, HelpCircle, Disc, Square, Cloud, LogOut, Link as LinkIcon, RefreshCw, Activity, Tv } from 'lucide-react';
//import Peer from 'peerjs';
import { getPeerEnv} from "../../src/utils/peerEnv";
import { CanvasStage } from './CanvasStage';
import { AudioMixer } from './AudioMixer';
import { AIPanel } from '../AI/AIPanel';
import { LayerProperties } from './LayerProperties';
import { DeviceSelectorModal } from './DeviceSelectorModal';
import { QRConnectModal } from './QRConnectModal';
import { HelpModal } from './HelpModal';
import { Layer, SourceType, AudioTrackConfig, StreamStatus } from '../../types';
import { auth } from '../../services/firebase';
import { signOut, User } from 'firebase/auth';
import { generateRoomId, getCleanPeerId } from '../../utils/peerId';
import Peer, { DataConnection } from "peerjs";




function getStickyHostPeerId(sessionCode: string) {
  const key = `aether:hostPeerId:${sessionCode}`;
  let id = sessionStorage.getItem(key);

  if (!id) {
    id = `aether-host-${sessionCode}-${Date.now().toString(36)}-${Math.random()
      .toString(16)
      .slice(2)}`;
    sessionStorage.setItem(key, id);
  }

  return id;
}

function rotateStickyHostPeerId(sessionCode: string) {
  const key = `aether:hostPeerId:${sessionCode}`;
  const id = `aether-host-${sessionCode}-${Date.now().toString(36)}-${Math.random()
    .toString(16)
    .slice(2)}`;
  sessionStorage.setItem(key, id);
  return id;
}



const generateId = () => Math.random().toString(36).substr(2, 9);

interface StudioProps {
  user: User;
  onBack: () => void;
}

const SourceButton: React.FC<{ icon: React.ReactNode; label: string; onClick: () => void }> = ({ icon, label, onClick }) => (
  <button
    onClick={onClick}
    className="group relative p-3 rounded-xl text-gray-400 hover:text-white hover:bg-aether-700/50 transition-all flex items-center justify-center"
  >
    {icon}
    <div className="absolute left-14 top-1/2 -translate-y-1/2 px-2 py-1 bg-black/80 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-50 border border-white/10 backdrop-blur-sm">
      {label}
    </div>
  </button>
);

export const Studio: React.FC<StudioProps> = ({ user, onBack }) => {
  const [layers, setLayers] = useState<Layer[]>([]);
  const [audioTracks, setAudioTracks] = useState<AudioTrackConfig[]>([]);
  const [streamStatus, setStreamStatus] = useState<StreamStatus>(StreamStatus.IDLE);
  
  
  // Ref for Active Canvas to prevent stale closures in the Popout loop
  const activeCanvasRef = useRef<HTMLCanvasElement | null>(null);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);
  const [rightPanelTab, setRightPanelTab] = useState<'properties' | 'ai'>('ai');
  const [showSettings, setShowSettings] = useState(false);
  const [showDeviceSelector, setShowDeviceSelector] = useState(false);
  const [showQRModal, setShowQRModal] = useState(false);
  const [showHelpModal, setShowHelpModal] = useState(false);
  const keepAliveRef = useRef<number | null>(null);
  const [cloudError, setCloudError] = useState<string | null>(null);
  const [incomingRes, setIncomingRes] = useState<string>(""); // e.g. "3840×2160"
  const remoteCamVideoRef = useRef<HTMLVideoElement>(null);
  const mobileCamLayerIdRef = useRef<string | null>(null);
  const [micPickerTrackId, setMicPickerTrackId] = useState<string | null>(null);
 const [availableMics, setAvailableMics] = useState<MediaDeviceInfo[]>([]);



  // Persist Stream Key for validation workflow
  const [streamKey, setStreamKey] = useState(() => localStorage.getItem('aether_stream_key') || '');
  const [licenseKey, setLicenseKey] = useState(() => localStorage.getItem('aether_license_key') || '');
  const isPro = licenseKey.startsWith('PRO_'); // Simple validation logic for MVP

  // Update localStorage when key changes
  useEffect(() => {
      localStorage.setItem('aether_stream_key', streamKey);
  }, [streamKey]);

  useEffect(() => {
      localStorage.setItem('aether_license_key', licenseKey);
  }, [licenseKey]);
  const [desktopConnected, setDesktopConnected] = useState(false);
  const [relayConnected, setRelayConnected] = useState(false);
  const [relayStatus, setRelayStatus] = useState<string | null>(null);
  type ConnStatus =
  | "idle"
  | "connecting"
  | "waiting_for_phone"
  | "connected"
  | "error";

const [connStatus, setConnStatus] = useState<ConnStatus>("idle");



  const [peerId, setPeerId] = useState<string>('');
  
  // PERSISTENT ROOM ID
  const [roomId, setRoomId] = useState(() => {
     const saved = localStorage.getItem('aether_host_room_id');
     if (saved) return saved;
     const newId = generateRoomId(); // Use short simple ID
     localStorage.setItem('aether_host_room_id', newId);
     return newId;
  });
  
  const [isRecording, setIsRecording] = useState(false);
  const localRecorderRef = useRef<MediaRecorder | null>(null);
  const localChunksRef = useRef<Blob[]>([]);
  const [statusMsg, setStatusMsg] = useState<{type: 'error' | 'info', text: string} | null>(null);
  const hyperGateNodes = useRef<Map<string, {
  input: GainNode;
  hp: BiquadFilterNode;
  analyser: AnalyserNode;
  gate: GainNode;
}>>(new Map());

const hyperGateState = useRef<Map<string, {
  isOpen: boolean;
  lastAboveMs: number;
  lastDb: number;
}>>(new Map());

  
  // Audio Context
  const audioContext = useRef<AudioContext | null>(null);
  const audioDestination = useRef<MediaStreamAudioDestinationNode | null>(null);
  const audioSources = useRef<Map<string, MediaStreamAudioSourceNode>>(new Map());
  const audioGains = useRef<Map<string, GainNode>>(new Map());
  const audioFilters = useRef<Map<string, BiquadFilterNode>>(new Map());
  
  // RTMP Streaming Logic
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamingSocketRef = useRef<WebSocket | null>(null);
  const peerRef = useRef<Peer | null>(null);
    //const peerRef = useRef<Peer | null>(null);
const dataConnRef = useRef<DataConnection | null>(null);
  const cloudDisconnectTimerRef = useRef<number | null>(null);
  const cloudSyncTimerRef = useRef<number | null>(null);

  // Ensure AudioContext is resumed on any interaction
  useEffect(() => {
    const resumeAudio = () => {
      if (audioContext.current?.state === 'suspended') {
        audioContext.current.resume().catch(() => {});
      }
    };
    window.addEventListener('click', resumeAudio);
    window.addEventListener('keydown', resumeAudio);
    return () => {
        window.removeEventListener('click', resumeAudio);
        window.removeEventListener('keydown', resumeAudio);
    };
  }, []);

  // Update localStorage when key changes
  useEffect(() => {
      localStorage.setItem('aether_stream_key', streamKey);
  }, [streamKey]);

  useEffect(() => {
    if (selectedLayerId) setRightPanelTab('properties');
  }, [selectedLayerId]);

  useEffect(() => {
    if (statusMsg) {
      const timer = setTimeout(() => setStatusMsg(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [statusMsg]);

  useEffect(() => {
  const onSize = (e: Event) => {
    const evt = e as CustomEvent<{ layerId: string; width: number; height: number }>;
    const mobileId = mobileCamLayerIdRef.current;
    if (!mobileId) return;

    if (evt.detail?.layerId === mobileId) {
      setIncomingRes(`${evt.detail.width}×${evt.detail.height}`);
    }
  };

  window.addEventListener("aether:video-size", onSize as any);
  return () => window.removeEventListener("aether:video-size", onSize as any);
}, []);


  // --- Audio Engine Logic ---
  useEffect(() => {
    if (!audioContext.current) {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        audioContext.current = new AudioContextClass();
        audioDestination.current = audioContext.current.createMediaStreamDestination();
    }
    const ctx = audioContext.current;
    const dest = audioDestination.current;
    if (!ctx || !dest) return;

    const currentIds = new Set(audioTracks.map(t => t.id));
    audioSources.current.forEach((_, id) => {
        if (!currentIds.has(id)) {
            audioSources.current.get(id)?.disconnect();
            audioGains.current.get(id)?.disconnect();
            audioFilters.current.get(id)?.disconnect();
            audioSources.current.delete(id);
            audioGains.current.delete(id);
            audioFilters.current.delete(id);
        }
    });

    audioTracks.forEach(track => {
        if (!track.stream) return;
        if (!audioSources.current.has(track.id)) {
            const source = ctx.createMediaStreamSource(track.stream);
            const gain = ctx.createGain();

            const hg = createHyperGateChain(ctx);
            source.connect(hg.input);
            hg.gate.connect(gain);
            gain.connect(dest);
            audioSources.current.set(track.id, source);
            audioGains.current.set(track.id, gain);
            // store hypergate nodes for this track
            hyperGateNodes.current.set(track.id, hg);

            const filter = ctx.createBiquadFilter(); 
            source.connect(filter);
            filter.connect(gain);
            gain.connect(dest);
            audioSources.current.set(track.id, source);
            audioGains.current.set(track.id, gain);
            audioFilters.current.set(track.id, filter);
        }
        const gainNode = audioGains.current.get(track.id);
        const filterNode = audioFilters.current.get(track.id);
        if (gainNode) gainNode.gain.setTargetAtTime(track.muted ? 0 : (track.volume / 100), ctx.currentTime, 0.05);
       
    });
    // Try resume if suspended (though requires gesture)
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  }, [audioTracks]);



const peerServerDefaults = {
  host: "0.peerjs.com",
  port: 443,
  secure: true,
  path: "/",
};

useEffect(() => {
  const ctx = audioContext.current;
  if (!ctx) return;

  const timer = window.setInterval(() => {
    const now = Date.now();

    hyperGateNodes.current.forEach((nodes, trackId) => {
      const track = audioTracks.find(t => t.id === trackId);
      if (!track || !track.noiseCancellation) return; // only active when toggled

      const st = hyperGateState.current.get(trackId) || { isOpen: true, lastAboveMs: now, lastDb: -120 };
      const db = rmsDbFromAnalyser(nodes.analyser);
      st.lastDb = db;

      // --- HyperGate params (tune these) ---
      const thresholdDb = -45;   // raise (less negative) to gate more aggressively
      const holdMs = 220;
      const openGain = 1.0;
      const closedGain = 0.03;   // small floor so it doesn't sound "dead"
      const attack = 0.02;
      const release = 0.10;

      if (db > thresholdDb) {
        st.lastAboveMs = now;
        if (!st.isOpen) {
          nodes.gate.gain.setTargetAtTime(openGain, ctx.currentTime, attack);
          st.isOpen = true;
        }
      } else {
        const since = now - st.lastAboveMs;
        if (since > holdMs && st.isOpen) {
          nodes.gate.gain.setTargetAtTime(closedGain, ctx.currentTime, release);
          st.isOpen = false;
        }
      }

      hyperGateState.current.set(trackId, st);
    });
  }, 60);

  return () => window.clearInterval(timer);
}, [audioTracks]);


function createHyperGateChain(ctx: AudioContext) {
  // input gain (unity)
  const input = ctx.createGain();
  input.gain.value = 1;

  // highpass to reduce rumble (pre-gate)
  const hp = ctx.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 120;

  // analyser for VAD-ish energy detection
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0.85;

  // gate gain (this is what opens/closes)
  const gate = ctx.createGain();
  gate.gain.value = 1;

  input.connect(hp);
  hp.connect(analyser);
  hp.connect(gate);

  return { input, hp, analyser, gate };
}

function rmsDbFromAnalyser(analyser: AnalyserNode) {
  const buf = new Float32Array(analyser.fftSize);
  analyser.getFloatTimeDomainData(buf);
  let sum = 0;
  for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
  const rms = Math.sqrt(sum / buf.length) || 1e-8;
  return 20 * Math.log10(rms);
}

  // --- PeerJS Signaling Setup ---
useEffect(() => {
  const myPeerId = getCleanPeerId(roomId, "host");
  const peerEnv = getPeerEnv();
  const rotateRoomId = () => {
    const newId = generateRoomId();
    localStorage.setItem("aether_host_room_id", newId);
    setRoomId(newId);
    setStatusMsg({ type: "info", text: "Room ID was in use. New room generated." });
  };
  const scheduleCloudOffline = () => {
    if (cloudDisconnectTimerRef.current) window.clearTimeout(cloudDisconnectTimerRef.current);
    cloudDisconnectTimerRef.current = window.setTimeout(() => {
      setCloudConnected(false);
      setStatusMsg({ type: "warn", text: "Cloud disconnected. Reconnecting..." });
    }, 1500);
  };
  const clearCloudOffline = () => {
    if (cloudDisconnectTimerRef.current) {
      window.clearTimeout(cloudDisconnectTimerRef.current);
      cloudDisconnectTimerRef.current = null;
    }
  };

  // --- timers/scoped vars for cleanup ---
  let retryTimer: number | null = null;
  let retryCount = 0;
  let ws: WebSocket | null = null;

  // ✅ Destroy old peer ONLY if it's different
  const existing: any = peerRef.current;
  if (existing && !existing.destroyed && existing.id !== myPeerId) {
    try { existing.destroy(); } catch {}
    peerRef.current = null;
  }

  // ✅ Clear old keepalive
  if (keepAliveRef.current) {
    window.clearInterval(keepAliveRef.current);
    keepAliveRef.current = null;
  }

  // ✅ If we already have the correct peer alive, don't recreate it,
  // but DO ensure keepalive is running (important after refresh/HMR)
  const stillAlive: any = peerRef.current;
  if (stillAlive && !stillAlive.destroyed && stillAlive.id === myPeerId) {
    if (stillAlive.id) setPeerId(stillAlive.id);
    if (!stillAlive.disconnected) {
      setCloudConnected(true);
      setCloudError(null);
    }
    keepAliveRef.current = window.setInterval(() => {
      const p: any = peerRef.current;
      if (!p) return;
      if (p.disconnected) {
        try { p.reconnect(); } catch {}
      }
    }, 5000);

    return () => {
      if (keepAliveRef.current) {
        window.clearInterval(keepAliveRef.current);
        keepAliveRef.current = null;
      }
    };
  }

  // --- Create Peer ---
  const peer = new Peer(myPeerId, {
    debug: 1,
    host: peerEnv.host,
    port: peerEnv.port,
    path: peerEnv.path,
    secure: peerEnv.secure,
    config: {
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
      ],
    },
  });

  peerRef.current = peer;

  // ✅ Make refresh/tab-close release the ID ASAP
  const handleBeforeUnload = () => {
    try { peer.destroy(); } catch {}
  };
  window.addEventListener("beforeunload", handleBeforeUnload);

  // ✅ Retry helper for ID-TAKEN / unavailable-id
  const retryIfIdTaken = () => {
    if (retryTimer) window.clearTimeout(retryTimer);
   if (retryCount >= 30) return; // retry for ~36s total (30 * 1200ms)


    retryCount += 1;
    retryTimer = window.setTimeout(() => {
      const p: any = peerRef.current;
      if (!p || p.destroyed) return;

      try { p.destroy(); } catch {}
      peerRef.current = null;

      const env = getPeerEnv();
      const next = new Peer(myPeerId, {
        debug: 1,
        host: env.host,
        port: env.port,
        path: env.path,
        secure: env.secure,
        config: {
          iceServers: [
            { urls: "stun:stun.l.google.com:19302" },
            { urls: "stun:stun1.l.google.com:19302" },
          ],
        },
      });

      peerRef.current = next;

      next.on("open", (id) => {
        setPeerId(id);
        setCloudConnected(true);
        setCloudError(null);
        setStatusMsg({ type: "info", text: "Cloud Online." });
      });

      next.on("error", (err: any) => {
        console.error("[Cloud] Error:", err?.type, err?.message, err);
        setCloudConnected(false);
        setCloudError(err?.type || "error");

        const msg = String(err?.message || "");
        if (err?.type === "unavailable-id" || msg.toLowerCase().includes("taken")) {
          rotateRoomId();
        }
      });

      next.on("call", (call) => {
        setStatusMsg({ type: "info", text: "Mobile Camera Incoming..." });
        call.answer();
        call.on("stream", (remoteStream) => handleMobileStream(remoteStream));
      });
    }, 1200);
  };

  // --- Keepalive ---
  keepAliveRef.current = window.setInterval(() => {
    const p: any = peerRef.current;
    if (!p) return;
    if (p.disconnected) {
      try { p.reconnect(); } catch {}
    }
  }, 5000);

  // --- Cloud status sync (handles missed open events / HMR) ---
  if (cloudSyncTimerRef.current) window.clearInterval(cloudSyncTimerRef.current);
  cloudSyncTimerRef.current = window.setInterval(() => {
    const p: any = peerRef.current;
    if (!p || p.destroyed) return;
    if (p.open) {
      setCloudConnected((prev) => (prev ? prev : true));
      setCloudError(null);
    }
  }, 1000);

  // --- Peer handlers ---
  peer.on("open", (id) => {
    setPeerId(id);
    clearCloudOffline();
    setCloudConnected(true);
    setCloudError(null);
    setStatusMsg({ type: "info", text: "Cloud Online." });
  });

  peer.on("disconnected", () => {
    scheduleCloudOffline();
    try { (peer as any).reconnect?.(); } catch {}
  });

  peer.on("close", () => {
    clearCloudOffline();
    setCloudConnected(false);
    setStatusMsg({ type: "warn", text: "Cloud closed." });
  });

  peer.on("error", (err: any) => {
    console.error("[Cloud] Error:", err?.type, err?.message, err);
    scheduleCloudOffline();
    setCloudError(err?.type || "error");

    const msg = String(err?.message || "");
    if (err?.type === "unavailable-id" || msg.toLowerCase().includes("taken")) {
      rotateRoomId();
    }
  });

  peer.on("call", (call) => {
    setStatusMsg({ type: "info", text: "Mobile Camera Incoming..." });
    call.answer();
    call.on("stream", (remoteStream) => handleMobileStream(remoteStream));
  });

  // --- Relay WebSocket (Host) ---
  const wsUrlRaw =
    (import.meta.env.VITE_SIGNAL_URL as string | undefined) ||
    (import.meta.env.VITE_RELAY_WS_URL as string | undefined);
  const wsUrlLocal = import.meta.env.VITE_SIGNAL_URL_LOCAL as string | undefined;
  const isLocalHost =
    window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
  const wsUrl = (isLocalHost ? wsUrlLocal : wsUrlRaw) || wsUrlRaw;
  let relayRetryTimer: number | null = null;

  const connectRelay = () => {
    if (!wsUrl) return;
    try {
      ws = new WebSocket(wsUrl);
      streamingSocketRef.current = ws;

      ws.onopen = () => {
        setRelayConnected(true);
        setRelayStatus("Relay connected");
        ws?.send(
          JSON.stringify({
            type: "join",
            role: "host",
            sessionId: roomId,
            token: import.meta.env.VITE_RELAY_TOKEN,
          })
        );
      };

      ws.onclose = (ev) => {
        console.log("[Relay] close", { code: ev.code, reason: ev.reason });
        setRelayConnected(false);
        setRelayStatus(`Relay closed (${ev.code})`);
        if (streamStatus === StreamStatus.LIVE) {
          try { mediaRecorderRef.current?.stop(); } catch {}
          setStreamStatus(StreamStatus.IDLE);
        }
        if (relayRetryTimer) window.clearTimeout(relayRetryTimer);
        relayRetryTimer = window.setTimeout(connectRelay, 1500);
      };

      ws.onerror = () => {
        setRelayConnected(false);
        setRelayStatus("Relay error");
        setStatusMsg({ type: "error", text: "Relay connection failed" });
      };

      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(String(ev.data || "{}"));
          if (msg?.type === "started") setRelayStatus("Relay streaming");
          if (msg?.type === "ffmpeg_start") setRelayStatus(`FFmpeg start (${msg.target || "primary"})`);
          if (msg?.type === "rtmp_fallback") setRelayStatus("Primary failed, using RTMP fallback");
          if (msg?.type === "ffmpeg_closed") setRelayStatus(`FFmpeg closed (${msg.code})`);
          if (msg?.type === "ffmpeg_restarting") setRelayStatus("FFmpeg restarting...");
          if (msg?.type === "ffmpeg_error") setRelayStatus(`FFmpeg: ${msg.message || "error"}`);
          if (msg?.type === "error") setRelayStatus(`Relay error: ${msg.error || "unknown"}`);
        } catch {}
      };
    } catch {}
  };

  connectRelay();

  // --- Cleanup ---
  return () => {
    if (keepAliveRef.current) {
      window.clearInterval(keepAliveRef.current);
      keepAliveRef.current = null;
    }
    if (cloudDisconnectTimerRef.current) {
      window.clearTimeout(cloudDisconnectTimerRef.current);
      cloudDisconnectTimerRef.current = null;
    }
    if (cloudSyncTimerRef.current) {
      window.clearInterval(cloudSyncTimerRef.current);
      cloudSyncTimerRef.current = null;
    }

    // Destroy only if this effect owns the current peer id
    const p: any = peerRef.current;
    if (p && p.id === myPeerId) {
      try { p.destroy(); } catch {}
      peerRef.current = null;
    }

    try { ws?.close(); } catch {}
    try { streamingSocketRef.current?.close(); } catch {}
    streamingSocketRef.current = null;
    if (relayRetryTimer) window.clearTimeout(relayRetryTimer);

    window.removeEventListener("beforeunload", handleBeforeUnload);
    if (retryTimer) window.clearTimeout(retryTimer);
  };
}, [roomId]);


  const handleMobileStream = (stream: MediaStream) => {
      setLayers(prev => {
  const safePrev = Array.isArray(prev) ? prev : [];
  const existingLayerIndex = safePrev.findIndex(l => l.label === 'Mobile Cam' && l.type === SourceType.CAMERA);

          
          if (existingLayerIndex >= 0) {
              const newLayers = [...safePrev];
              newLayers[existingLayerIndex] = {
                  ...newLayers[existingLayerIndex],
                  src: stream                   
              };
              mobileCamLayerIdRef.current = newLayers[existingLayerIndex].id;
              return newLayers;
          } else {
              const newLayer: Layer = {
                
                id: generateId(),
                type: SourceType.CAMERA,
                label: 'Mobile Cam',
                visible: true,
                x: 50, y: 50, width: 480, height: 270,
                src: stream,
                zIndex: safePrev.length + 10,
                style: { circular: false, border: true, borderColor: '#7c3aed' }
             };
             mobileCamLayerIdRef.current = newLayer.id;
             // --- Incoming mobile video resolution verifier (host-side) ---
try {
  const vt = stream.getVideoTracks?.()?.[0];
  if (vt) {
    const updateRes = () => {
      const s = vt.getSettings?.();
      const w = s?.width;
      const h = s?.height;
      if (w && h) setIncomingRes(`${w}×${h}`);
    };

    // Initial + delayed checks (some browsers update late)
    updateRes();
    setTimeout(updateRes, 500);
    setTimeout(updateRes, 1500);

    // Track state changes
    vt.addEventListener?.("unmute", updateRes as any);
    vt.addEventListener?.("mute", updateRes as any);
  }
} catch {}           
             return [...safePrev, newLayer];
          }          
       });
       
       
       setAudioTracks(prev => {
           const MOBILE_MIC_ID = 'mobile-mic-track';
           if (prev.some(t => t.id === MOBILE_MIC_ID)) {
               return prev.map(t => t.id === MOBILE_MIC_ID ? { ...t, stream: stream } : t);
           }
           return [...prev, { 
               id: MOBILE_MIC_ID, 
               label: 'Mobile Mic', 
               volume: 100, 
               muted: false, 
               isMic: true, 
               noiseCancellation: false, 
               stream: stream 
            }];
       });

       setStatusMsg({ type: 'info', text: "Mobile Connected & Live!" });
       setShowQRModal(false);

       // --- Incoming mobile video resolution verifier (host-side) ---
try {
  const vt = stream.getVideoTracks?.()?.[0];
  if (vt) {
    const updateRes = () => {
      const s = vt.getSettings?.();
      const w = s?.width;
      const h = s?.height;
      if (w && h) setIncomingRes(`${w}×${h}`);
    };

    // Initial + delayed checks (some browsers update late)
    updateRes();
    setTimeout(updateRes, 500);
    setTimeout(updateRes, 1500);

    // Track state changes
    vt.addEventListener?.("unmute", updateRes as any);
    vt.addEventListener?.("mute", updateRes as any);
  }
} catch {}


       
  };

  const regenerateRoomId = () => {
      const newId = generateRoomId();
      setRoomId(newId);
      localStorage.setItem('aether_host_room_id', newId);
      setStatusMsg({ type: 'info', text: "New Room ID Generated." });
  };


  // --- Layer Management ---
  const addCameraSource = async (videoDeviceId: string, audioDeviceId: string) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { deviceId: { exact: videoDeviceId }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: audioDeviceId ? { deviceId: { exact: audioDeviceId } } : false
      });
      
      const newLayer: Layer = {
        id: generateId(), type: SourceType.CAMERA, label: 'Camera', visible: true, x: 0, y: 0, width: 1920, height: 1080, src: stream, zIndex: layers.length + 1, style: {}
      };
      setLayers(prev => [...prev, newLayer]);
      setAudioTracks(prev => [...prev, { id: generateId(), label: 'Cam Mic', volume: 100, muted: false, isMic: true, noiseCancellation: false, stream }]);
      setSelectedLayerId(newLayer.id);
      setShowDeviceSelector(false);
    } catch (err) {
      setStatusMsg({ type: 'error', text: "Failed to access device." });
    }
  };

  const addScreenSource = async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      const newLayer: Layer = {
        id: generateId(), type: SourceType.SCREEN, label: 'Screen', visible: true, x: 0, y: 0, width: 1920, height: 1080, src: stream, zIndex: 0, style: {}
      };
      setLayers(prev => [newLayer, ...prev]); 
      if (stream.getAudioTracks().length > 0) {
        setAudioTracks(prev => [...prev, { id: generateId(), label: 'System Audio', volume: 80, muted: false, isMic: false, noiseCancellation: false, stream }]);
      }
      setSelectedLayerId(newLayer.id);
    } catch (err: any) {
        if (err.name !== 'NotAllowedError') setStatusMsg({ type: 'error', text: err.message });
    }
  };

  const addImageLayer = (src: string, label: string = 'Image') => {
    const newLayer: Layer = { id: generateId(), type: SourceType.IMAGE, label, visible: true, x: 100, y: 100, width: 480, height: 270, src, zIndex: layers.length + 1, style: {} };
    setLayers(prev => [...prev, newLayer]);
    setSelectedLayerId(newLayer.id);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => event.target?.result && addImageLayer(event.target.result as string, file.name);
      reader.readAsDataURL(file);
    }
  };

  const addTextLayer = () => {
     const newLayer: Layer = { id: generateId(), type: SourceType.TEXT, label: 'Text', visible: true, x: 200, y: 200, width: 400, height: 100, content: 'Double Click to Edit', zIndex: layers.length + 1, style: {} };
     setLayers(prev => [...prev, newLayer]);
     setSelectedLayerId(newLayer.id);
  };

  const updateLayer = (id: string, updates: Partial<Layer>) => setLayers(prev => prev.map(l => l.id === id ? { ...l, ...updates } : l));
  const deleteLayer = (id: string) => {
    setLayers(prev => prev.filter(l => l.id !== id));
    if (selectedLayerId === id) setSelectedLayerId(null);
  };
  const updateAudioTrack = (id: string, updates: Partial<AudioTrackConfig>) => setAudioTracks(prev => prev.map(t => t.id === id ? { ...t, ...updates } : t));

  const handleCanvasReady = (canvas: HTMLCanvasElement) => {
      // Store in ref for stable access in animation loops
      activeCanvasRef.current = canvas;
  };

  const getMixedStream = () => {
    if (!activeCanvasRef.current) return null;
    const canvasStream = activeCanvasRef.current.captureStream(30);
    const audioStream = audioDestination.current?.stream;
    return new MediaStream([...canvasStream.getVideoTracks(), ...(audioStream ? audioStream.getAudioTracks() : [])]);
  };

  // --- Virtual Cable (Popout) Logic ---
  const openVirtualCable = () => {
    // Force Audio Resume
    if (audioContext.current?.state === 'suspended') {
        audioContext.current.resume();
    }
    
    if (!activeCanvasRef.current) return;
    
    // Create a new window
    const win = window.open('', 'AetherVirtualCable', 'width=1280,height=720,menubar=no,toolbar=no,location=no,status=no,resizable=yes');
    if (!win) {
        setStatusMsg({ type: 'error', text: "Popup blocked! Allow popups for Virtual Cable." });
        return;
    }

    // Set up the window document
    win.document.title = "Aether Virtual Output";
    win.document.body.style.margin = '0';
    win.document.body.style.backgroundColor = 'black';
    win.document.body.style.overflow = 'hidden';
    win.document.body.style.display = 'flex';
    win.document.body.style.alignItems = 'center';
    win.document.body.style.justifyContent = 'center';

    // Create a canvas in the new window
    const outCanvas = win.document.createElement('canvas');
    outCanvas.width = 1920;
    outCanvas.height = 1080;
    outCanvas.style.width = '100vw';
    outCanvas.style.height = '100vh';
    outCanvas.style.objectFit = 'contain';
    win.document.body.appendChild(outCanvas);
    
    // Create a helper message
    const msg = win.document.createElement('div');
    msg.innerText = "Virtual Cable Active: Capture this window in Zoom/OBS";
    msg.style.position = 'absolute';
    msg.style.bottom = '10px';
    msg.style.left = '10px';
    msg.style.color = 'rgba(255,255,255,0.3)';
    msg.style.fontFamily = 'sans-serif';
    msg.style.fontSize = '12px';
    msg.style.pointerEvents = 'none';
    win.document.body.appendChild(msg);

    // Sync Loop using REF to avoid stale closure
    const ctx = outCanvas.getContext('2d');
    const syncLoop = () => {
        // activeCanvasRef.current is stable across re-renders
        if (!win.closed && ctx && activeCanvasRef.current) {
            ctx.drawImage(activeCanvasRef.current, 0, 0, outCanvas.width, outCanvas.height);
            win.requestAnimationFrame(syncLoop);
        }
    };
    syncLoop();
    setStatusMsg({ type: 'info', text: "Virtual Output Window Opened" });
  };

  const toggleRecording = () => {
    if (isRecording) {
      localRecorderRef.current?.stop();
      setIsRecording(false);
    } else {
      // Force Audio Resume
      if (audioContext.current?.state === 'suspended') {
        audioContext.current.resume();
      }

      const stream = getMixedStream();
      if (!stream) {
          setStatusMsg({ type: 'error', text: "No stream available (Canvas not ready)" });
          return;
      }
      
      const recorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
      localChunksRef.current = [];
      
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) localChunksRef.current.push(e.data);
      };
      
      recorder.onstop = () => {
        const blob = new Blob(localChunksRef.current, { type: 'video/webm' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `recording-${Date.now()}.webm`;
        a.click();
        setStatusMsg({ type: 'info', text: "Recording Saved!" });
      };
      
      recorder.start();
      localRecorderRef.current = recorder;
      setIsRecording(true);
      setStatusMsg({ type: 'info', text: "Recording Started" });
    }
  };

  const toggleLive = async () => {
    if (streamStatus === StreamStatus.LIVE) {
      // STOP
      if (mediaRecorderRef.current) mediaRecorderRef.current.stop();
      if (streamingSocketRef.current && streamingSocketRef.current.readyState === WebSocket.OPEN) {
          streamingSocketRef.current.send(JSON.stringify({ type: 'stop-stream' }));
      }
      setStreamStatus(StreamStatus.IDLE);
    } else {
      // START
      // Force Audio Resume (Browser policy requirement)
      if (audioContext.current?.state === 'suspended') {
        await audioContext.current.resume();
      }

      if (!cloudConnected) {
        setStatusMsg({ type: 'error', text: "Cloud Disconnected!" });
        return;
      }
      const cleanKey = streamKey.trim();
      if (!cleanKey) {
          setStatusMsg({ type: 'error', text: "No Stream Key Set! Check Settings." });
          setShowSettings(true);
          return;
      }

      if (!relayConnected) {
        setStatusMsg({ type: 'error', text: "Relay Offline. Wait for relay to connect." });
        return;
      }

      const combinedStream = getMixedStream();
      if (!combinedStream) {
          setStatusMsg({ type: 'error', text: "Initialization Error. Refresh page." });
          return;
      }
      
      setStatusMsg({ type: 'info', text: `Starting RTMP Stream...` });

      // Tell Backend to Start FFmpeg
      if (streamingSocketRef.current && streamingSocketRef.current.readyState === WebSocket.OPEN) {
          streamingSocketRef.current.send(JSON.stringify({ 
              type: 'start-stream', 
               streamKey: cleanKey,
               token: import.meta.env.VITE_RELAY_TOKEN             
          }));
      } else {
          setStatusMsg({ type: 'error', text: "Relay not connected" });
          return;
      }

      // Start Media Recorder to pump binary data
     // Use a stable, widely-supported input format for FFmpeg
const preferred = 'video/webm;codecs=vp8,opus';
const options = MediaRecorder.isTypeSupported(preferred)
  ? { mimeType: preferred, videoBitsPerSecond: 6_000_000, audioBitsPerSecond: 160_000 }
  : { mimeType: 'video/webm', videoBitsPerSecond: 6_000_000, audioBitsPerSecond: 160_000 };

const recorder = new MediaRecorder(combinedStream, options);

      
      recorder.ondataavailable = (e) => {
          if (e.data.size > 0 && streamingSocketRef.current?.readyState === WebSocket.OPEN) {
             // Send binary blob directly
             streamingSocketRef.current.send(e.data);
          }
      };

      recorder.start(250); // 250ms chunks for low latency
      mediaRecorderRef.current = recorder;
      setStreamStatus(StreamStatus.LIVE);
    }
  };

   const openMicPicker = async (trackId: string) => {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const mics = devices.filter(d => d.kind === "audioinput");
    setAvailableMics(mics);
    setMicPickerTrackId(trackId);
  } catch {
    setStatusMsg({ type: "error", text: "Could not list microphones. Allow permissions first." });
  }
};
  const handleSignOut = () => {
     signOut(auth).catch(console.error);
     onBack();
  };

  const canStartLive = cloudConnected && relayConnected && streamKey.trim().length > 0;
  const canToggleLive = streamStatus === StreamStatus.LIVE || canStartLive;

  return (
    <div className="fixed inset-0 flex flex-col w-full bg-aether-900 text-gray-200 font-sans selection:bg-aether-500 selection:text-white relative overflow-hidden">
      <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleFileUpload} />
     {statusMsg && (
  <div className="fixed top-20 left-1/2 -translate-x-1/2 px-6 py-3 rounded-xl text-sm font-bold flex flex-col items-center gap-1 shadow-lg">
    <div className="flex items-center gap-3">
      <AlertCircle size={20} />
      <span>{statusMsg.text}</span>
    </div>

    {incomingRes && (
      <div className="text-[11px] font-mono opacity-80">
        Incoming: {incomingRes}
      </div>
    )}
  </div>
)}


      {showDeviceSelector && <DeviceSelectorModal onSelect={addCameraSource} onClose={() => setShowDeviceSelector(false)} />}
      {showQRModal && <QRConnectModal roomId={roomId} relayPort="" onClose={() => setShowQRModal(false)} />}
      {showHelpModal && <HelpModal onClose={() => setShowHelpModal(false)} />}

        {micPickerTrackId && (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
    <div className="bg-aether-900 border border-aether-700 rounded-xl p-5 w-[520px] shadow-2xl">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-bold text-white">Select Microphone</h3>
        <button onClick={() => setMicPickerTrackId(null)} className="text-gray-400 hover:text-white">
          <X size={18} />
        </button>
      </div>

      <div className="space-y-2 max-h-72 overflow-y-auto">
        {availableMics.map(m => (
          <button
            key={m.deviceId}
            onClick={async () => {
              // Re-acquire a stream from selected mic and swap the track’s stream
              try {
                const s = await navigator.mediaDevices.getUserMedia({
                  audio: { deviceId: { exact: m.deviceId } },
                  video: false
                });

                setAudioTracks(prev =>
                  prev.map(t => t.id === micPickerTrackId ? { ...t, stream: s } : t)
                );

                setMicPickerTrackId(null);
                setStatusMsg({ type: "info", text: "Microphone switched." });
              } catch {
                setStatusMsg({ type: "error", text: "Failed to switch microphone." });
              }
            }}
            className="w-full text-left px-4 py-3 rounded-lg bg-aether-800 hover:bg-aether-700 border border-aether-700 text-gray-200"
          >
            <div className="text-sm font-semibold">{m.label || "Microphone"}</div>
            <div className="text-[10px] font-mono text-gray-500">{m.deviceId}</div>
          </button>
        ))}
      </div>
    </div>
  </div>
)}


      <header className="h-14 border-b border-aether-700 bg-aether-900/90 flex items-center justify-between px-6 z-10 backdrop-blur-md">
        <div className="flex items-center gap-2 cursor-pointer" onClick={onBack}>
          <div className="w-8 h-8 bg-gradient-to-br from-aether-500 to-fuchsia-500 rounded-lg flex items-center justify-center shadow-lg">
            <Zap className="text-white fill-current" size={18} />
          </div>
          <h1 className="text-xl font-bold tracking-tight text-white">Aether<span className="text-fuchsia-400 font-light">Studio</span></h1>
        </div>
        <div className="flex items-center gap-4 bg-aether-800 p-1.5 rounded-full border border-aether-700">
           <div className={`flex items-center gap-2 px-3 py-1 rounded-full text-xs font-bold uppercase ${streamStatus === StreamStatus.LIVE ? 'bg-red-600 text-white animate-pulse' : 'text-gray-500'}`}>
              <Circle size={8} fill={streamStatus !== StreamStatus.IDLE ? "currentColor" : "none"} />
              {streamStatus === StreamStatus.LIVE ? 'ON AIR' : 'Ready'}
           </div>
           
           <div className={`flex items-center gap-2 px-3 py-1 rounded-full text-xs font-bold uppercase border ${cloudConnected ? 'bg-green-500/10 border-green-500/20 text-green-400' : 'bg-red-500/10 border-red-500/20 text-red-400'}`}>
                <Cloud size={10} /> {cloudConnected ? 'Online' : 'Offline'}
           </div>

           <div
             className={`flex items-center gap-2 px-3 py-1 rounded-full text-xs font-bold uppercase border ${
               relayConnected ? 'bg-green-500/10 border-green-500/20 text-green-400' : 'bg-red-500/10 border-red-500/20 text-red-400'
             }`}
             title={relayStatus || undefined}
           >
             <Network size={10} /> {relayConnected ? 'Relay' : 'Relay Offline'}
           </div>
        </div>
        <div className="flex gap-3">
          <button 
             onClick={openVirtualCable}
             className="flex items-center gap-2 px-3 py-2 text-aether-400 hover:text-white hover:bg-aether-800 rounded-lg transition-colors text-sm font-medium border border-transparent hover:border-aether-700"
             title="Open Virtual Cable Output Window"
          >
              <Tv size={18} /> Popout Output
          </button>

          <button onClick={() => setShowHelpModal(true)} className="p-2 text-gray-400 hover:text-white hover:bg-aether-800 rounded-lg"><HelpCircle size={20} /></button>
          
          <button 
            onClick={toggleRecording} 
            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all ${isRecording ? 'bg-white text-red-600' : 'bg-aether-800 border border-aether-700 hover:bg-aether-700'}`}
          >
            {isRecording ? <Square size={18} fill="currentColor" /> : <Disc size={18} />}
            {isRecording ? 'Stop Rec' : 'Record'}
          </button>

          <button
            onClick={toggleLive}
            disabled={!canToggleLive}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all ${
              streamStatus === StreamStatus.LIVE
                ? 'bg-red-600 text-white'
                : canToggleLive
                  ? 'bg-aether-800 border border-aether-700 hover:bg-aether-700'
                  : 'bg-aether-900 border border-aether-800 text-gray-500 cursor-not-allowed opacity-70'
            }`}
            title={!canToggleLive ? "Relay and stream key required" : undefined}
          >
            <Radio size={18} /> {streamStatus === StreamStatus.LIVE ? 'End Stream' : 'Go Live'}
          </button>
          <button onClick={() => setShowSettings(true)} className="p-2 text-gray-400 hover:text-white hover:bg-aether-800 rounded-lg"><Settings size={20} /></button>
          <button onClick={handleSignOut} className="p-2 text-red-400 hover:text-white hover:bg-red-900/50 rounded-lg" title="Sign Out"><LogOut size={20} /></button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <aside className="w-16 flex flex-col items-center py-6 gap-6 border-r border-aether-700 bg-aether-800/50">
           <SourceButton icon={<Camera size={24} />} label="Camera" onClick={() => setShowDeviceSelector(true)} />
           <SourceButton icon={<Smartphone size={24} />} label="Mobile" onClick={() => setShowQRModal(true)} />
           <SourceButton icon={<Monitor size={24} />} label="Screen" onClick={addScreenSource} />
           <SourceButton icon={<ImageIcon size={24} />} label="Image" onClick={() => fileInputRef.current?.click()} />
           <SourceButton icon={<Type size={24} />} label="Text" onClick={addTextLayer} />
        </aside>
        <main className="flex-1 flex flex-col relative bg-[#05010a] overflow-hidden">
          <div className="flex-1 p-8 flex items-center justify-center">
            <CanvasStage 
                layers={layers} 
                onCanvasReady={handleCanvasReady} 
                selectedLayerId={selectedLayerId} 
                onSelectLayer={setSelectedLayerId} 
                onUpdateLayer={updateLayer} 
                isPro={isPro}
            />
          </div>
          <AudioMixer
  tracks={audioTracks}
  onUpdateTrack={updateAudioTrack}
  onOpenSettings={openMicPicker}
/>

        </main>
        <div className="w-80 border-l border-aether-700 bg-aether-900 flex flex-col">
            <div className="flex border-b border-aether-700">
                <button onClick={() => setRightPanelTab('properties')} className={`flex-1 py-3 text-xs font-bold uppercase flex justify-center gap-2 ${rightPanelTab === 'properties' ? 'bg-aether-800 text-white' : 'text-gray-500'}`}><Sliders size={14} /> Properties</button>
                <button onClick={() => setRightPanelTab('ai')} className={`flex-1 py-3 text-xs font-bold uppercase flex justify-center gap-2 ${rightPanelTab === 'ai' ? 'bg-aether-800 text-aether-400' : 'text-gray-500'}`}><Sparkles size={14} /> AI Studio</button>
            </div>
            <div className="flex-1 overflow-hidden">
                {rightPanelTab === 'properties' ? <LayerProperties layer={layers.find(l => l.id === selectedLayerId) || null} onUpdate={updateLayer} onDelete={deleteLayer} /> : <AIPanel onAddLayer={(src) => addImageLayer(src, 'AI Background')} />}
            </div>
        </div>
      </div>

      {showSettings && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-aether-900 border border-aether-700 rounded-xl p-6 w-[500px] shadow-2xl">
            <div className="flex justify-between items-center mb-6"><h2 className="text-xl font-bold flex gap-2"><Settings className="text-aether-500"/> Settings</h2><button onClick={() => setShowSettings(false)}><X className="text-gray-400"/></button></div>
            <div className="space-y-4">
              <div className="bg-blue-500/10 border border-blue-500/20 p-4 rounded-lg">
                  <h4 className="text-sm font-bold text-white mb-2 flex items-center gap-2"><Activity size={16}/> Cloud Diagnostic</h4>
                  <div className="space-y-1 text-xs text-gray-300">
                      <p>PeerID: <span className="font-mono text-gray-500">{peerId || 'Generating...'}</span></p>
                      <p>Room: <span className="font-mono text-gray-500">{roomId}</span></p>
                      <p>Status: <span className={cloudConnected ? "text-green-400" : "text-red-400"}>{cloudConnected ? "Active" : "Disconnected"}</span></p>
                      <p>Relay: <span className={relayConnected ? "text-green-400" : "text-red-400"}>{relayConnected ? "Online" : "Offline"}</span></p>
                      {relayStatus && <p>Relay Status: <span className="text-gray-400">{relayStatus}</span></p>}
                  </div>
              </div>
              <div className="bg-aether-800/50 p-4 rounded-lg">
                 <div className="flex justify-between items-center">
                    <div>
                        <h4 className="text-sm font-bold text-white mb-1">Room Management</h4>
                        <p className="text-xs text-gray-400">Force new room if stuck</p>
                    </div>
                    <button 
                        onClick={regenerateRoomId}
                        className="p-2 bg-red-500/10 text-red-400 hover:bg-red-500/20 rounded-lg text-xs flex items-center gap-1 border border-red-500/20"
                    >
                        <RefreshCw size={12} /> Reset Room
                    </button>
                 </div>
              </div>
              <div>
                  <label className="text-gray-400 text-sm">Pro License Key</label>
                  <input 
                      type="text" 
                      value={licenseKey} 
                      onChange={e => setLicenseKey(e.target.value)} 
                      placeholder="PRO_XXXX-XXXX..."
                      className="w-full bg-aether-800 border border-aether-700 rounded p-2 text-sm text-white focus:border-aether-500 outline-none"
                  />
                  <p className="text-[10px] text-gray-500 mt-1">
                    {isPro ? <span className="text-green-400">Pro Features Active ✨</span> : "Enter key to remove watermark & unlock AI."}
                  </p>
              </div>
              <div>
                  <label className="text-gray-400 text-sm">Stream Key (YouTube/Twitch)</label>
                  <input 
                      type="password" 
                      value={streamKey} 
                      onChange={e => setStreamKey(e.target.value)} 
                      placeholder="rtmp_key_12345..."
                      className="w-full bg-aether-800 border border-aether-700 rounded p-2 text-sm text-white focus:border-aether-500 outline-none"
                  />
                  <p className="text-[10px] text-gray-500 mt-1">Saved locally. Requires local backend running.</p>
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6"><button onClick={() => setShowSettings(false)} className="px-4 py-2 rounded text-sm bg-aether-500 text-white">Done</button></div>
          </div>
        </div>
      )}
    </div>
  );
};
