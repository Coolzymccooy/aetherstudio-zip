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

const SourcePreview: React.FC<{ stream?: MediaStream }> = ({ stream }) => {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current) {
      (ref.current as any).srcObject = stream || null;
    }
  }, [stream]);
  if (!stream) {
    return <div className="w-16 h-10 bg-black/40 rounded border border-aether-700" />;
  }
  return <video ref={ref} autoPlay muted playsInline className="w-16 h-10 object-cover rounded border border-aether-700" />;
};

export const StudioCore: React.FC<StudioProps> = ({ user, onBack }) => {
  // --- STATE DECLARATIONS ---
  const [cloudConnected, setCloudConnected] = useState(false);
  const [layers, setLayers] = useState<Layer[]>([]);
  const [audioTracks, setAudioTracks] = useState<AudioTrackConfig[]>([]);
  const [streamStatus, setStreamStatus] = useState<StreamStatus>(StreamStatus.IDLE);
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);
  const [rightPanelTab, setRightPanelTab] = useState<'properties' | 'ai' | 'inputs'>('ai');
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
  const [streamHealth, setStreamHealth] = useState<{ kbps: number; drops: number; rttMs: number | null; queueKb: number }>({
    kbps: 0,
    drops: 0,
    rttMs: null,
    queueKb: 0,
  });

  type CameraSourceKind = 'local' | 'phone';
  type CameraSourceStatus = 'pending' | 'live' | 'failed';
  type CameraSource = {
    id: string;
    kind: CameraSourceKind;
    label: string;
    status: CameraSourceStatus;
    layerId?: string;
    stream?: MediaStream;
    peerId?: string;
    audioTrackId?: string;
  };

  const [cameraSources, setCameraSources] = useState<CameraSource[]>([]);
  const [activePhoneSourceId, setActivePhoneSourceId] = useState<string | null>(null);
  const [composerMode, setComposerMode] = useState(false);
  const [autoDirectorOn, setAutoDirectorOn] = useState(() => localStorage.getItem('aether_auto_director') === 'true');
  const [autoDirectorInterval, setAutoDirectorInterval] = useState(() => Number(localStorage.getItem('aether_auto_director_interval') || 12));

  const [lowerThirdName, setLowerThirdName] = useState(() => localStorage.getItem('aether_lower_third_name') || 'Guest Name');
  const [lowerThirdTitle, setLowerThirdTitle] = useState(() => localStorage.getItem('aether_lower_third_title') || 'Title / Role');
  const [lowerThirdVisible, setLowerThirdVisible] = useState(false);

  const [pinnedMessage, setPinnedMessage] = useState(() => localStorage.getItem('aether_pinned_message') || '');
  const [tickerMessage, setTickerMessage] = useState(() => localStorage.getItem('aether_ticker_message') || '');
  const [pinnedVisible, setPinnedVisible] = useState(false);
  const [tickerVisible, setTickerVisible] = useState(false);

  type StreamDestination = { id: string; label: string; url: string; enabled: boolean };
  const [destinations, setDestinations] = useState<StreamDestination[]>(() => {
    try {
      const raw = localStorage.getItem('aether_stream_destinations');
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });

  type ScenePreset = {
    id: string;
    name: string;
    layout: 'freeform' | 'main_thumbs' | 'grid_2x2';
    mainLayerId?: string | null;
    positions: Array<{ layerId: string; x: number; y: number; width: number; height: number; zIndex: number }>;
  };
  const [scenePresets, setScenePresets] = useState<ScenePreset[]>(() => {
    try {
      const raw = localStorage.getItem('aether_scene_presets');
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });
  const [presetName, setPresetName] = useState('Main + Thumbs');
  const [layoutTemplate, setLayoutTemplate] = useState<'freeform' | 'main_thumbs' | 'grid_2x2'>('main_thumbs');

  const [transitionMode, setTransitionMode] = useState<'cut' | 'fade'>(() => {
    return (localStorage.getItem('aether_transition_mode') as any) || 'fade';
  });
  const [transitionMs, setTransitionMs] = useState(() => Number(localStorage.getItem('aether_transition_ms') || 300));
  const [transitionAlpha, setTransitionAlpha] = useState(0);

  const [peerMode, setPeerMode] = useState<'cloud' | 'custom'>(() => {
     return (localStorage.getItem('aether_peer_mode') as any) || 'cloud';
  });
  const [peerUiMode, setPeerUiMode] = useState<'auto' | 'local' | 'advanced'>(() => {
     return (localStorage.getItem('aether_peer_ui_mode') as any) || 'auto';
  });
  const [peerHost, setPeerHost] = useState(() => localStorage.getItem('aether_peer_host') || 'localhost');
  const [peerPort, setPeerPort] = useState(() => localStorage.getItem('aether_peer_port') || '9000');
  const [peerPath, setPeerPath] = useState(() => localStorage.getItem('aether_peer_path') || '/peerjs');
  const [peerSecure, setPeerSecure] = useState(() => {
     const raw = localStorage.getItem('aether_peer_secure');
     if (raw === null) return false;
     return raw === 'true';
  });
  
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
  const mobileMetaRef = useRef<Map<string, { sourceId?: string; label?: string }>>(new Map());
  const phonePendingTimersRef = useRef<Map<string, number>>(new Map());
  const lowerThirdIdsRef = useRef<{ nameId?: string; titleId?: string }>({});
  const pinnedLayerIdRef = useRef<string | null>(null);
  const tickerLayerIdRef = useRef<string | null>(null);
  const autoDirectorTimerRef = useRef<number | null>(null);
  const liveIntentRef = useRef<boolean>(false);
  const liveStartGuardRef = useRef<number>(0);
  const transitionRafRef = useRef<number | null>(null);
  const streamHealthRef = useRef<{ bytes: number; drops: number; lastTs: number }>({ bytes: 0, drops: 0, lastTs: Date.now() });
  const streamHealthTimerRef = useRef<number | null>(null);
  const relayPingTimerRef = useRef<number | null>(null);

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

  useEffect(() => {
      localStorage.setItem('aether_auto_director', String(autoDirectorOn));
      localStorage.setItem('aether_auto_director_interval', String(autoDirectorInterval || 12));
  }, [autoDirectorOn, autoDirectorInterval]);

  useEffect(() => {
      localStorage.setItem('aether_lower_third_name', lowerThirdName);
      localStorage.setItem('aether_lower_third_title', lowerThirdTitle);
  }, [lowerThirdName, lowerThirdTitle]);

  useEffect(() => {
      localStorage.setItem('aether_pinned_message', pinnedMessage);
      localStorage.setItem('aether_ticker_message', tickerMessage);
  }, [pinnedMessage, tickerMessage]);

  useEffect(() => {
      localStorage.setItem('aether_stream_destinations', JSON.stringify(destinations));
  }, [destinations]);

  useEffect(() => {
      localStorage.setItem('aether_scene_presets', JSON.stringify(scenePresets));
  }, [scenePresets]);

  useEffect(() => {
      localStorage.setItem('aether_transition_mode', transitionMode);
      localStorage.setItem('aether_transition_ms', String(transitionMs || 300));
  }, [transitionMode, transitionMs]);

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

  useEffect(() => {
    if (streamHealthTimerRef.current) {
      window.clearInterval(streamHealthTimerRef.current);
      streamHealthTimerRef.current = null;
    }
    if (streamStatus !== StreamStatus.LIVE) {
      setStreamHealth((prev) => ({ ...prev, kbps: 0, drops: 0, queueKb: 0 }));
      streamHealthRef.current = { bytes: 0, drops: 0, lastTs: Date.now() };
      return;
    }

    streamHealthRef.current = { bytes: 0, drops: 0, lastTs: Date.now() };
    streamHealthTimerRef.current = window.setInterval(() => {
      const now = Date.now();
      const elapsed = Math.max(1, (now - streamHealthRef.current.lastTs) / 1000);
      const kbps = Math.round((streamHealthRef.current.bytes * 8) / 1000 / elapsed);
      const queueKb = Math.round((streamingSocketRef.current?.bufferedAmount || 0) / 1024);
      setStreamHealth((prev) => ({
        ...prev,
        kbps,
        drops: streamHealthRef.current.drops,
        queueKb,
      }));
      streamHealthRef.current.bytes = 0;
      streamHealthRef.current.lastTs = now;
    }, 1000);

    return () => {
      if (streamHealthTimerRef.current) {
        window.clearInterval(streamHealthTimerRef.current);
        streamHealthTimerRef.current = null;
      }
    };
  }, [streamStatus]);

  useEffect(() => {
    if (relayPingTimerRef.current) {
      window.clearInterval(relayPingTimerRef.current);
      relayPingTimerRef.current = null;
    }
    if (!relayConnected) {
      setStreamHealth((prev) => ({ ...prev, rttMs: null }));
      return;
    }
    relayPingTimerRef.current = window.setInterval(() => {
      const ws = streamingSocketRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify({ type: "ping", t: Date.now(), token: import.meta.env.VITE_RELAY_TOKEN }));
    }, 5000);
    return () => {
      if (relayPingTimerRef.current) {
        window.clearInterval(relayPingTimerRef.current);
        relayPingTimerRef.current = null;
      }
    };
  }, [relayConnected]);

  useEffect(() => {
    if (lowerThirdVisible) ensureLowerThirdLayers();
    updateLowerThirdContent();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lowerThirdName, lowerThirdTitle]);

  useEffect(() => {
    const id = pinnedLayerIdRef.current;
    if (!id) return;
    setLayers(prev => prev.map(l => l.id === id ? { ...l, content: pinnedMessage } : l));
  }, [pinnedMessage]);

  useEffect(() => {
    const id = tickerLayerIdRef.current;
    if (!id) return;
    setLayers(prev => prev.map(l => l.id === id ? { ...l, content: tickerMessage } : l));
  }, [tickerMessage]);

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

        peer.on("connection", (conn) => {
            conn.on("data", (data: any) => {
                if (data?.type === "mobile-handshake") {
                    mobileMetaRef.current.set(conn.peer, {
                        sourceId: data.sourceId,
                        label: data.label,
                    });
                }
            });
        });

        peer.on("call", (call) => {
            setStatusMsg({ type: "info", text: "Mobile Camera Incoming..." });
            call.answer();
            call.on("stream", (remoteStream) => {
                const metaFromCall: any = (call as any).metadata || {};
                const metaFromConn = mobileMetaRef.current.get(call.peer) || {};
                const sourceId = metaFromCall.sourceId || metaFromConn.sourceId || generateId();
                const label = metaFromCall.label || metaFromConn.label || "Phone Cam";
                handleMobileStream(remoteStream, sourceId, label, call.peer);
            });
            call.on("close", () => {
                const metaFromConn = mobileMetaRef.current.get(call.peer) || {};
                const sourceId = metaFromConn.sourceId;
                if (sourceId) {
                  setCameraSources(prev => prev.map(s => s.id === sourceId ? { ...s, status: 'failed' } : s));
                }
            });
            call.on("error", () => {
                const metaFromConn = mobileMetaRef.current.get(call.peer) || {};
                const sourceId = metaFromConn.sourceId;
                if (sourceId) {
                  setCameraSources(prev => prev.map(s => s.id === sourceId ? { ...s, status: 'failed' } : s));
                }
            });
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
    
    const wsUrl = getRelayWsUrl();

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
                if (liveIntentRef.current) {
                    const now = Date.now();
                    if (now - liveStartGuardRef.current > 1500) {
                        liveStartGuardRef.current = now;
                        startStreamingSession({ fromReconnect: true, forceRestart: false });
                        setStatusMsg({ type: 'info', text: "Relay reconnected. Resuming stream..." });
                    }
                }
            };

            ws.onclose = (ev) => {
                setRelayConnected(false);
                setRelayStatus(`Relay closed (${ev.code})`);
                setStreamHealth((prev) => ({ ...prev, rttMs: null }));
                if (liveIntentRef.current) {
                    setStatusMsg({ type: 'warn', text: "Relay lost. Attempting to reconnect..." });
                }
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
                    if (msg?.type === "pong" && msg?.echo) {
                        const rtt = Date.now() - Number(msg.echo);
                        setStreamHealth((prev) => ({ ...prev, rttMs: rtt }));
                        return;
                    }
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

  const handleMobileStream = (stream: MediaStream, sourceId: string, label: string, peerId?: string) => {
      const existingSource = cameraSources.find(s => s.id === sourceId);
      let layerId = existingSource?.layerId;
      const pendingTimer = phonePendingTimersRef.current.get(sourceId);
      if (pendingTimer) {
        window.clearTimeout(pendingTimer);
        phonePendingTimersRef.current.delete(sourceId);
      }

      setLayers(prev => {
          const safePrev = Array.isArray(prev) ? prev : [];
          if (layerId) {
              return safePrev.map(l => l.id === layerId ? { ...l, src: stream, label } : l);
          }
          const newLayer: Layer = {
            id: generateId(),
            type: SourceType.CAMERA,
            label: label || 'Phone Cam',
            visible: true,
            x: 50, y: 50, width: 480, height: 270,
            src: stream,
            zIndex: safePrev.length + 10,
            style: { circular: false, border: true, borderColor: '#7c3aed' }
          };
          layerId = newLayer.id;
          return [...safePrev, newLayer];
       });

       if (layerId) {
         mobileCamLayerIdRef.current = layerId;
       }

       setCameraSources(prev => {
         const idx = prev.findIndex(s => s.id === sourceId);
         if (idx >= 0) {
           const next = [...prev];
           next[idx] = { ...next[idx], label, status: 'live', stream, layerId, peerId };
           return next;
         }
         return [...prev, { id: sourceId, kind: 'phone', label, status: 'live', stream, layerId, peerId }];
       });

       const micId = `mobile-mic-${sourceId}`;
       setAudioTracks(prev => {
           if (prev.some(t => t.id === micId)) {
               return prev.map(t => t.id === micId ? { ...t, stream: stream, label: `${label} Mic` } : t);
           }
           return [...prev, { 
               id: micId, 
               label: `${label} Mic`, 
               volume: 100, 
               muted: false, 
               isMic: true, 
               noiseCancellation: false, 
               stream: stream 
            }];
       });

       setStatusMsg({ type: 'info', text: `${label} Connected & Live!` });
       setShowQRModal(false);

       setCameraSources(prev => prev.map(s => s.id === sourceId ? { ...s, audioTrackId: micId } : s));
  };

  const regenerateRoomId = () => {
      const newId = generateRoomId();
      setRoomId(newId);
      localStorage.setItem('aether_host_room_id', newId);
      setStatusMsg({ type: 'info', text: "New Room ID Generated." });
  };

  const addCameraSource = async (videoDeviceId: string, audioDeviceId: string, videoLabel: string) => {
    try {
      const audioConstraint = audioDeviceId ? { deviceId: { exact: audioDeviceId } } : false;
      const attempts: MediaStreamConstraints[] = [
        { video: { deviceId: { exact: videoDeviceId }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: audioConstraint },
        { video: { deviceId: { exact: videoDeviceId } }, audio: audioConstraint },
        { video: true, audio: audioConstraint },
      ];

      let stream: MediaStream | null = null;
      let lastErr: any = null;
      for (const constraints of attempts) {
        try {
          stream = await navigator.mediaDevices.getUserMedia(constraints);
          break;
        } catch (err) {
          lastErr = err;
        }
      }
      if (!stream) throw lastErr;
      
      const layerId = generateId();
      const newLayer: Layer = {
        id: layerId, type: SourceType.CAMERA, label: videoLabel || 'Camera', visible: true, x: 0, y: 0, width: 1920, height: 1080, src: stream, zIndex: layers.length + 1, style: {}
      };
      setLayers(prev => [...prev, newLayer]);
      let audioTrackId: string | undefined;
      if (stream.getAudioTracks().length > 0) {
        audioTrackId = generateId();
        setAudioTracks(prev => [...prev, { id: audioTrackId!, label: `${videoLabel || 'Cam'} Mic`, volume: 100, muted: false, isMic: true, noiseCancellation: false, stream }]);
      }
      const sourceId = generateId();
      setCameraSources(prev => [
        ...prev,
        {
          id: sourceId,
          kind: 'local',
          label: videoLabel || `Camera ${prev.filter(s => s.kind === 'local').length + 1}`,
          status: 'live',
          layerId,
          stream,
          audioTrackId,
        }
      ]);
      setSelectedLayerId(layerId);
      setShowDeviceSelector(false);
    } catch (err) {
      const name = (err as any)?.name || '';
      let msg = "Failed to access device.";
      if (name === 'NotReadableError') msg = "Camera is busy or already in use. Close other apps and retry.";
      else if (name === 'NotAllowedError' || name === 'SecurityError') msg = "Camera permission blocked. Allow access in browser settings.";
      else if (name === 'NotFoundError') msg = "No camera device found.";
      setStatusMsg({ type: 'error', text: msg });
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

  const buildMulticastDestinations = () => {
    const enabled = destinations.filter(d => d.enabled && d.url.trim()).map(d => d.url.trim());
    return enabled;
  };

  const startStreamingSession = async (opts?: { fromReconnect?: boolean; forceRestart?: boolean }) => {
    if (audioContext.current?.state === 'suspended') {
      await audioContext.current.resume();
    }

    const cleanKey = streamKey.trim();
    if (!cleanKey) {
      if (!opts?.fromReconnect) {
        setStatusMsg({ type: 'error', text: "No Stream Key Set! Check Settings." });
        setShowSettings(true);
      }
      return;
    }

    if (!relayConnected && !opts?.fromReconnect) {
      setStatusMsg({ type: 'error', text: "Relay Offline. Wait for relay to connect." });
      return;
    }

    const combinedStream = getMixedStream();
    if (!combinedStream) {
      setStatusMsg({ type: 'error', text: "Initialization Error. Refresh page." });
      return;
    }

    const destinationsList = buildMulticastDestinations();

    if (streamingSocketRef.current && streamingSocketRef.current.readyState === WebSocket.OPEN) {
      streamingSocketRef.current.send(JSON.stringify({
        type: 'start-stream',
        streamKey: cleanKey,
        destinations: destinationsList,
        token: import.meta.env.VITE_RELAY_TOKEN
      }));
    }

    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording' && !opts?.forceRestart) {
      setStreamStatus(StreamStatus.LIVE);
      return;
    }

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try { mediaRecorderRef.current.stop(); } catch {}
    }

    const preferred = 'video/webm;codecs=vp8,opus';
    const qualitySettings = {
      high: { v: 6_000_000, a: 192_000, fps: 30 },
      medium: { v: 2_500_000, a: 128_000, fps: 30 },
      low: { v: 1_000_000, a: 64_000, fps: 24 }
    };

    const { v: vBits, a: aBits, fps } = qualitySettings[streamQuality];

    const options = MediaRecorder.isTypeSupported(preferred)
      ? { mimeType: preferred, videoBitsPerSecond: vBits, audioBitsPerSecond: aBits }
      : { mimeType: 'video/webm', videoBitsPerSecond: vBits, audioBitsPerSecond: aBits };

    const streamToRecord = activeCanvasRef.current
      ? new MediaStream([
          ...activeCanvasRef.current.captureStream(fps).getVideoTracks(),
          ...(audioDestination.current?.stream.getAudioTracks() || [])
        ])
      : combinedStream;

    const recorder = new MediaRecorder(streamToRecord, options);

    recorder.ondataavailable = (e) => {
      const socket = streamingSocketRef.current;
      if (socket?.readyState === WebSocket.OPEN) {
        if (socket.bufferedAmount > 256 * 1024) {
          streamHealthRef.current.drops += 1;
          setStatusMsg({ type: 'warn', text: "Network congestion: Dropping frames!" });
          return;
        }
        if (e.data.size > 0) {
          streamHealthRef.current.bytes += e.data.size;
          socket.send(e.data);
        }
      }
    };

    recorder.start(1000);
    mediaRecorderRef.current = recorder;
    setStreamStatus(StreamStatus.LIVE);
  };

  const toggleLive = async () => {
    if (streamStatus === StreamStatus.LIVE) {
      liveIntentRef.current = false;
      if (mediaRecorderRef.current) mediaRecorderRef.current.stop();
      if (streamingSocketRef.current && streamingSocketRef.current.readyState === WebSocket.OPEN) {
          streamingSocketRef.current.send(JSON.stringify({ type: 'stop-stream' }));
      }
      setStreamStatus(StreamStatus.IDLE);
    } else {
      liveIntentRef.current = true;
      if (!cloudConnected) {
        const hasPhones = cameraSources.some(s => s.kind === 'phone');
        if (hasPhones) {
          setStatusMsg({ type: 'warn', text: "PeerJS offline — phone cameras may not connect, but you can still stream." });
        }
      }
      setStatusMsg({ type: 'info', text: `Starting RTMP Stream...` });
      await startStreamingSession();
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
     if (auth) {
       signOut(auth).catch(console.error);
     }
     onBack();
  };

  const canStartLive = (relayConnected === true) && streamKey.trim().length > 0;
  const canToggleLive = streamStatus === StreamStatus.LIVE || canStartLive;

  const applyPeerSettings = () => {
    localStorage.setItem('aether_peer_ui_mode', peerUiMode);
    localStorage.setItem('aether_peer_mode', peerMode);
    localStorage.setItem('aether_peer_host', peerHost.trim());
    localStorage.setItem('aether_peer_port', String(Number(peerPort) || 9000));
    localStorage.setItem('aether_peer_path', peerPath.trim() || '/peerjs');
    localStorage.setItem('aether_peer_secure', peerSecure ? 'true' : 'false');
    window.location.reload();
  };

  const fetchWithTimeout = async (input: RequestInfo | URL, init: RequestInit, timeoutMs = 1200) => {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(input, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(id);
    }
  };

  const getRelayWsUrl = () => {
    const wsUrlRaw = (import.meta.env.VITE_SIGNAL_URL as string) || (import.meta.env.VITE_RELAY_WS_URL as string);
    const wsUrlLocal = import.meta.env.VITE_SIGNAL_URL_LOCAL as string;
    const currentHost = window.location.hostname;
    const isLocalHost = currentHost === "localhost" || currentHost === "127.0.0.1";
    let wsUrl = (isLocalHost ? wsUrlLocal : wsUrlRaw) || wsUrlRaw;
    if (!wsUrl) return "";
    try {
      const u = new URL(wsUrl);
      if (!isLocalHost && (u.hostname === "localhost" || u.hostname === "127.0.0.1")) {
        u.hostname = currentHost;
        wsUrl = u.toString();
      }
    } catch {}
    return wsUrl.replace(/\/+$/, "");
  };

  const getRelayHttpBase = () => {
    const wsUrl = getRelayWsUrl();
    if (!wsUrl) return "";
    return wsUrl.replace(/^ws(s)?:\/\//i, "http$1://").replace(/\/+$/, "");
  };

  const checkRelayHealth = async () => {
    const base = getRelayHttpBase();
    if (!base) {
      setStatusMsg({ type: 'error', text: "Relay URL not configured." });
      return;
    }
    try {
      const res = await fetchWithTimeout(`${base}/health`, { method: 'GET' }, 1500);
      if (res.ok) {
        setStatusMsg({ type: 'info', text: "Relay OK." });
      } else {
        setStatusMsg({ type: 'warn', text: `Relay responded ${res.status}.` });
      }
    } catch {
      setStatusMsg({ type: 'error', text: "Relay check failed. Is the server running?" });
    }
  };

  const checkFfmpeg = async () => {
    const base = getRelayHttpBase();
    if (!base) {
      setStatusMsg({ type: 'error', text: "Relay URL not configured." });
      return;
    }
    try {
      const res = await fetchWithTimeout(`${base}/ffmpeg`, { method: 'GET' }, 2000);
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        setStatusMsg({ type: 'error', text: text || `FFmpeg check failed (${res.status}).` });
        return;
      }
      const json: any = await res.json().catch(() => ({}));
      setStatusMsg({ type: 'info', text: `FFmpeg OK: ${json?.version || 'available'}` });
    } catch {
      setStatusMsg({ type: 'error', text: "FFmpeg check failed. Is it installed on the relay server?" });
    }
  };

  const getMobileBaseUrl = () => {
    const forced = (import.meta as any).env?.VITE_MOBILE_BASE_URL as string | undefined;
    if (forced && forced.trim()) return forced.trim().replace(/\/$/, '');
    const saved = localStorage.getItem('aether_mobile_base_url');
    if (saved) return saved.replace(/\/$/, '');
    const origin = window.location.origin;
    if (origin && !origin.startsWith('about:') && !origin.startsWith('blob:') && !origin.startsWith('data:')) {
      return origin.replace(/\/$/, '');
    }
    return '';
  };

  const buildMobileUrl = (sourceId: string, sourceLabel?: string) => {
    let url = getMobileBaseUrl();
    if (!url) return '';
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = `https://${url}`;
    }
    try {
      const u = new URL(url);
      url = `${u.protocol}//${u.host}`;
    } catch {}
    const params = new URLSearchParams();
    params.set('mode', 'companion');
    params.set('room', roomId);
    params.set('sourceId', sourceId);
    if (sourceLabel) params.set('sourceLabel', sourceLabel);
    params.set('t', String(Date.now()));
    if (peerMode === 'custom') {
      let host = peerHost.trim();
      if (!host || host === "localhost" || host === "127.0.0.1") {
        try {
          const u = new URL(url);
          host = u.hostname;
        } catch {}
      }
      if (host) {
        params.set('peerMode', 'custom');
        params.set('peerHost', host);
        params.set('peerPort', peerPort);
        params.set('peerPath', peerPath);
        params.set('peerSecure', peerSecure ? 'true' : 'false');
      }
    }
    return `${url}/?${params.toString()}`;
  };

  useEffect(() => {
    if (peerUiMode === 'auto') {
      setPeerMode('cloud');
      return;
    }
    if (peerUiMode === 'local') {
      setPeerMode('custom');
      setPeerHost('localhost');
      setPeerPort('9000');
      setPeerPath('/peerjs');
      setPeerSecure(false);
    }
    if (peerUiMode === 'advanced') {
      setPeerMode('custom');
    }
  }, [peerUiMode]);

  const createPhoneSource = () => {
    const id = generateId();
    const label = `Phone Cam ${cameraSources.filter(s => s.kind === 'phone').length + 1}`;
    const src: CameraSource = { id, kind: 'phone', label, status: 'pending' };
    setCameraSources(prev => [...prev, src]);
    setActivePhoneSourceId(id);
    setShowQRModal(true);

    const timer = window.setTimeout(() => {
      setCameraSources(prev => prev.map(s => s.id === id && s.status === 'pending' ? { ...s, status: 'failed' } : s));
    }, 30000);
    phonePendingTimersRef.current.set(id, timer);
  };

  const openPhoneQr = (sourceId: string) => {
    setActivePhoneSourceId(sourceId);
    setCameraSources(prev => prev.map(s => s.id === sourceId && s.status === 'failed' ? { ...s, status: 'pending' } : s));
    setShowQRModal(true);
  };

  const updateSourceLabel = (id: string, label: string) => {
    setCameraSources(prev => prev.map(s => s.id === id ? { ...s, label } : s));
  };

  const removeSource = (id: string) => {
    const src = cameraSources.find(s => s.id === id);
    if (src?.stream) {
      try { src.stream.getTracks().forEach(t => t.stop()); } catch {}
    }
    if (src?.audioTrackId) {
      setAudioTracks(prev => prev.filter(t => t.id !== src.audioTrackId));
    }
    if (src?.layerId) {
      setLayers(prev => prev.filter(l => l.id !== src.layerId));
    }
    if (src?.layerId && selectedLayerId === src.layerId) {
      setSelectedLayerId(null);
    }
    if (src?.kind === 'phone') {
      const micId = `mobile-mic-${id}`;
      setAudioTracks(prev => prev.filter(t => t.id !== micId));
    }
    const timer = phonePendingTimersRef.current.get(id);
    if (timer) {
      window.clearTimeout(timer);
      phonePendingTimersRef.current.delete(id);
    }
    setCameraSources(prev => prev.filter(s => s.id !== id));
  };

  const makeMain = (layerId?: string) => {
    if (!layerId) return;
    const action = () => {
      setLayers(prev => {
        const maxZ = prev.reduce((m, l) => Math.max(m, l.zIndex), 0) + 1;
        return prev.map(l => l.id === layerId ? { ...l, x: 0, y: 0, width: 1920, height: 1080, zIndex: maxZ, visible: true } : l);
      });
      setSelectedLayerId(layerId);
      if (composerMode) {
        setTimeout(() => applyComposerLayout(layerId), 0);
      }
    };
    runTransition(action);
  };

  const ensureLowerThirdLayers = () => {
    if (lowerThirdIdsRef.current.nameId && lowerThirdIdsRef.current.titleId) return;
    const nameId = generateId();
    const titleId = generateId();
    lowerThirdIdsRef.current = { nameId, titleId };
    setLayers(prev => ([
      ...prev,
      {
        id: nameId,
        type: SourceType.TEXT,
        label: 'Lower Third Name',
        visible: lowerThirdVisible,
        x: 60,
        y: 600,
        width: 900,
        height: 60,
        content: lowerThirdName,
        zIndex: 900,
        style: { fontSize: 44, fontFamily: 'Inter', fontWeight: 'bold', color: '#ffffff' },
      },
      {
        id: titleId,
        type: SourceType.TEXT,
        label: 'Lower Third Title',
        visible: lowerThirdVisible,
        x: 60,
        y: 652,
        width: 900,
        height: 40,
        content: lowerThirdTitle,
        zIndex: 901,
        style: { fontSize: 26, fontFamily: 'Inter', fontWeight: 'normal', color: '#cbd5e1' },
      }
    ]));
  };

  const updateLowerThirdContent = () => {
    const { nameId, titleId } = lowerThirdIdsRef.current;
    if (!nameId || !titleId) return;
    setLayers(prev => prev.map(l => {
      if (l.id === nameId) return { ...l, content: lowerThirdName };
      if (l.id === titleId) return { ...l, content: lowerThirdTitle };
      return l;
    }));
  };

  const setLowerThirdVisibility = (visible: boolean) => {
    ensureLowerThirdLayers();
    const { nameId, titleId } = lowerThirdIdsRef.current;
    setLowerThirdVisible(visible);
    setLayers(prev => prev.map(l => {
      if (l.id === nameId || l.id === titleId) return { ...l, visible };
      return l;
    }));
  };

  const showLowerThirdTemporarily = (ms: number) => {
    setLowerThirdVisibility(true);
    window.setTimeout(() => setLowerThirdVisibility(false), ms);
  };

  const ensurePinnedLayer = () => {
    if (pinnedLayerIdRef.current) return;
    const id = generateId();
    pinnedLayerIdRef.current = id;
    setLayers(prev => ([
      ...prev,
      {
        id,
        type: SourceType.TEXT,
        label: 'Pinned Comment',
        visible: pinnedVisible,
        x: 60,
        y: 40,
        width: 900,
        height: 40,
        content: pinnedMessage,
        zIndex: 850,
        style: { fontSize: 24, fontFamily: 'Inter', fontWeight: 'bold', color: '#fbbf24' },
      }
    ]));
  };

  const ensureTickerLayer = () => {
    if (tickerLayerIdRef.current) return;
    const id = generateId();
    tickerLayerIdRef.current = id;
    setLayers(prev => ([
      ...prev,
      {
        id,
        type: SourceType.TEXT,
        label: 'Chat Ticker',
        visible: tickerVisible,
        x: 0,
        y: 680,
        width: 1280,
        height: 30,
        content: tickerMessage,
        zIndex: 840,
        style: { fontSize: 20, fontFamily: 'Inter', fontWeight: 'normal', color: '#a78bfa', scrolling: true, scrollSpeed: 2 },
      }
    ]));
  };

  const setPinnedVisibility = (visible: boolean) => {
    ensurePinnedLayer();
    const id = pinnedLayerIdRef.current;
    setPinnedVisible(visible);
    setLayers(prev => prev.map(l => l.id === id ? { ...l, visible } : l));
  };

  const setTickerVisibility = (visible: boolean) => {
    ensureTickerLayer();
    const id = tickerLayerIdRef.current;
    setTickerVisible(visible);
    setLayers(prev => prev.map(l => l.id === id ? { ...l, visible } : l));
  };

  const addDestination = () => {
    setDestinations(prev => [
      ...prev,
      { id: generateId(), label: 'Extra Stream', url: '', enabled: true }
    ]);
  };

  const updateDestination = (id: string, updates: Partial<StreamDestination>) => {
    setDestinations(prev => prev.map(d => d.id === id ? { ...d, ...updates } : d));
  };

  const removeDestination = (id: string) => {
    setDestinations(prev => prev.filter(d => d.id !== id));
  };

  const saveScenePreset = () => {
    const positions = layers.map(l => ({
      layerId: l.id,
      x: l.x,
      y: l.y,
      width: l.width,
      height: l.height,
      zIndex: l.zIndex,
    }));
    setScenePresets(prev => [
      ...prev,
      {
        id: generateId(),
        name: presetName.trim() || `Preset ${prev.length + 1}`,
        layout: layoutTemplate,
        mainLayerId: selectedLayerId,
        positions,
      }
    ]);
    setStatusMsg({ type: 'info', text: 'Scene preset saved.' });
  };

  const loadScenePresetById = (id: string) => {
    const preset = scenePresets.find(p => p.id === id);
    if (!preset) return;
    if (preset.layout === 'main_thumbs') {
      setComposerMode(true);
      setSelectedLayerId(preset.mainLayerId || selectedLayerId);
      setTimeout(() => applyComposerLayout(preset.mainLayerId || selectedLayerId), 0);
    } else if (preset.layout === 'grid_2x2') {
      setComposerMode(false);
      applyGridLayout();
    } else {
      setComposerMode(false);
      setLayers(prev => prev.map(l => {
        const pos = preset.positions.find(p => p.layerId === l.id);
        if (!pos) return l;
        return { ...l, x: pos.x, y: pos.y, width: pos.width, height: pos.height, zIndex: pos.zIndex };
      }));
    }
    setStatusMsg({ type: 'info', text: `Loaded preset: ${preset.name}` });
  };

  const deleteScenePreset = (id: string) => {
    setScenePresets(prev => prev.filter(p => p.id !== id));
  };

  const setSourceAudioActive = (sourceId: string) => {
    setCameraSources(prev => prev.map(s => s.id === sourceId ? { ...s } : s));
    setAudioTracks(prev => prev.map(t => {
      const owner = cameraSources.find(s => s.audioTrackId === t.id);
      if (!owner) return t;
      if (owner.id === sourceId) return { ...t, muted: false };
      return { ...t, muted: true };
    }));
  };


  const applyComposerLayout = (mainOverride?: string | null) => {
    const CAM_W = 1920;
    const CAM_H = 1080;
    const THUMB_W = 320;
    const THUMB_H = 180;
    const PAD = 16;

    const sourcesWithLayers = cameraSources.filter(s => s.layerId);
    if (sourcesWithLayers.length === 0) return;

    const mainLayerId =
      mainOverride ||
      selectedLayerId ||
      sourcesWithLayers[0].layerId;

    setLayers(prev => {
      const base = prev.map(l => ({ ...l }));
      let thumbIdx = 0;
      return base.map(l => {
        const src = sourcesWithLayers.find(s => s.layerId === l.id);
        if (!src) return l;

        if (l.id === mainLayerId) {
          return { ...l, x: 0, y: 0, width: CAM_W, height: CAM_H, zIndex: 100 };
        }

        const x = CAM_W - THUMB_W - PAD;
        const y = PAD + thumbIdx * (THUMB_H + PAD);
        thumbIdx += 1;
        return { ...l, x, y, width: THUMB_W, height: THUMB_H, zIndex: 50 + thumbIdx };
      });
    });
  };

  useEffect(() => {
    if (composerMode) {
      applyComposerLayout();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [composerMode, cameraSources.length, selectedLayerId]);

  const cutToNext = () => {
    if (cameraSources.length === 0) return;
    const currentLayerId = selectedLayerId;
    const idx = cameraSources.findIndex(s => s.layerId === currentLayerId);
    const next = cameraSources[(idx + 1) % cameraSources.length] || cameraSources[0];
    makeMain(next.layerId);
  };

  const emergencyWide = () => {
    const wide =
      cameraSources.find(s => s.kind === 'local') ||
      cameraSources.find(s => s.kind === 'phone') ||
      null;
    if (wide) makeMain(wide.layerId);
  };

  const applyGridLayout = () => {
    const targets = cameraSources.filter(s => s.layerId).map(s => s.layerId as string).slice(0, 4);
    if (targets.length === 0) return;
    const CAM_W = 1920;
    const CAM_H = 1080;
    const cols = 2;
    const rows = 2;
    const cellW = CAM_W / cols;
    const cellH = CAM_H / rows;
    setLayers(prev => prev.map(l => {
      const idx = targets.indexOf(l.id);
      if (idx === -1) return l;
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      return {
        ...l,
        x: col * cellW,
        y: row * cellH,
        width: cellW,
        height: cellH,
        zIndex: 100 + idx,
      };
    }));
  };

  const runTransition = (action: () => void) => {
    if (transitionMode === 'cut' || transitionMs <= 0) {
      action();
      return;
    }
    if (transitionRafRef.current) {
      cancelAnimationFrame(transitionRafRef.current);
    }
    const duration = Math.max(120, transitionMs);
    const half = duration / 2;
    const start = performance.now();
    let switched = false;

    const step = (now: number) => {
      const t = now - start;
      if (t < half) {
        setTransitionAlpha(t / half);
      } else {
        if (!switched) {
          action();
          switched = true;
        }
        const down = 1 - (t - half) / half;
        setTransitionAlpha(Math.max(0, down));
      }

      if (t < duration) {
        transitionRafRef.current = requestAnimationFrame(step);
      } else {
        setTransitionAlpha(0);
        transitionRafRef.current = null;
      }
    };

    transitionRafRef.current = requestAnimationFrame(step);
  };

  useEffect(() => {
    if (autoDirectorTimerRef.current) {
      window.clearInterval(autoDirectorTimerRef.current);
      autoDirectorTimerRef.current = null;
    }
    if (!autoDirectorOn || cameraSources.length < 2) return;
    const intervalMs = Math.max(3, Number(autoDirectorInterval) || 12) * 1000;
    autoDirectorTimerRef.current = window.setInterval(() => {
      cutToNext();
    }, intervalMs);
    return () => {
      if (autoDirectorTimerRef.current) {
        window.clearInterval(autoDirectorTimerRef.current);
        autoDirectorTimerRef.current = null;
      }
    };
  }, [autoDirectorOn, autoDirectorInterval, cameraSources.length, cutToNext]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT") return;
      if (e.key >= "1" && e.key <= "9") {
        const idx = Number(e.key) - 1;
        const src = cameraSources[idx];
        if (src?.layerId) makeMain(src.layerId);
      }
      if (e.key === "0") emergencyWide();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cameraSources, emergencyWide, makeMain]);

  const testPeerServer = async () => {
    const mode = peerMode;
    if (mode === 'cloud') {
      setStatusMsg({ type: 'info', text: 'Cloud mode selected. PeerJS cloud should be reachable.' });
      return;
    }

    const host = (peerHost || 'localhost').trim().replace(/^https?:\/\//i, '');
    const port = Number(peerPort) || 9000;
    const path = (peerPath || '/peerjs').trim();
    const protocol = peerSecure ? 'https' : 'http';
    const base = `${protocol}://${host}:${port}`;
    // PeerJS REST endpoint uses /<path>/peerjs/id
    const cleanPath = path.startsWith('/') ? path : `/${path}`;
    const idUrl = `${base}${cleanPath.replace(/\/$/, '')}/peerjs/id`;

    try {
      const res = await fetch(idUrl, { method: 'GET' });
      if (res.ok) {
        setStatusMsg({ type: 'info', text: `PeerJS OK: ${host}:${port}${path}` });
      } else {
        setStatusMsg({ type: 'warn', text: `PeerJS responded ${res.status}. Check host/port/path.` });
      }
    } catch (err) {
      setStatusMsg({ type: 'error', text: 'PeerJS test failed. Is the server running and reachable?' });
    }
  };

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
      {showQRModal && activePhoneSourceId && (
        <QRConnectModal
          roomId={roomId}
          sourceId={activePhoneSourceId}
          sourceLabel={cameraSources.find(s => s.id === activePhoneSourceId)?.label || "Phone Cam"}
          relayPort=""
          onClose={() => {
            setShowQRModal(false);
            setActivePhoneSourceId(null);
          }}
        />
      )}
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
           <SourceButton icon={<Smartphone size={24} />} label="Mobile" onClick={createPhoneSource} />
           <SourceButton icon={<Monitor size={24} />} label="Screen" onClick={addScreenSource} />
           <SourceButton icon={<ImageIcon size={24} />} label="Image" onClick={() => fileInputRef.current?.click()} />
           <SourceButton icon={<Type size={24} />} label="Text" onClick={addTextLayer} />
           <SourceButton icon={<HelpCircle size={24} />} label="Help" onClick={() => setShowHelpModal(true)} />
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
                transitionOverlay={{ alpha: transitionAlpha, color: '#000000' }}
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
                <button onClick={() => setRightPanelTab('inputs')} className={`flex-1 py-3 text-xs font-bold uppercase flex justify-center gap-2 ${rightPanelTab === 'inputs' ? 'bg-aether-800 text-aether-400' : 'text-gray-500'}`}><Camera size={14} /> Inputs</button>
                <button onClick={() => setRightPanelTab('ai')} className={`flex-1 py-3 text-xs font-bold uppercase flex justify-center gap-2 ${rightPanelTab === 'ai' ? 'bg-aether-800 text-aether-400' : 'text-gray-500'}`}><Sparkles size={14} /> AI Studio</button>
            </div>
            <div className="flex-1 overflow-hidden">
                {rightPanelTab === 'properties' && (
                  <LayerProperties layer={layers.find(l => l.id === selectedLayerId) || null} onUpdate={updateLayer} onDelete={deleteLayer} isPro={isPro} />
                )}
                {rightPanelTab === 'ai' && (
                  <AIPanel onAddLayer={(src) => addImageLayer(src, 'AI Background')} />
                )}
                {rightPanelTab === 'inputs' && (
                  <div className="h-full overflow-y-auto p-4 pb-24 space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="text-sm font-bold text-white">Input Manager</h3>
                        <p className="text-[10px] text-gray-500">Local cameras and phones</p>
                      </div>
                      <div className="flex gap-2">
                        <button onClick={() => setShowDeviceSelector(true)} className="px-2 py-1 text-[10px] rounded bg-aether-800 border border-aether-700 text-gray-200">Add Local</button>
                        <button onClick={createPhoneSource} className="px-2 py-1 text-[10px] rounded bg-aether-800 border border-aether-700 text-gray-200">Add Phone</button>
                      </div>
                    </div>

                    <div className="flex gap-2">
                      <button onClick={cutToNext} className="px-2 py-1 text-[10px] rounded bg-aether-700 text-white">Cut To Next</button>
                      <button onClick={emergencyWide} className="px-2 py-1 text-[10px] rounded bg-red-500/20 text-red-300">Emergency Wide</button>
                    </div>

                    <div className="flex items-center justify-between bg-aether-800/40 border border-aether-700 rounded-lg p-2">
                      <div>
                        <div className="text-xs font-semibold text-white">Composer Mode</div>
                        <div className="text-[10px] text-gray-500">Main + thumbnails layout</div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button onClick={applyComposerLayout} className="px-2 py-1 text-[10px] rounded bg-aether-800 border border-aether-700 text-gray-200">Apply</button>
                        <label className="text-[10px] text-gray-300 flex items-center gap-1">
                          <input type="checkbox" checked={composerMode} onChange={(e) => setComposerMode(e.target.checked)} />
                          On
                        </label>
                      </div>
                    </div>

                    <div className="bg-aether-800/40 border border-aether-700 rounded-lg p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="text-xs font-semibold text-white">Auto-Director</div>
                          <div className="text-[10px] text-gray-500">Auto switches cameras on a timer</div>
                        </div>
                        <label className="text-[10px] text-gray-300 flex items-center gap-1">
                          <input type="checkbox" checked={autoDirectorOn} onChange={(e) => setAutoDirectorOn(e.target.checked)} />
                          On
                        </label>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-gray-400">Interval (sec)</span>
                        <input
                          type="number"
                          value={autoDirectorInterval}
                          onChange={(e) => setAutoDirectorInterval(Number(e.target.value) || 12)}
                          className="w-16 bg-aether-800 border border-aether-700 rounded px-2 py-1 text-[10px] text-white"
                        />
                      </div>
                    </div>

                    <div className="bg-aether-800/40 border border-aether-700 rounded-lg p-3 space-y-2">
                      <div className="text-xs font-semibold text-white">Lower Thirds</div>
                      <input
                        value={lowerThirdName}
                        onChange={(e) => setLowerThirdName(e.target.value)}
                        className="w-full bg-aether-800 border border-aether-700 rounded px-2 py-1 text-[10px] text-white"
                        placeholder="Name"
                      />
                      <input
                        value={lowerThirdTitle}
                        onChange={(e) => setLowerThirdTitle(e.target.value)}
                        className="w-full bg-aether-800 border border-aether-700 rounded px-2 py-1 text-[10px] text-white"
                        placeholder="Title"
                      />
                      <div className="flex gap-2">
                        <button onClick={() => setLowerThirdVisibility(true)} className="px-2 py-1 text-[10px] rounded bg-aether-700 text-white">Show</button>
                        <button onClick={() => setLowerThirdVisibility(false)} className="px-2 py-1 text-[10px] rounded bg-aether-800 border border-aether-700 text-gray-200">Hide</button>
                        <button onClick={() => showLowerThirdTemporarily(5000)} className="px-2 py-1 text-[10px] rounded bg-aether-800 border border-aether-700 text-gray-200">Show 5s</button>
                      </div>
                    </div>

                    <div className="bg-aether-800/40 border border-aether-700 rounded-lg p-3 space-y-2">
                      <div className="text-xs font-semibold text-white">Transitions</div>
                      <div className="flex items-center gap-2">
                        <select
                          value={transitionMode}
                          onChange={(e) => setTransitionMode(e.target.value as any)}
                          className="bg-aether-800 border border-aether-700 rounded px-2 py-1 text-[10px] text-white"
                        >
                          <option value="cut">Cut</option>
                          <option value="fade">Fade</option>
                        </select>
                        <input
                          type="number"
                          value={transitionMs}
                          onChange={(e) => setTransitionMs(Number(e.target.value) || 300)}
                          className="w-16 bg-aether-800 border border-aether-700 rounded px-2 py-1 text-[10px] text-white"
                        />
                        <span className="text-[10px] text-gray-400">ms</span>
                      </div>
                    </div>

                    <div className="bg-aether-800/40 border border-aether-700 rounded-lg p-3 space-y-2">
                      <div className="text-xs font-semibold text-white">Scene Presets</div>
                      <div className="flex items-center gap-2">
                        <input
                          value={presetName}
                          onChange={(e) => setPresetName(e.target.value)}
                          className="flex-1 bg-aether-800 border border-aether-700 rounded px-2 py-1 text-[10px] text-white"
                          placeholder="Preset name"
                        />
                        <select
                          value={layoutTemplate}
                          onChange={(e) => setLayoutTemplate(e.target.value as any)}
                          className="bg-aether-800 border border-aether-700 rounded px-2 py-1 text-[10px] text-white"
                        >
                          <option value="main_thumbs">Main + Thumbs</option>
                          <option value="grid_2x2">2x2 Grid</option>
                          <option value="freeform">Freeform</option>
                        </select>
                        <button onClick={saveScenePreset} className="px-2 py-1 text-[10px] rounded bg-aether-700 text-white">Save</button>
                      </div>
                      {scenePresets.length === 0 && (
                        <div className="text-[10px] text-gray-500">No presets yet.</div>
                      )}
                      {scenePresets.map(p => (
                        <div key={p.id} className="flex items-center gap-2">
                          <div className="flex-1 text-[10px] text-gray-300">{p.name} <span className="text-gray-500">({p.layout})</span></div>
                          <button onClick={() => loadScenePresetById(p.id)} className="px-2 py-1 text-[10px] rounded bg-aether-800 border border-aether-700 text-gray-200">Load</button>
                          <button onClick={() => deleteScenePreset(p.id)} className="px-2 py-1 text-[10px] rounded bg-red-500/20 text-red-300">Delete</button>
                        </div>
                      ))}
                    </div>

                    <div className="bg-aether-800/40 border border-aether-700 rounded-lg p-3 space-y-2">
                      <div className="text-xs font-semibold text-white">Audience Studio</div>
                      <input
                        value={pinnedMessage}
                        onChange={(e) => setPinnedMessage(e.target.value)}
                        className="w-full bg-aether-800 border border-aether-700 rounded px-2 py-1 text-[10px] text-white"
                        placeholder="Pinned message"
                      />
                      <div className="flex gap-2">
                        <button onClick={() => setPinnedVisibility(true)} className="px-2 py-1 text-[10px] rounded bg-aether-700 text-white">Show Pin</button>
                        <button onClick={() => setPinnedVisibility(false)} className="px-2 py-1 text-[10px] rounded bg-aether-800 border border-aether-700 text-gray-200">Hide Pin</button>
                      </div>
                      <input
                        value={tickerMessage}
                        onChange={(e) => setTickerMessage(e.target.value)}
                        className="w-full bg-aether-800 border border-aether-700 rounded px-2 py-1 text-[10px] text-white"
                        placeholder="Ticker message"
                      />
                      <div className="flex gap-2">
                        <button onClick={() => setTickerVisibility(true)} className="px-2 py-1 text-[10px] rounded bg-aether-700 text-white">Start Ticker</button>
                        <button onClick={() => setTickerVisibility(false)} className="px-2 py-1 text-[10px] rounded bg-aether-800 border border-aether-700 text-gray-200">Stop Ticker</button>
                      </div>
                    </div>

                    {cameraSources.length === 0 && (
                      <div className="text-xs text-gray-500 border border-aether-700 rounded p-3 bg-aether-800/40">
                        No camera inputs yet. Add a local or phone camera.
                      </div>
                    )}

                    {cameraSources.map(src => (
                      <div key={src.id} className="flex items-center gap-3 bg-aether-800/50 border border-aether-700 rounded-lg p-2">
                        <SourcePreview stream={src.stream} />
                        <div className="flex-1">
                          <input
                            value={src.label}
                            onChange={(e) => updateSourceLabel(src.id, e.target.value)}
                            className="w-full bg-transparent text-sm text-white outline-none border-b border-transparent focus:border-aether-500"
                          />
                          <div className="text-[10px] text-gray-500">{src.kind === 'local' ? 'Local Camera' : 'Phone Camera'} • {src.status}</div>
                        </div>
                        <div className="flex flex-col gap-1">
                          <button onClick={() => makeMain(src.layerId)} className="px-2 py-1 text-[10px] rounded bg-aether-700 text-white">Make Main</button>
                          {src.audioTrackId && (
                            <button onClick={() => setSourceAudioActive(src.id)} className="px-2 py-1 text-[10px] rounded bg-aether-800 border border-aether-700 text-gray-200">Use Audio</button>
                          )}
                          <button onClick={() => removeSource(src.id)} className="px-2 py-1 text-[10px] rounded bg-red-500/20 text-red-300">Remove</button>
                        </div>
                      </div>
                    ))}

                    <div className="pt-2">
                      <h4 className="text-xs font-bold text-gray-300 mb-2">Phone Slots</h4>
                      {cameraSources.filter(s => s.kind === 'phone').length === 0 && (
                        <div className="text-[10px] text-gray-500 border border-aether-700 rounded p-2 bg-aether-800/30">
                          No phone slots created yet.
                        </div>
                      )}
                      {cameraSources.filter(s => s.kind === 'phone').map(src => (
                        <div key={`phone-${src.id}`} className="flex items-center gap-2 border border-aether-700 rounded p-2 bg-aether-800/30 mb-2">
                          <div className="flex-1">
                            <div className="text-xs text-white">{src.label}</div>
                            <div className="text-[10px] text-gray-500">Status: {src.status}</div>
                          </div>
                          {src.status !== 'live' && (
                            <button onClick={() => openPhoneQr(src.id)} className="px-2 py-1 text-[10px] rounded bg-aether-700 text-white">Show QR</button>
                          )}
                          <button
                            onClick={() => {
                              const link = buildMobileUrl(src.id, src.label);
                              if (link) {
                                navigator.clipboard?.writeText(link).catch(() => {});
                              }
                            }}
                            className="px-2 py-1 text-[10px] rounded bg-aether-800 border border-aether-700 text-gray-200"
                          >
                            Copy Link
                          </button>
                          <button onClick={() => makeMain(src.layerId)} className="px-2 py-1 text-[10px] rounded bg-aether-700 text-white">Make Main</button>
                          <button onClick={() => removeSource(src.id)} className="px-2 py-1 text-[10px] rounded bg-red-500/20 text-red-300">Remove</button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
            </div>
        </div>
      </div>

      {showSettings && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-aether-900 border border-aether-700 rounded-xl p-6 w-[520px] shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-6"><h2 className="text-xl font-bold flex gap-2"><Settings className="text-aether-500"/> Settings</h2><button onClick={() => setShowSettings(false)}><X className="text-gray-400"/></button></div>
            <div className="space-y-4">
              <div className="bg-blue-500/10 border border-blue-500/20 p-4 rounded-lg">
                  <h4 className="text-sm font-bold text-white mb-2 flex items-center gap-2"><Activity size={16}/> Signaling Diagnostic</h4>
                  <div className="space-y-1 text-xs text-gray-300">
                      <p>PeerID: <span className="font-mono text-gray-500">{peerId || 'Generating...'}</span></p>
                      <p>Room: <span className="font-mono text-gray-500">{roomId}</span></p>
                      <p>Mode: <span className="font-mono text-gray-500">{peerMode === 'custom' ? 'Custom' : 'Cloud'}</span></p>
                      <p>Status: <span className={cloudConnected ? "text-green-400" : "text-red-400"}>{cloudConnected ? "Active" : "Disconnected"}</span></p>
                      <p>Relay: <span className={relayConnected ? "text-green-400" : "text-red-400"}>{relayConnected ? "Online" : "Offline"}</span></p>
                      {relayStatus && <p>Relay Status: <span className="text-gray-400">{relayStatus}</span></p>}
                  </div>
                  <div className="flex gap-2 mt-3">
                    <button
                      onClick={checkRelayHealth}
                      className="px-2 py-1 text-[10px] rounded bg-aether-800 border border-aether-700 text-gray-200"
                    >
                      Relay Check
                    </button>
                    <button
                      onClick={checkFfmpeg}
                      className="px-2 py-1 text-[10px] rounded bg-aether-800 border border-aether-700 text-gray-200"
                    >
                      FFmpeg Check
                    </button>
                  </div>
                  <div className="mt-3 bg-aether-800/40 border border-aether-700 rounded p-2 text-[10px] text-gray-300">
                    <div className="font-semibold text-white mb-1">Stream Health</div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1">
                      <span>Bitrate: <span className="text-gray-400">{streamHealth.kbps} kbps</span></span>
                      <span>Queue: <span className="text-gray-400">{streamHealth.queueKb} KB</span></span>
                      <span>Drops: <span className="text-gray-400">{streamHealth.drops}</span></span>
                      <span>RTT: <span className="text-gray-400">{streamHealth.rttMs !== null ? `${streamHealth.rttMs} ms` : "--"}</span></span>
                    </div>
                    <div className="text-[9px] text-gray-500 mt-1">Updates while Live. Drops indicate network backpressure.</div>
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

              <div className="bg-aether-800/50 p-4 rounded-lg space-y-3">
                 <div>
                    <h4 className="text-sm font-bold text-white mb-1">Connection Mode</h4>
                    <p className="text-xs text-gray-400">Simple options for non-technical setup</p>
                 </div>
                 <div className="text-[10px] text-gray-500 bg-aether-800/40 border border-aether-700 rounded p-2">
                   <strong>Auto:</strong> Easiest. Uses PeerJS cloud.
                   <br />
                   <strong>Local:</strong> Uses your computer at <span className="font-mono">localhost:9000</span>.
                   <br />
                   <strong>Advanced:</strong> Use a custom server or VPS.
                 </div>
                 <select
                    value={peerUiMode}
                    onChange={(e) => setPeerUiMode(e.target.value as any)}
                    className="w-full bg-aether-800 border border-aether-700 rounded p-2 text-sm text-white focus:border-aether-500 outline-none"
                 >
                    <option value="auto">Auto (Recommended)</option>
                    <option value="local">Local (This Computer)</option>
                    <option value="advanced">Advanced (Custom Server)</option>
                 </select>
                 <p className="text-[10px] text-gray-500">
                   Local uses this computer (localhost:9000). Advanced is for remote or VPS servers.
                 </p>

                 {peerUiMode === 'advanced' && (
                    <div className="space-y-2">
                      <div>
                        <label className="text-gray-400 text-sm">Host</label>
                        <input
                          type="text"
                          value={peerHost}
                          onChange={(e) => setPeerHost(e.target.value)}
                          placeholder="localhost"
                          className="w-full bg-aether-800 border border-aether-700 rounded p-2 text-sm text-white focus:border-aether-500 outline-none"
                        />
                        <p className="text-[10px] text-gray-500 mt-1">Example: <span className="font-mono">yourdomain.com</span></p>
                      </div>
                      <div>
                        <label className="text-gray-400 text-sm">Port</label>
                        <input
                          type="number"
                          value={peerPort}
                          onChange={(e) => setPeerPort(e.target.value)}
                          placeholder="9000"
                          className="w-full bg-aether-800 border border-aether-700 rounded p-2 text-sm text-white focus:border-aether-500 outline-none"
                        />
                        <p className="text-[10px] text-gray-500 mt-1">Common: 443 (secure), 9000 (local)</p>
                      </div>
                      <div>
                        <label className="text-gray-400 text-sm">Path</label>
                        <input
                          type="text"
                          value={peerPath}
                          onChange={(e) => setPeerPath(e.target.value)}
                          placeholder="/peerjs"
                          className="w-full bg-aether-800 border border-aether-700 rounded p-2 text-sm text-white focus:border-aether-500 outline-none"
                        />
                        <p className="text-[10px] text-gray-500 mt-1">Default path is <span className="font-mono">/peerjs</span></p>
                      </div>
                      <label className="flex items-center gap-2 text-xs text-gray-300">
                        <input
                          type="checkbox"
                          checked={peerSecure}
                          onChange={(e) => setPeerSecure(e.target.checked)}
                        />
                        Use TLS (wss/https)
                      </label>
                      <p className="text-[10px] text-gray-500">
                        After applying, the app reloads and uses your custom PeerJS server.
                      </p>
                    </div>
                 )}

                 <div className="flex justify-between items-center">
                    <button
                      onClick={testPeerServer}
                      className="px-3 py-2 rounded text-xs bg-aether-800 border border-aether-700 hover:bg-aether-700 text-white"
                    >
                      Test Connection
                    </button>
                    <button
                      onClick={applyPeerSettings}
                      className="px-3 py-2 rounded text-xs bg-aether-700 hover:bg-aether-600 text-white"
                    >
                      Apply & Reload
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

              <div className="bg-aether-800/50 p-4 rounded-lg space-y-2">
                  <h4 className="text-sm font-bold text-white mb-1">Multi-Stream Destinations</h4>
                  <p className="text-[10px] text-gray-500">Add extra RTMP targets (Twitch, Facebook, etc.)</p>
                  {destinations.length === 0 && (
                    <div className="text-[10px] text-gray-500">No extra destinations yet.</div>
                  )}
                  {destinations.map(d => (
                    <div key={d.id} className="space-y-1 border border-aether-700 rounded p-2">
                      <div className="flex items-center gap-2">
                        <input
                          value={d.label}
                          onChange={(e) => updateDestination(d.id, { label: e.target.value })}
                          className="flex-1 bg-aether-800 border border-aether-700 rounded px-2 py-1 text-[10px] text-white"
                          placeholder="Label"
                        />
                        <label className="text-[10px] text-gray-300 flex items-center gap-1">
                          <input
                            type="checkbox"
                            checked={d.enabled}
                            onChange={(e) => updateDestination(d.id, { enabled: e.target.checked })}
                          />
                          On
                        </label>
                        <button
                          onClick={() => removeDestination(d.id)}
                          className="px-2 py-1 text-[10px] rounded bg-red-500/20 text-red-300"
                        >
                          Remove
                        </button>
                      </div>
                      <input
                        value={d.url}
                        onChange={(e) => updateDestination(d.id, { url: e.target.value })}
                        className="w-full bg-aether-800 border border-aether-700 rounded px-2 py-1 text-[10px] text-white"
                        placeholder="rtmp://.../your-stream-key"
                      />
                    </div>
                  ))}
                  <button
                    onClick={addDestination}
                    className="px-2 py-1 text-[10px] rounded bg-aether-800 border border-aether-700 text-gray-200"
                  >
                    Add Destination
                  </button>
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
