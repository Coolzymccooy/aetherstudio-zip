import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Monitor, Camera, Image as ImageIcon, Type, Circle, Zap, Settings, PlaySquare, StopCircle, Radio, X, Sliders, Sparkles, Download, Package, FolderInput, Network, ExternalLink, AlertCircle, Smartphone, HelpCircle, Disc, Square, Cloud, LogOut, Link as LinkIcon, RefreshCw, Activity, Tv } from 'lucide-react';
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

export const StudioCore: React.FC<StudioProps> = ({ user, onBack }) => {
  // --- STATE DECLARATIONS ---
  const [cloudConnected, setCloudConnected] = useState(false);
  const [layers, setLayers] = useState<Layer[]>([]);
  const [audioTracks, setAudioTracks] = useState<AudioTrackConfig[]>([]);
  const [streamStatus, setStreamStatus] = useState<StreamStatus>(StreamStatus.IDLE);
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);
  const [rightPanelTab, setRightPanelTab] = useState<'properties' | 'ai'>('ai');
  const [showSettings, setShowSettings] = useState(false);
  const [showDeviceSelector, setShowDeviceSelector] = useState(false);
  const [showQRModal, setShowQRModal] = useState(false);
  const [showHelpModal, setShowHelpModal] = useState(false);
  const [cloudError, setCloudError] = useState<string | null>(null);
  const [incomingRes, setIncomingRes] = useState<string>(""); 
  const [micPickerTrackId, setMicPickerTrackId] = useState<string | null>(null);
  const [availableMics, setAvailableMics] = useState<MediaDeviceInfo[]>([]);
  const [streamKey, setStreamKey] = useState(() => localStorage.getItem('aether_stream_key') || '');
  const [licenseKey, setLicenseKey] = useState(() => localStorage.getItem('aether_license_key') || '');
  const [streamQuality, setStreamQuality] = useState<'high' | 'medium' | 'low'>(() => (localStorage.getItem('aether_stream_quality') as any) || 'medium');
  const [desktopConnected, setDesktopConnected] = useState(false);
  const [relayConnected, setRelayConnected] = useState(false);
  const [relayStatus, setRelayStatus] = useState<string | null>(null);
  const [peerId, setPeerId] = useState<string>('');
  const [isRecording, setIsRecording] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{type: 'error' | 'info' | 'warn', text: string} | null>(null);
  
  const [roomId, setRoomId] = useState(() => {
     const saved = localStorage.getItem('aether_host_room_id');
     if (saved) return saved;
     const newId = generateRoomId(); 
     localStorage.setItem('aether_host_room_id', newId);
     return newId;
  });

  const isPro = licenseKey.startsWith('PRO_');

  // --- REFS ---
  const activeCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const keepAliveRef = useRef<number | null>(null);
  const mobileCamLayerIdRef = useRef<string | null>(null);
  const localRecorderRef = useRef<MediaRecorder | null>(null);
  const localChunksRef = useRef<Blob[]>([]);
  
  // Audio Refs
  const audioContext = useRef<AudioContext | null>(null);
  const audioDestination = useRef<MediaStreamAudioDestinationNode | null>(null);
  const audioSources = useRef<Map<string, MediaStreamAudioSourceNode>>(new Map());
  const audioGains = useRef<Map<string, GainNode>>(new Map());
  const audioFilters = useRef<Map<string, BiquadFilterNode>>(new Map());
  const hyperGateNodes = useRef<Map<string, { input: GainNode; hp: BiquadFilterNode; analyser: AnalyserNode; gate: GainNode; }>>(new Map());
  const hyperGateState = useRef<Map<string, { isOpen: boolean; lastAboveMs: number; lastDb: number; }>>(new Map());

  // Connection Refs
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamingSocketRef = useRef<WebSocket | null>(null);
  const peerRef = useRef<Peer | null>(null);
  const cloudDisconnectTimerRef = useRef<number | null>(null);
  const cloudSyncTimerRef = useRef<number | null>(null);

  // --- EFFECTS ---

  // Audio Context Resume
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

  // Persist Settings
  useEffect(() => {
      localStorage.setItem('aether_stream_key', streamKey);
  }, [streamKey]);

  useEffect(() => {
      localStorage.setItem('aether_license_key', licenseKey);
  }, [licenseKey]);

  // UI Tab Switching
  useEffect(() => {
    if (selectedLayerId) setRightPanelTab('properties');
  }, [selectedLayerId]);

  // Status Message Auto-Dismiss
  useEffect(() => {
    if (statusMsg) {
      const timer = setTimeout(() => setStatusMsg(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [statusMsg]);

  // Video Resolution Event Listener
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

  // --- AUDIO ENGINE ---
  useEffect(() => {
    if (!audioContext.current) {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        audioContext.current = new AudioContextClass();
        audioDestination.current = audioContext.current.createMediaStreamDestination();
    }
    const ctx = audioContext.current;
    const dest = audioDestination.current;
    if (!ctx || !dest) return;

    // Cleanup removed tracks
    const currentIds = new Set(audioTracks.map(t => t.id));
    audioSources.current.forEach((_, id) => {
        if (!currentIds.has(id)) {
            audioSources.current.get(id)?.disconnect();
            audioGains.current.get(id)?.disconnect();
            audioFilters.current.get(id)?.disconnect();
            audioSources.current.delete(id);
            audioGains.current.delete(id);
            audioFilters.current.delete(id);
            hyperGateNodes.current.delete(id);
        }
    });

    // Add/Update tracks
    audioTracks.forEach(track => {
        if (!track.stream) return;
        
        if (!audioSources.current.has(track.id)) {
            const source = ctx.createMediaStreamSource(track.stream);
            
            // HyperGate Chain
            const hg = createHyperGateChain(ctx);
            source.connect(hg.input);
            
            // Filter & Gain
            const filter = ctx.createBiquadFilter();
            const gain = ctx.createGain();
            
            hg.gate.connect(filter);
            filter.connect(gain);
            gain.connect(dest);

            audioSources.current.set(track.id, source);
            audioGains.current.set(track.id, gain);
            audioFilters.current.set(track.id, filter);
            hyperGateNodes.current.set(track.id, hg);
        }

        const gainNode = audioGains.current.get(track.id);
        if (gainNode) {
            gainNode.gain.setTargetAtTime(track.muted ? 0 : (track.volume / 100), ctx.currentTime, 0.05);
        }
    });

    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  }, [audioTracks]);

  // HyperGate Processing Loop
  useEffect(() => {
    const ctx = audioContext.current;
    if (!ctx) return;

    const timer = window.setInterval(() => {
        const now = Date.now();
        hyperGateNodes.current.forEach((nodes, trackId) => {
            const track = audioTracks.find(t => t.id === trackId);
            if (!track || !track.noiseCancellation) return;

            const st = hyperGateState.current.get(trackId) || { isOpen: true, lastAboveMs: now, lastDb: -120 };
            const db = rmsDbFromAnalyser(nodes.analyser);
            st.lastDb = db;

            const thresholdDb = -45;
            const holdMs = 220;
            const openGain = 1.0;
            const closedGain = 0.03;
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

  // --- PEERJS SIGNALING ---
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

    // Cleanup old peer if ID changed
    const existing: any = peerRef.current;
    if (existing && !existing.destroyed && existing.id !== myPeerId) {
        try { existing.destroy(); } catch {}
        peerRef.current = null;
    }

    // Keepalive loop
    if (keepAliveRef.current) {
        window.clearInterval(keepAliveRef.current);
        keepAliveRef.current = null;
    }

    // Reuse existing peer if valid
    const stillAlive: any = peerRef.current;
    if (stillAlive && !stillAlive.destroyed && stillAlive.id === myPeerId) {
        if (stillAlive.id) setPeerId(stillAlive.id);
        if (!stillAlive.disconnected) {
            setCloudConnected(true);
            setCloudError(null);
        }
    } else {
        // Create new Peer
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
            if (err?.type === "unavailable-id") {
                rotateRoomId();
            }
        });

        peer.on("call", (call) => {
            setStatusMsg({ type: "info", text: "Mobile Camera Incoming..." });
            call.answer();
            call.on("stream", (remoteStream) => handleMobileStream(remoteStream));
        });
    }

    // Keepalive Interval
    keepAliveRef.current = window.setInterval(() => {
        const p: any = peerRef.current;
        if (!p) return;
        if (p.disconnected) {
            try { p.reconnect(); } catch {}
        }
    }, 5000);

    // Sync Timer
    if (cloudSyncTimerRef.current) window.clearInterval(cloudSyncTimerRef.current);
    cloudSyncTimerRef.current = window.setInterval(() => {
        const p: any = peerRef.current;
        if (!p || p.destroyed) return;
        if (p.open) {
            setCloudConnected((prev) => (prev ? prev : true));
            setCloudError(null);
        }
    }, 1000);

    // Relay Connection
    let ws: WebSocket | null = null;
    let relayRetryTimer: number | null = null;
    
    const wsUrlRaw = (import.meta.env.VITE_SIGNAL_URL as string) || (import.meta.env.VITE_RELAY_WS_URL as string);
    const wsUrlLocal = import.meta.env.VITE_SIGNAL_URL_LOCAL as string;
    const isLocalHost = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
    const wsUrl = (isLocalHost ? wsUrlLocal : wsUrlRaw) || wsUrlRaw;

    const connectRelay = () => {
        if (!wsUrl) return;
        try {
            ws = new WebSocket(wsUrl);
            streamingSocketRef.current = ws;

            ws.onopen = () => {
                setRelayConnected(true);
                setRelayStatus("Relay connected");
                ws?.send(JSON.stringify({
                    type: "join",
                    role: "host",
                    sessionId: roomId,
                    token: import.meta.env.VITE_RELAY_TOKEN,
                }));
            };

            ws.onclose = (ev) => {
                setRelayConnected(false);
                setRelayStatus(`Relay closed (${ev.code})`);
                if (relayRetryTimer) window.clearTimeout(relayRetryTimer);
                relayRetryTimer = window.setTimeout(connectRelay, 1500);
            };

            ws.onerror = () => {
                setRelayConnected(false);
                setStatusMsg({ type: "error", text: "Relay connection failed" });
            };

            ws.onmessage = (ev) => {
                try {
                    const msg = JSON.parse(String(ev.data || "{}"));
                    if (msg?.type === "started") setRelayStatus("Relay streaming");
                    if (msg?.type === "error") setRelayStatus(`Relay error: ${msg.error || "unknown"}`);
                } catch {}
            };
        } catch {}
    };

    connectRelay();

    return () => {
        if (keepAliveRef.current) clearInterval(keepAliveRef.current);
        if (cloudDisconnectTimerRef.current) clearTimeout(cloudDisconnectTimerRef.current);
        if (cloudSyncTimerRef.current) clearInterval(cloudSyncTimerRef.current);
        if (relayRetryTimer) clearTimeout(relayRetryTimer);
        
        try { ws?.close(); } catch {}
        
        const p: any = peerRef.current;
        if (p && p.id === myPeerId) {
            try { p.destroy(); } catch {}
            peerRef.current = null;
        }
    };
  }, [roomId]); // Re-run if room ID changes

  // --- HELPER FUNCTIONS ---

  const handleMobileStream = (stream: MediaStream) => {
      setLayers(prev => {
          const safePrev = Array.isArray(prev) ? prev : [];
          const existingIdx = safePrev.findIndex(l => l.label === 'Mobile Cam' && l.type === SourceType.CAMERA);
          
          if (existingIdx >= 0) {
              const newLayers = [...safePrev];
              newLayers[existingIdx] = { ...newLayers[existingIdx], src: stream };
              mobileCamLayerIdRef.current = newLayers[existingIdx].id;
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
  };

  const regenerateRoomId = () => {
      const newId = generateRoomId();
      setRoomId(newId);
      localStorage.setItem('aether_host_room_id', newId);
      setStatusMsg({ type: 'info', text: "New Room ID Generated." });
  };

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
      activeCanvasRef.current = canvas;
  };

  const getMixedStream = () => {
    if (!activeCanvasRef.current) return null;
    const canvasStream = activeCanvasRef.current.captureStream(30);
    const audioStream = audioDestination.current?.stream;
    return new MediaStream([...canvasStream.getVideoTracks(), ...(audioStream ? audioStream.getAudioTracks() : [])]);
  };

  const openVirtualCable = () => {
    if (audioContext.current?.state === 'suspended') {
        audioContext.current.resume();
    }
    
    if (!activeCanvasRef.current) return;
    
    const win = window.open('', 'AetherVirtualCable', 'width=1280,height=720,menubar=no,toolbar=no,location=no,status=no,resizable=yes');
    if (!win) {
        setStatusMsg({ type: 'error', text: "Popup blocked! Allow popups for Virtual Cable." });
        return;
    }

    win.document.title = "Aether Virtual Output";
    win.document.body.style.margin = '0';
    win.document.body.style.backgroundColor = 'black';
    win.document.body.style.overflow = 'hidden';
    win.document.body.style.display = 'flex';
    win.document.body.style.alignItems = 'center';
    win.document.body.style.justifyContent = 'center';

    const outCanvas = win.document.createElement('canvas');
    outCanvas.width = 1920;
    outCanvas.height = 1080;
    outCanvas.style.width = '100vw';
    outCanvas.style.height = '100vh';
    outCanvas.style.objectFit = 'contain';
    win.document.body.appendChild(outCanvas);
    
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

    const ctx = outCanvas.getContext('2d');
    const syncLoop = () => {
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
      if (mediaRecorderRef.current) mediaRecorderRef.current.stop();
      if (streamingSocketRef.current && streamingSocketRef.current.readyState === WebSocket.OPEN) {
          streamingSocketRef.current.send(JSON.stringify({ type: 'stop-stream' }));
      }
      setStreamStatus(StreamStatus.IDLE);
    } else {
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

      if (streamingSocketRef.current && streamingSocketRef.current.readyState === WebSocket.OPEN) {
          streamingSocketRef.current.send(JSON.stringify({ 
              type: 'start-stream', 
               streamKey: cleanKey,
               token: import.meta.env.VITE_RELAY_TOKEN             
          }));
      }

      const preferred = 'video/webm;codecs=vp8,opus';
      
      // QUALITY PRESETS
      // Slightly reduced bitrates for "Low" to ensure stability on bad connections
      const qualitySettings = {
          high: { v: 6_000_000, a: 192_000, fps: 30 },
          medium: { v: 2_500_000, a: 128_000, fps: 30 }, // Reduced Medium from 3M to 2.5M
          low: { v: 1_000_000, a: 64_000, fps: 24 }      // Aggressive Low: 1Mbps, 64k audio, 24fps
      };
      
      const { v: vBits, a: aBits, fps } = qualitySettings[streamQuality];

      // Request a Keyframe (I-frame) every 2 seconds if possible (browser support varies)
      // This helps YouTube resync faster if packets drop.
      // Note: MediaRecorder doesn't expose strict GOP control, but we can hint via start(timeslice).
      
      const options = MediaRecorder.isTypeSupported(preferred)
        ? { mimeType: preferred, videoBitsPerSecond: vBits, audioBitsPerSecond: aBits }
        : { mimeType: 'video/webm', videoBitsPerSecond: vBits, audioBitsPerSecond: aBits };

      // Ensure canvas capture matches target FPS to reduce redundant encoding work
      const streamToRecord = activeCanvasRef.current 
          ? new MediaStream([
              ...activeCanvasRef.current.captureStream(fps).getVideoTracks(),
              ...(audioDestination.current?.stream.getAudioTracks() || [])
            ])
          : combinedStream;

      const recorder = new MediaRecorder(streamToRecord, options);
      
      recorder.ondataavailable = (e) => {
          // BUFFER CHECK: Prevent upload saturation
          // If the socket buffer is full (> 256KB), drop the frame to prevent indefinite lag buildup.
          // This causes a "glitch" on YouTube but prevents the stream from drifting 30s behind real-time.
          if (streamingSocketRef.current?.readyState === WebSocket.OPEN) {
             if (streamingSocketRef.current.bufferedAmount > 256 * 1024) {
                 setStatusMsg({ type: 'warn', text: "Network congestion: Dropping frames!" });
             } else if (e.data.size > 0) {
                 streamingSocketRef.current.send(e.data);
             }
          }
      };

      // 1000ms timeslice forces more frequent data flushes, reducing "burstiness" sent to YouTube
      // This is smoother than 250ms chunks which might be too fragmented for some networks
      recorder.start(1000); 
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

  const canStartLive = (cloudConnected === true) && (relayConnected === true) && streamKey.trim().length > 0;
  const canToggleLive = streamStatus === StreamStatus.LIVE || canStartLive;

  function createHyperGateChain(ctx: AudioContext) {
    const input = ctx.createGain();
    input.gain.value = 1;
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 120;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.85;
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

  // --- RENDER ---
  return (
    <div className="fixed inset-0 flex flex-col w-full bg-aether-900 text-gray-200 font-sans selection:bg-aether-500 selection:text-white relative overflow-hidden">
      <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleFileUpload} />
      
      {statusMsg && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 px-6 py-3 rounded-xl text-sm font-bold flex flex-col items-center gap-1 shadow-lg bg-aether-800 border border-aether-700 z-50">
          <div className="flex items-center gap-3">
            <AlertCircle size={20} className={statusMsg.type === 'error' ? 'text-red-400' : 'text-blue-400'} />
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
                    try {
                      const s = await navigator.mediaDevices.getUserMedia({
                        audio: { deviceId: { exact: m.deviceId } },
                        video: false
                      });
                      setAudioTracks(prev => prev.map(t => t.id === micPickerTrackId ? { ...t, stream: s } : t));
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

           <div className={`flex items-center gap-2 px-3 py-1 rounded-full text-xs font-bold uppercase border ${relayConnected ? 'bg-green-500/10 border-green-500/20 text-green-400' : 'bg-red-500/10 border-red-500/20 text-red-400'}`} title={relayStatus || undefined}>
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
                {rightPanelTab === 'properties' ? <LayerProperties layer={layers.find(l => l.id === selectedLayerId) || null} onUpdate={updateLayer} onDelete={deleteLayer} isPro={isPro} /> : <AIPanel onAddLayer={(src) => addImageLayer(src, 'AI Background')} />}
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
              
              <div>
                  <label className="text-gray-400 text-sm">Stream Quality (Target Bitrate)</label>
                  <select 
                      value={streamQuality}
                      onChange={(e) => {
                          const val = e.target.value as any;
                          setStreamQuality(val);
                          localStorage.setItem('aether_stream_quality', val);
                      }}
                      className="w-full bg-aether-800 border border-aether-700 rounded p-2 text-sm text-white focus:border-aether-500 outline-none"
                  >
                      <option value="high">High (6 Mbps - 1080p60)</option>
                      <option value="medium">Medium (3 Mbps - 1080p30)</option>
                      <option value="low">Low (1.5 Mbps - 720p30)</option>
                  </select>
                  <p className="text-[10px] text-gray-500 mt-1">Lower this if YouTube complains about "Low Signal" or buffering.</p>
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6"><button onClick={() => setShowSettings(false)} className="px-4 py-2 rounded text-sm bg-aether-500 text-white">Done</button></div>
          </div>
        </div>
      )}
    </div>
  );
};