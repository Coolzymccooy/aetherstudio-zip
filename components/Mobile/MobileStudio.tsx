import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Camera, Mic, MicOff, Wifi, RefreshCcw, Settings, QrCode, LogOut, Loader2, Download, CheckCircle, Radio, Monitor, Share, Edit2, ArrowRight, Activity, X } from 'lucide-react';
import Peer, { DataConnection, MediaConnection } from 'peerjs';
import { auth } from '../../services/firebase';
import { signOut, User } from 'firebase/auth';
import { getCleanPeerId } from '../../utils/peerId';

const getQueryParam = (param: string) => {
  const search = window.location.search;
  const urlParams = new URLSearchParams(search);
  const val = urlParams.get(param);
  if (val) return val;
  return null;
};

interface MobileStudioProps {
    user: User | null;
}

export const MobileStudio: React.FC<MobileStudioProps> = ({ user }) => {
  // --- Refs ---
  const videoRef = useRef<HTMLVideoElement>(null);
  const peerRef = useRef<Peer | null>(null);
  const dataConnRef = useRef<DataConnection | null>(null);
  const mediaConnRef = useRef<MediaConnection | null>(null);
  const wakeLockRef = useRef<any>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // --- State ---
  const [roomId, setRoomId] = useState<string | null>(() => getQueryParam('room') || localStorage.getItem('aether_target_room'));
  const [manualIdInput, setManualIdInput] = useState('');
  const [isSetupMode, setIsSetupMode] = useState(!roomId);
  
  // App Lifecycle State
  const [isCameraReady, setIsCameraReady] = useState(false);
  const [isCloudReady, setIsCloudReady] = useState(false);
  const [hostFound, setHostFound] = useState(false);
  const [isBroadcasting, setIsBroadcasting] = useState(false);
  const [isInterrupted, setIsInterrupted] = useState(false);
  
  const [isMuted, setIsMuted] = useState(false);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('environment');
  const [logs, setLogs] = useState<string[]>([]);
  const [showIOSPrompt, setShowIOSPrompt] = useState(false);
  
  // Audio Input Selection
  const [showAudioSettings, setShowAudioSettings] = useState(false);
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedAudioId, setSelectedAudioId] = useState<string>('');

  // Detect iOS for PWA Instructions
  useEffect(() => {
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
    const isStandalone = (window.navigator as any).standalone; 
    if (isIOS && !isStandalone) {
        setShowIOSPrompt(true);
    }
  }, []);

  const addLog = (msg: string) => {
      console.log(`[Mobile] ${msg}`);
      setLogs(prev => [msg, ...prev].slice(0, 2)); 
  };

  // --- 1. Audio Device Enumeration ---
  const loadAudioDevices = async () => {
    try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const inputs = devices.filter(d => d.kind === 'audioinput');
        setAudioDevices(inputs);
        if (inputs.length > 0 && !selectedAudioId) {
            setSelectedAudioId(inputs[0].deviceId);
        }
    } catch (e) {
        console.error("Failed to load audio devices", e);
    }
  };

  // --- 2. Camera Engine (Reusable) ---
  const initCamera = useCallback(async () => {
      try {
          if (streamRef.current) {
              streamRef.current.getTracks().forEach(t => t.stop());
          }

          addLog("Starting Media...");
          
          // Use selected audio ID if available
          const audioConstraints = selectedAudioId ? { deviceId: { exact: selectedAudioId } } : true;

          const stream = await navigator.mediaDevices.getUserMedia({
              video: {
              facingMode,
              width:  { ideal: 3840 },
              height: { ideal: 2160 },
              frameRate: { ideal: 30, max: 30 },
              aspectRatio: { ideal: 16 / 9 }
              },
              audio: audioConstraints
          });
          
           const vt = stream.getVideoTracks()[0];
           const s = vt.getSettings();
           addLog(`Cam settings: ${s.width}x${s.height} @${s.frameRate ?? "?"}fps`);


          // Track Monitoring for Interruptions
          stream.getVideoTracks()[0].onended = () => {
              addLog("Video Track Ended (Interruption)");
              setIsInterrupted(true);
          };

          streamRef.current = stream;
          if (videoRef.current) {
              videoRef.current.srcObject = stream;
              videoRef.current.play().catch(e => console.log("Autoplay blocked", e));
          }
          setIsCameraReady(true);
          setIsInterrupted(false);
          addLog("Camera Active");
          
          // Refresh devices list now that we have permissions
          loadAudioDevices();
          
          return stream;
      } catch (e) {
          addLog("Cam Error: " + (e as any).message);
          return null;
      }
  }, [facingMode, selectedAudioId]);

  // Initial Camera Load
  useEffect(() => {
      if (isSetupMode) return;
      
      let active = true;
      initCamera();
      
      // Request Wake Lock
      (navigator as any).wakeLock?.request('screen')
            .then((l: any) => wakeLockRef.current = l)
            .catch(() => {});

      return () => {
          active = false;
          wakeLockRef.current?.release();
      };
  }, [initCamera, isSetupMode]);

  // --- 3. PeerJS Cloud Connection (Auto) ---
  useEffect(() => {
      if (isSetupMode || !roomId) return;

      if (peerRef.current) peerRef.current.destroy();

      const myId = getCleanPeerId(roomId, 'client') + '-' + Math.floor(Math.random() * 1000);
      const hostId = getCleanPeerId(roomId, 'host');

      addLog(`ID: ${roomId} -> Cloud...`);
      
      const peer = new Peer(myId, { debug: 1 });
      peerRef.current = peer;

      peer.on('open', (id) => {
          addLog("Cloud Connected");
          setIsCloudReady(true);
          checkHostAvailability(peer, hostId);
      });

      peer.on('error', (err) => {
          addLog(`Cloud Err: ${err.type}`);
          setIsCloudReady(false);
          setHostFound(false);
          
          if (err.type === 'network' || err.type === 'peer-unavailable') {
              setTimeout(() => {
                  if (peerRef.current && !peerRef.current.destroyed) {
                      checkHostAvailability(peer, hostId);
                  }
              }, 2000);
          }
      });
      
      return () => {
          peer.destroy();
      };
  }, [roomId, isSetupMode]);

  const checkHostAvailability = (peer: Peer, hostId: string) => {
      addLog("Finding Host...");
      const conn = peer.connect(hostId, { reliable: true });
      
      const timeout = setTimeout(() => {
           if (!hostFound) {
               addLog("Host Not Found (Retrying)");
               conn.close();
               setTimeout(() => checkHostAvailability(peer, hostId), 3000);
           }
      }, 3000);

      conn.on('open', () => {
          clearTimeout(timeout);
          setHostFound(true);
          addLog("Host Found!");
          conn.close(); 
      });
  };

  // --- 4. User Triggered Broadcast ---
  const startBroadcast = useCallback(() => {
      if (!peerRef.current || !roomId || !streamRef.current) return;
      
      const hostId = getCleanPeerId(roomId, 'host');
      addLog("Broadcasting...");
      
      try {
          if (mediaConnRef.current) mediaConnRef.current.close();

          const call = peerRef.current.call(hostId, streamRef.current);
          mediaConnRef.current = call;
          
          call.on('close', () => {
              if (!document.hidden) {
                  setIsBroadcasting(false);
                  addLog("Stream Ended");
              }
          });
          
          if (dataConnRef.current) dataConnRef.current.close();
          const dataConn = peerRef.current.connect(hostId);
          dataConnRef.current = dataConn;
          
          dataConn.on('open', () => {
              setIsBroadcasting(true);
              dataConn.send({ type: 'mobile-handshake' });
          });
          
      } catch (e) {
          addLog("Call Failed");
      }
  }, [roomId]);


  // --- 5. Interruption Handling ---
  useEffect(() => {
    const handleVisibilityChange = async () => {
      if (document.visibilityState === 'visible') {
        addLog("Resuming...");
        const isVideoDead = !streamRef.current || streamRef.current.active === false || (videoRef.current && videoRef.current.paused);
        
        if (isVideoDead || isInterrupted) {
             addLog("Restoring Media...");
             const newStream = await initCamera();
             if (isBroadcasting && newStream) {
                 addLog("Reconnecting Stream...");
                 setTimeout(() => startBroadcast(), 1000);
             }
        }
      } else {
        addLog("Backgrounded");
        setIsInterrupted(true);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [isBroadcasting, isInterrupted, initCamera, startBroadcast]);


  const handleManualJoin = (e: React.FormEvent) => {
      e.preventDefault();
      if (manualIdInput.trim()) {
          const newRoom = manualIdInput.trim();
          setRoomId(newRoom);
          localStorage.setItem('aether_target_room', newRoom);
          setIsSetupMode(false);
      }
  };

  const resetRoom = () => {
      setRoomId(null);
      setIsSetupMode(true);
      setHostFound(false);
      setIsCloudReady(false);
  };

  // --- Render: Setup Mode ---
  if (isSetupMode) {
      return (
          <div className="fixed inset-0 bg-[#0f0518] flex flex-col items-center justify-center p-6 text-white overflow-y-auto">
              <div className="max-w-md w-full space-y-6">
                  <div className="text-center">
                      <div className="w-16 h-16 bg-aether-800 rounded-2xl flex items-center justify-center mx-auto mb-4 border border-aether-700">
                          <QrCode className="text-aether-400" size={32} />
                      </div>
                      <h1 className="text-2xl font-bold">Connect Camera</h1>
                      <p className="text-gray-400 mt-2 text-sm">Enter code from Desktop Studio</p>
                  </div>

                  <form onSubmit={handleManualJoin} className="space-y-4">
                      <input 
                          type="text" 
                          value={manualIdInput}
                          onChange={(e) => setManualIdInput(e.target.value)}
                          placeholder="Room Code (e.g. ab12)"
                          className="w-full bg-white/5 border border-white/10 rounded-xl p-4 text-center text-xl font-mono text-white focus:border-aether-500 outline-none uppercase"
                      />
                      <button type="submit" disabled={!manualIdInput} className="w-full bg-gradient-to-r from-aether-600 to-fuchsia-600 text-white font-bold py-4 rounded-xl disabled:opacity-50">
                          Connect
                      </button>
                  </form>
                  
                  <div className="flex justify-center mt-8 opacity-50">
                       <p className="text-[10px] font-mono tracking-widest uppercase">Tech by Tiwaton</p>
                  </div>
              </div>
          </div>
      );
  }

  // --- Render: Broadcasting Mode ---
  return (
    <div className="fixed inset-0 bg-black flex flex-col items-center justify-center text-white overflow-hidden">
      
      <video 
        ref={videoRef}
        autoPlay 
        muted 
        playsInline
        className={`absolute inset-0 w-full h-full object-cover z-0 transition-opacity duration-500 ${isBroadcasting ? 'opacity-100' : 'opacity-40 blur-sm'}`}
      />
      
      {/* Interruption Overlay */}
      {isInterrupted && (
          <div className="absolute inset-0 z-40 bg-black/80 flex flex-col items-center justify-center animate-in fade-in">
              <Activity className="animate-bounce text-red-500 mb-4" size={48} />
              <h2 className="text-xl font-bold">Signal Interrupted</h2>
              <p className="text-gray-400 text-sm mt-2">Recovering connection...</p>
          </div>
      )}

      {/* Header Info */}
      <div className="absolute top-0 left-0 w-full p-4 bg-gradient-to-b from-black/80 to-transparent flex justify-between items-start z-20">
         <div className="flex flex-col gap-1">
             <div className="flex items-center gap-2">
                 <div className={`w-2.5 h-2.5 rounded-full ${isBroadcasting ? 'bg-red-500 animate-pulse' : 'bg-yellow-500'}`} />
                 <span className="font-bold text-sm">Aether<span className="font-light opacity-70">Cam</span></span>
             </div>
             
             {!isBroadcasting && (
                 <button onClick={resetRoom} className="text-[10px] font-mono opacity-80 bg-black/40 px-2 py-1 rounded flex items-center gap-1 hover:bg-white/20">
                    Room: {roomId} <Edit2 size={8} />
                 </button>
             )}
         </div>
         
         <div className="flex flex-col items-end gap-1">
             {logs.map((log, i) => (
                 <span key={i} className="text-[9px] bg-black/50 px-2 py-0.5 rounded text-gray-300 font-mono">{log}</span>
             ))}
         </div>
      </div>

      {/* Audio Source Modal */}
      {showAudioSettings && (
          <div className="absolute inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-end justify-center pb-24">
              <div className="bg-aether-900 w-full max-w-md rounded-t-2xl p-6 border-t border-aether-700 animate-in slide-in-from-bottom-10">
                  <div className="flex justify-between items-center mb-4">
                      <h3 className="font-bold">Select Microphone</h3>
                      <button onClick={() => setShowAudioSettings(false)}><X size={20}/></button>
                  </div>
                  <div className="space-y-2 max-h-60 overflow-y-auto">
                      {audioDevices.map(device => (
                          <button
                            key={device.deviceId}
                            onClick={() => {
                                setSelectedAudioId(device.deviceId);
                                setShowAudioSettings(false);
                            }}
                            className={`w-full p-4 rounded-xl text-left text-sm flex items-center justify-between ${selectedAudioId === device.deviceId ? 'bg-aether-600 text-white' : 'bg-white/5 text-gray-300'}`}
                          >
                             <span>{device.label || 'Unknown Microphone'}</span>
                             {selectedAudioId === device.deviceId && <CheckCircle size={16} />}
                          </button>
                      ))}
                  </div>
              </div>
          </div>
      )}

      {/* Main Action Layer */}
      {!isBroadcasting && !isInterrupted && !showAudioSettings && (
          <div className="relative z-30 flex flex-col items-center justify-center w-full max-w-sm px-6">
              
              <div className="bg-aether-900/90 backdrop-blur-md rounded-2xl p-6 w-full border border-white/10 shadow-2xl space-y-4">
                  <h3 className="text-center font-bold text-lg mb-4">Ready to Stream</h3>
                  
                  <div className="space-y-3">
                      <div className="flex items-center justify-between text-sm">
                          <span className="text-gray-400 flex items-center gap-2"><Camera size={14} /> Camera</span>
                          {isCameraReady ? <CheckCircle size={16} className="text-green-500" /> : <Loader2 size={16} className="animate-spin text-yellow-500" />}
                      </div>
                      <div className="flex items-center justify-between text-sm">
                          <span className="text-gray-400 flex items-center gap-2"><Wifi size={14} /> Cloud</span>
                          {isCloudReady ? <CheckCircle size={16} className="text-green-500" /> : <Loader2 size={16} className="animate-spin text-yellow-500" />}
                      </div>
                      <div className="flex items-center justify-between text-sm">
                          <span className="text-gray-400 flex items-center gap-2"><Monitor size={14} /> Desktop</span>
                          {hostFound ? <CheckCircle size={16} className="text-green-500" /> : <Loader2 size={16} className="animate-spin text-yellow-500" />}
                      </div>
                  </div>

                  <button 
                      onClick={startBroadcast}
                      disabled={!isCameraReady || !isCloudReady || !hostFound}
                      className="w-full mt-6 bg-gradient-to-r from-red-600 to-pink-600 text-white font-bold py-4 rounded-xl shadow-lg hover:scale-105 active:scale-95 transition-all disabled:opacity-50 disabled:grayscale flex items-center justify-center gap-2"
                  >
                      <Radio size={20} /> START BROADCAST
                  </button>
                  
                  <div className="pt-2 text-center opacity-40">
                      <p className="text-[8px] font-mono tracking-widest uppercase">Tech by Tiwaton</p>
                  </div>
              </div>
          </div>
      )}

      {/* Active Controls */}
      <div className="absolute bottom-0 left-0 w-full p-6 bg-gradient-to-t from-black/90 to-transparent flex items-center justify-around pb-10 z-20">
         <button 
            onClick={() => setShowAudioSettings(true)}
            className={`p-4 rounded-full transition-all backdrop-blur-md ${isMuted ? 'bg-red-500 text-white' : 'bg-white/10 text-gray-200'}`}
        >
            {isMuted ? <MicOff size={24} /> : <Mic size={24} />}
        </button>
        
        {isBroadcasting && (
             <div className="bg-red-600 px-6 py-2 rounded-full flex items-center gap-2 animate-pulse shadow-[0_0_15px_red]">
                 <div className="w-2 h-2 bg-white rounded-full" />
                 <span className="font-bold text-xs tracking-widest">LIVE</span>
             </div>
        )}

        <button 
            onClick={() => setFacingMode(prev => prev === 'user' ? 'environment' : 'user')}
            className="p-4 rounded-full bg-white/10 text-gray-200 backdrop-blur-md"
        >
            <RefreshCcw size={24} />
        </button>
        
        {!isBroadcasting && (
            <button onClick={resetRoom} className="p-4 rounded-full bg-white/10 text-gray-200">
                <Settings size={24} />
            </button>
        )}
      </div>

    </div>
  );
};