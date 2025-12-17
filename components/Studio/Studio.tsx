import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Monitor, Camera, Image as ImageIcon, Type, Circle, Zap, Settings, PlaySquare, StopCircle, Radio, X, Sliders, Sparkles, Download, Package, FolderInput, Network, ExternalLink, AlertCircle, Smartphone, HelpCircle, Disc, Square, Cloud, LogOut, Link as LinkIcon, RefreshCw, Activity, Tv } from 'lucide-react';
//import Peer from 'peerjs';
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



  // Persist Stream Key for validation workflow
  const [streamKey, setStreamKey] = useState(() => localStorage.getItem('aether_stream_key') || '');
  
  const [cloudConnected, setCloudConnected] = useState(false);
  const [desktopConnected, setDesktopConnected] = useState(false);
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
        if (filterNode) {
            if (track.noiseCancellation) {
                filterNode.type = 'highpass';
                filterNode.frequency.setTargetAtTime(150, ctx.currentTime, 0.1); 
            } else {
                filterNode.type = 'allpass';
            }
        }
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



  // --- PeerJS Signaling Setup ---
useEffect(() => {
  // Generate the Safe ID: "aether-studio-xyz-host"
  const myPeerId = getCleanPeerId(roomId, "host");

  // Destroy old peer if any
  if (peerRef.current) {
    try { peerRef.current.destroy(); } catch {}
    peerRef.current = null;
  }

  // Create Peer
  const peer = new Peer(myPeerId, peerServerDefaults);
  peerRef.current = peer;

  peer.on("open", (id) => {
    console.log("[PeerJS] open:", id);
    // optional: set UI status here
      setConnStatus?.("waiting_for_phone");
      setPeerId(id);
      setCloudConnected(true);
      setDesktopConnected(true); 
  });

  peer.on("connection", (conn: DataConnection) => {
    console.log("[PeerJS] incoming data connection:", conn.peer);

    // keep ref
    dataConnRef.current = conn;

    conn.on("open", () => {
      console.log("[PeerJS] data channel open");
      // optional: conn.send({ type: "hello", role: "host" });
    });

    conn.on("data", (msg: any) => {
      console.log("[PeerJS] data:", msg);

      // Example message handling
      // if (msg?.type === "PHONE_READY") { ... }
      // if (msg?.type === "ICE_CANDIDATE") { ... }
      // if (msg?.type === "OFFER") { ... }
      // if (msg?.type === "ANSWER") { ... }
    });

    conn.on("close", () => {
      console.log("[PeerJS] data channel closed");
      if (dataConnRef.current === conn) dataConnRef.current = null;
    });

    conn.on("error", (err) => {
      console.warn("[PeerJS] data channel error:", err);
    });
  });

  peer.on("error", (err) => {
    console.error("[PeerJS] error:", err);
    // optional: set error UI
    // setConnStatus?.("error");
  });

  peer.on("disconnected", () => {
    console.warn("[PeerJS] disconnected - attempting reconnect");
    try { peer.reconnect(); } catch {}
  });

  // cleanup
  return () => {
    try { peer.destroy(); } catch {}
    if (peerRef.current === peer) peerRef.current = null;
    if (dataConnRef.current) dataConnRef.current = null;
  };
}, [roomId]);

  const handleMobileStream = (stream: MediaStream) => {
       setLayers(prev => {
          const existingLayerIndex = prev.findIndex(l => l.label === 'Mobile Cam' && l.type === SourceType.CAMERA);
          
          if (existingLayerIndex >= 0) {
              const newLayers = [...prev];
              newLayers[existingLayerIndex] = {
                  ...newLayers[existingLayerIndex],
                  src: stream 
              };
              return newLayers;
          } else {
              const newLayer: Layer = {
                id: generateId(),
                type: SourceType.CAMERA,
                label: 'Mobile Cam',
                visible: true,
                x: 50, y: 50, width: 480, height: 270,
                src: stream,
                zIndex: prev.length + 10,
                style: { circular: false, border: true, borderColor: '#7c3aed' }
             };
             return [...prev, newLayer];
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


  // --- Layer Management ---
  const addCameraSource = async (videoDeviceId: string, audioDeviceId: string) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { deviceId: { exact: videoDeviceId }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: { deviceId: { exact: audioDeviceId } }
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
      if (!streamKey) {
          setStatusMsg({ type: 'error', text: "No Stream Key Set! Check Settings." });
          setShowSettings(true);
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
              streamKey: streamKey 
          }));
      } else {
          setStatusMsg({ type: 'error', text: "Backend server not found (localhost:8080)" });
          return;
      }

      // Start Media Recorder to pump binary data
      const mimeType = 'video/webm;codecs=h264'; // Chrome supports this well for streaming
      // Check support
      const options = MediaRecorder.isTypeSupported(mimeType) 
          ? { mimeType } 
          : { mimeType: 'video/webm' };

      const recorder = new MediaRecorder(combinedStream, options);
      
      recorder.ondataavailable = (e) => {
          if (e.data.size > 0 && streamingSocketRef.current?.readyState === WebSocket.OPEN) {
             // Send binary blob directly
             streamingSocketRef.current.send(e.data);
          }
      };

      recorder.start(100); // 100ms chunks for low latency
      mediaRecorderRef.current = recorder;
      setStreamStatus(StreamStatus.LIVE);
    }
  };

  const handleSignOut = () => {
     signOut(auth).catch(console.error);
     onBack();
  };

  return (
    <div className="fixed inset-0 flex flex-col w-full bg-aether-900 text-gray-200 font-sans selection:bg-aether-500 selection:text-white relative overflow-hidden">
      <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleFileUpload} />
      {statusMsg && (
          <div className={`fixed top-20 left-1/2 -translate-x-1/2 px-6 py-3 rounded-xl text-sm font-bold flex items-center gap-3 shadow-2xl animate-in fade-in slide-in-from-top-4 z-[9999] border ${statusMsg.type === 'error' ? 'bg-red-600/90 border-red-400' : 'bg-blue-600/90 border-blue-400'} backdrop-blur-md`}>
             <AlertCircle size={20} /> {statusMsg.text}
          </div>
      )}

      {showDeviceSelector && <DeviceSelectorModal onSelect={addCameraSource} onClose={() => setShowDeviceSelector(false)} />}
      {showQRModal && <QRConnectModal roomId={roomId} relayPort="" onClose={() => setShowQRModal(false)} />}
      {showHelpModal && <HelpModal onClose={() => setShowHelpModal(false)} />}

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

          <button onClick={toggleLive} className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all ${streamStatus === StreamStatus.LIVE ? 'bg-red-600 text-white' : 'bg-aether-800 border border-aether-700 hover:bg-aether-700'}`}>
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
            <CanvasStage layers={layers} onCanvasReady={handleCanvasReady} selectedLayerId={selectedLayerId} onSelectLayer={setSelectedLayerId} onUpdateLayer={updateLayer} />
          </div>
          <AudioMixer tracks={audioTracks} onUpdateTrack={updateAudioTrack} />
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