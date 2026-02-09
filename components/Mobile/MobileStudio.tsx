import React, { useEffect, useRef, useState, useCallback } from "react";
import {
  Camera,
  Mic,
  MicOff,
  Wifi,
  RefreshCcw,
  Settings,
  QrCode,
  Loader2,
  CheckCircle,
  Radio,
  Monitor,
  Edit2,
  Activity,
  X,
} from "lucide-react";
import Peer, { DataConnection, MediaConnection } from "peerjs";
import { getPeerEnv } from "../../src/utils/peerEnv";
import { User } from "firebase/auth";
import { getCleanPeerId } from "../../utils/peerId";



const getQueryParam = (param: string) => {
  const urlParams = new URLSearchParams(window.location.search);
  return urlParams.get(param) || null;
};

const generateId = () => Math.random().toString(36).substr(2, 9);

type CamQuality = "auto" | "4k" | "1080p" | "720p";

const qualityPresets: Record<
  Exclude<CamQuality, "auto">,
  { width: number; height: number; frameRate: number }
> = {
  "4k": { width: 3840, height: 2160, frameRate: 30 },
  "1080p": { width: 1920, height: 1080, frameRate: 30 },
  "720p": { width: 1280, height: 720, frameRate: 30 },
};

const buildVideoConstraints = (
  q: CamQuality,
  facingMode: "user" | "environment"
): MediaTrackConstraints => {
  if (q === "auto") return { facingMode };
  const p = qualityPresets[q];
  return {
    facingMode,
    width: { ideal: p.width },
    height: { ideal: p.height },
    frameRate: { ideal: p.frameRate, max: p.frameRate },
    aspectRatio: { ideal: 16 / 9 },
  };
};

interface MobileStudioProps {
  user: User | null;
}

export const MobileStudio: React.FC<MobileStudioProps> = () => {
  // --- Refs ---
  const videoRef = useRef<HTMLVideoElement>(null);
  const peerRef = useRef<Peer | null>(null);
  const dataConnRef = useRef<DataConnection | null>(null);
  const mediaConnRef = useRef<MediaConnection | null>(null);
  const wakeLockRef = useRef<any>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const relayWsRef = useRef<WebSocket | null>(null);

  const hostCheckTimerRef = useRef<number | null>(null);
  const hostCheckAttemptRef = useRef(0);

  // --- State ---
  const [roomId, setRoomId] = useState<string | null>(() => {
    return getQueryParam("room") || localStorage.getItem("aether_target_room");
  });
  const [sourceId, setSourceId] = useState<string | null>(() => {
    return getQueryParam("sourceId") || localStorage.getItem("aether_source_id");
  });
  const [sourceLabel, setSourceLabel] = useState<string>(() => {
    return getQueryParam("sourceLabel") || localStorage.getItem("aether_source_label") || "Phone Cam";
  });
  const [manualIdInput, setManualIdInput] = useState("");
  const [isSetupMode, setIsSetupMode] = useState(!roomId);

  // lifecycle
  const [isCameraReady, setIsCameraReady] = useState(false);
  const [isCloudReady, setIsCloudReady] = useState(false);
  const [hostFound, setHostFound] = useState(false);
  const [isBroadcasting, setIsBroadcasting] = useState(false);
  const [isInterrupted, setIsInterrupted] = useState(false);

  const [isMuted, setIsMuted] = useState(false);
  const [facingMode, setFacingMode] = useState<"user" | "environment">("environment");
  const [logs, setLogs] = useState<string[]>([]);

  // audio device selection
  const [showAudioSettings, setShowAudioSettings] = useState(false);
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedAudioId, setSelectedAudioId] = useState<string>("");

  // quality
  const [camQuality, setCamQuality] = useState<CamQuality>("auto");
  const [batteryInfo, setBatteryInfo] = useState<{ level: number; charging: boolean } | null>(null);

  const addLog = useCallback((msg: string) => {
    console.log(`[Mobile] ${msg}`);
    setLogs((prev) => [msg, ...prev].slice(0, 3));
  }, []);

  useEffect(() => {
    let battery: any = null;
    const update = () => {
      if (!battery) return;
      setBatteryInfo({ level: battery.level || 0, charging: !!battery.charging });
    };
    (navigator as any).getBattery?.().then((b: any) => {
      battery = b;
      update();
      b.addEventListener("levelchange", update);
      b.addEventListener("chargingchange", update);
    });
    return () => {
      if (!battery) return;
      battery.removeEventListener("levelchange", update);
      battery.removeEventListener("chargingchange", update);
    };
  }, []);

  // Ensure setup mode drops if roomId arrives
  useEffect(() => {
    if (roomId) setIsSetupMode(false);
  }, [roomId]);

  useEffect(() => {
    if (roomId && !sourceId) {
      setSourceId(generateId());
    }
  }, [roomId, sourceId]);

  useEffect(() => {
    if (sourceId) localStorage.setItem("aether_source_id", sourceId);
    if (sourceLabel) localStorage.setItem("aether_source_label", sourceLabel);
  }, [sourceId, sourceLabel]);

  const stopAllMedia = useCallback(() => {
    const s = streamRef.current;
    if (s) {
      s.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      try {
        videoRef.current.pause();
        (videoRef.current as any).srcObject = null;
      } catch {}
    }
    setIsCameraReady(false);
  }, []);

  const loadAudioDevices = useCallback(async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const inputs = devices.filter((d) => d.kind === "audioinput");
      setAudioDevices(inputs);

      // choose first available if none selected
      if (!selectedAudioId && inputs.length > 0) {
        setSelectedAudioId(inputs[0].deviceId);
      }
    } catch (e) {
      console.error("Failed to enumerate devices", e);
    }
  }, [selectedAudioId]);

  // --- Camera engine (stability-focused) ---
  const initCamera = useCallback(async (): Promise<MediaStream | null> => {
    try {
      // always “settle” UI first
      setIsCameraReady(false);
      setIsInterrupted(false);

      // stop previous tracks to avoid iOS conflicts
      stopAllMedia();

      addLog("Starting Media...");

      // IMPORTANT: on iOS/Safari, using exact deviceId before permissions can be flaky.
      // So: if labels are empty and we haven't enumerated reliably, use audio:true.
      const canUseExactAudio =
        !!selectedAudioId &&
        audioDevices.length > 0 &&
        audioDevices.some((d) => d.deviceId === selectedAudioId);

      const audioConstraints: MediaTrackConstraints | boolean = canUseExactAudio
        ? { deviceId: { exact: selectedAudioId } }
        : true;

      const attempts: CamQuality[] =
        camQuality === "auto" ? ["4k", "1080p", "720p"] : [camQuality, "1080p", "720p"];

      let stream: MediaStream | null = null;
      let lastErr: any = null;

      for (const q of attempts) {
        try {
          addLog(`Requesting ${q.toUpperCase()}...`);

          stream = await navigator.mediaDevices.getUserMedia({
            video: buildVideoConstraints(q, facingMode),
            audio: audioConstraints,
          });

          const vt = stream.getVideoTracks()[0];
          const s = vt?.getSettings?.() || {};
          addLog(`Got: ${s.width ?? "?"}x${s.height ?? "?"} @${s.frameRate ?? "?"}fps`);
          break;
        } catch (e) {
          lastErr = e;
          addLog(`Failed ${q.toUpperCase()}`);
          stream = null;
        }
      }

      if (!stream) {
        try {
          addLog("Fallback: basic camera...");
          stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode },
            audio: audioConstraints,
          });
        } catch (e) {
          lastErr = e;
        }
      }

      if (!stream) {
        try {
          addLog("Fallback: video-only...");
          stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode },
            audio: false,
          });
        } catch (e) {
          lastErr = e;
        }
      }

      if (!stream) throw lastErr || new Error("Unable to start camera");

      // monitor interruptions
      const vt = stream.getVideoTracks()[0];
      if (vt) {
        vt.onended = () => {
          addLog("Video Track Ended (Interruption)");
          setIsInterrupted(true);
          setIsCameraReady(false);
        };
      }

      // apply mute
      stream.getAudioTracks().forEach((t) => (t.enabled = !isMuted));

      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        // play best-effort (iOS sometimes rejects; preview can still work)
        await videoRef.current.play().catch(() => {});
      }

      // after permissions, enumerate devices (labels populate)
      setTimeout(() => loadAudioDevices(), 50);

      setIsCameraReady(true);
      setIsInterrupted(false);
      addLog("Camera Active");

      return stream;
    } catch (e: any) {
      setIsCameraReady(false);
      setIsInterrupted(false);
      const name = e?.name || "unknown";
      if (name === "NotReadableError") {
        addLog("Cam Error: Camera in use by another app. Close it and retry.");
      } else if (name === "NotAllowedError" || name === "SecurityError") {
        addLog("Cam Error: Permission blocked. Allow camera access.");
      } else {
        addLog(`Cam Error: ${name} - ${e?.message || ""}`);
      }
      return null;
    }
  }, [addLog, audioDevices, camQuality, facingMode, isMuted, loadAudioDevices, selectedAudioId, stopAllMedia]);

  // wake lock + initial camera
  useEffect(() => {
    if (isSetupMode) return;

    initCamera();

    (navigator as any).wakeLock
      ?.request("screen")
      .then((l: any) => (wakeLockRef.current = l))
      .catch(() => {});

    return () => {
      wakeLockRef.current?.release?.();
    };
  }, [initCamera, isSetupMode]);

  // mute toggles track enabled
  useEffect(() => {
    const s = streamRef.current;
    if (!s) return;
    s.getAudioTracks().forEach((t) => (t.enabled = !isMuted));
  }, [isMuted]);

  // quality changes re-init only if not live
  useEffect(() => {
    if (isSetupMode) return;
    if (isBroadcasting) return;
    initCamera();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camQuality]);

  // facing mode change re-init (not while live)
  useEffect(() => {
    if (isSetupMode) return;
    if (isBroadcasting) return;
    initCamera();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facingMode]);

  const stopHostChecker = useCallback(() => {
    if (hostCheckTimerRef.current) {
      window.clearTimeout(hostCheckTimerRef.current);
      hostCheckTimerRef.current = null;
    }
    hostCheckAttemptRef.current = 0;
  }, []);

  const startHostChecker = useCallback(
    (peer: Peer, hostId: string) => {
      stopHostChecker();

      const tick = () => {
        hostCheckAttemptRef.current += 1;
        addLog(`Finding Host... (${hostCheckAttemptRef.current})`);

        const conn = peer.connect(hostId, { reliable: true });

        const t = window.setTimeout(() => {
          try {
            conn.close();
          } catch {}
          // retry
          hostCheckTimerRef.current = window.setTimeout(tick, 1200);
        }, 2000);

        conn.on("open", () => {
          window.clearTimeout(t);
          setHostFound(true);
          addLog("Host Found!");
          try {
            conn.close();
          } catch {}
          stopHostChecker();
        });

        conn.on("error", () => {
          window.clearTimeout(t);
          try {
            conn.close();
          } catch {}
          hostCheckTimerRef.current = window.setTimeout(tick, 1200);
        });
      };

      tick();
    },
    [addLog, stopHostChecker]
  );

  // --- PeerJS Cloud Connection ---
useEffect(() => {
  if (isSetupMode || !roomId) return;

  stopHostChecker();
  setIsCloudReady(false);
  setHostFound(false);

  const hostId = getCleanPeerId(roomId, "host");
  const myId = `${getCleanPeerId(roomId, "client")}-${Math.floor(Math.random() * 1000)}`;

  addLog(`ID: ${roomId} -> Cloud...`);

  // ✅ Guard: if we already have a live peer, keep it (prevents WS churn / "closed before established")
  const existing: any = peerRef.current;
  if (existing && !existing.destroyed) {
    // ensure we’re actively checking for the host
    startHostChecker(existing, hostId);
    setIsCloudReady(true);
    return;
  }

  // Cleanup any previous peer only if it exists but is unusable
  if (existing) {
    try { existing.destroy(); } catch {}
    peerRef.current = null;
  }

  const peerEnv = getPeerEnv();
  console.log("PEER ENV RESOLVED:", peerEnv);

  const peer = new Peer(myId, {
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

  peer.on("open", () => {
    setIsCloudReady(true);
    startHostChecker(peer, hostId);
  });

  peer.on("disconnected", () => {
    // don’t destroy; allow peerjs reconnect logic
    setIsCloudReady(false);
    setHostFound(false);
    addLog("Cloud disconnected. Reconnecting...");
    try { (peer as any).reconnect?.(); } catch {}
  });

  peer.on("close", () => {
    setIsCloudReady(false);
    setHostFound(false);
    addLog("Cloud closed");
  });

  peer.on("error", (err: any) => {
    addLog(`Cloud Err: ${err?.type || "error"}`);
    setIsCloudReady(false);
    setHostFound(false);

    // keep trying to find host if cloud blips
    const p: any = peerRef.current;
    if (p && !p.destroyed) {
      startHostChecker(p, hostId);
    }
  });

  return () => {
    stopHostChecker();

    // Only destroy if THIS effect created the current peer instance
    const p: any = peerRef.current;
    if (p === peer) {
      try { peer.destroy(); } catch {}
      peerRef.current = null;
    }
  };
}, [addLog, isSetupMode, roomId, startHostChecker, stopHostChecker]);

  // --- Broadcast ---
  const startBroadcast = useCallback(async () => {
    if (!roomId) return;

    // If camera isn’t ready, try to recover once (prevents dead “Camera” spinner)
    if (!streamRef.current || !isCameraReady) {
      addLog("Camera not ready — retrying...");
      const s = await initCamera();
      if (!s) {
        addLog("Camera still not ready");
        return;
      }
    }

    if (!peerRef.current || !streamRef.current) {
      addLog("Not ready to broadcast");
      return;
    }

    const hostId = getCleanPeerId(roomId, "host");
    addLog("Broadcasting...");

    try {
      // close existing
      try {
        mediaConnRef.current?.close();
      } catch {}
      mediaConnRef.current = null;

      const call = peerRef.current.call(hostId, streamRef.current, {
        metadata: { sourceId, label: sourceLabel },
      });
      mediaConnRef.current = call;

      // best-effort sender params
      setTimeout(async () => {
        try {
          const pc: RTCPeerConnection | undefined = (call as any).peerConnection;
          if (!pc) return;

          const sender = pc.getSenders().find((s) => s.track && s.track.kind === "video");
          if (!sender) return;

          const params = sender.getParameters();
          if (!params.encodings) params.encodings = [{}];

          params.encodings[0].maxBitrate = 18_000_000; // 18 Mbps
          (params as any).degradationPreference = "maintain-resolution";

          await sender.setParameters(params);

          const track = sender.track as MediaStreamTrack;
          (track as any).contentHint = "motion";

          addLog("WebRTC: HQ sender params applied");
        } catch {
          addLog("WebRTC HQ tweak failed");
        }
      }, 600);

      call.on("close", () => {
        setIsBroadcasting(false);
        addLog("Stream Ended");
      });

      // optional data conn
      try {
        dataConnRef.current?.close();
      } catch {}
      dataConnRef.current = null;

      const dc = peerRef.current.connect(hostId);
      dataConnRef.current = dc;

      dc.on("open", () => {
        setIsBroadcasting(true);
        dc.send({ type: "mobile-handshake", sourceId, label: sourceLabel });
      });

      dc.on("error", () => {
        // don’t kill video call because data conn failed
      });
    } catch (e) {
      addLog("Call Failed");
    }
  }, [addLog, initCamera, isCameraReady, roomId]);

  // --- Relay WebSocket (Mobile) ---
useEffect(() => {
  if (isSetupMode || !roomId) return;

  const wsUrl = import.meta.env.VITE_SIGNAL_URL as string | undefined;
  if (!wsUrl) return;

  // close any previous relay socket
  try { relayWsRef.current?.close(); } catch {}
  relayWsRef.current = null;

  let ws: WebSocket | null = null;

  try {
    ws = new WebSocket(wsUrl);
    relayWsRef.current = ws;

    ws.onopen = () => {
      addLog("Relay connected");
      ws?.send(JSON.stringify({
        type: "join",
        role: "client",
        sessionId: roomId,
        token: import.meta.env.VITE_RELAY_TOKEN, // optional
      }));
    };

    ws.onmessage = (e) => {
      // optional: addLog(`Relay msg: ${String(e.data).slice(0, 80)}`);
    };

    ws.onerror = () => addLog("Relay connection failed");
    ws.onclose = () => addLog("Relay disconnected");
  } catch {
    addLog("Relay failed to start");
  }

  return () => {
    try { ws?.close(); } catch {}
    ws = null;

    try { relayWsRef.current?.close(); } catch {}
    relayWsRef.current = null;
  };
}, [isSetupMode, roomId, addLog]);


  // --- Interruption handling ---
  useEffect(() => {
    const onVis = async () => {
      if (document.visibilityState === "visible") {
        addLog("Resuming...");

        const isVideoDead =
          !streamRef.current ||
          streamRef.current.active === false ||
          (!!videoRef.current && videoRef.current.paused);

        if (isVideoDead || isInterrupted) {
          addLog("Restoring Media...");
          const newStream = await initCamera();

          if (isBroadcasting && newStream) {
            addLog("Reconnecting Stream...");
            setTimeout(() => startBroadcast(), 800);
          }
        }
      } else {
        addLog("Backgrounded");
        setIsInterrupted(true);
      }
    };

    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [addLog, initCamera, isBroadcasting, isInterrupted, startBroadcast]);

  const handleManualJoin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualIdInput.trim()) return;

    const newRoom = manualIdInput.trim();
    setRoomId(newRoom);
    localStorage.setItem("aether_target_room", newRoom);
    setIsSetupMode(false);
  };

  const resetRoom = () => {
    stopHostChecker();

    setRoomId(null);
    localStorage.removeItem("aether_target_room");
    setIsSetupMode(true);

    setHostFound(false);
    setIsCloudReady(false);

    setIsCameraReady(false);
    setIsBroadcasting(false);
    setIsInterrupted(false);

    stopAllMedia();

    try {
      dataConnRef.current?.close();
    } catch {}
    dataConnRef.current = null;

    try {
      mediaConnRef.current?.close();
    } catch {}
    mediaConnRef.current = null;

    try {
      peerRef.current?.destroy();
    } catch {}
    peerRef.current = null;
  };

  // --- Setup Mode ---
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
            <button
              type="submit"
              disabled={!manualIdInput}
              className="w-full bg-gradient-to-r from-aether-600 to-fuchsia-600 text-white font-bold py-4 rounded-xl disabled:opacity-50"
            >
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

  // --- Broadcasting Mode ---
  return (
    <div className="fixed inset-0 bg-black flex flex-col items-center justify-center text-white overflow-hidden">
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        className={`absolute inset-0 w-full h-full object-cover z-0 transition-opacity duration-500 ${
          isBroadcasting ? "opacity-100" : "opacity-40 blur-sm"
        }`}
      />

      {isInterrupted && (
        <div className="absolute inset-0 z-40 bg-black/80 flex flex-col items-center justify-center animate-in fade-in">
          <Activity className="animate-bounce text-red-500 mb-4" size={48} />
          <h2 className="text-xl font-bold">Signal Interrupted</h2>
          <p className="text-gray-400 text-sm mt-2">Recovering connection...</p>
        </div>
      )}

      <div className="absolute top-0 left-0 w-full p-4 bg-gradient-to-b from-black/80 to-transparent flex justify-between items-start z-20">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <div className={`w-2.5 h-2.5 rounded-full ${isBroadcasting ? "bg-red-500 animate-pulse" : "bg-yellow-500"}`} />
            <span className="font-bold text-sm">
              Aether<span className="font-light opacity-70">Cam</span>
            </span>
          </div>

          {!isBroadcasting && (
            <button
              onClick={resetRoom}
              className="text-[10px] font-mono opacity-80 bg-black/40 px-2 py-1 rounded flex items-center gap-1 hover:bg-white/20"
            >
              Room: {roomId} <Edit2 size={8} />
            </button>
          )}
          <div className="text-[9px] font-mono opacity-60">Source: {sourceLabel}</div>
          {batteryInfo && (
            <div className="text-[9px] font-mono opacity-60">
              Battery: {Math.round(batteryInfo.level * 100)}% {batteryInfo.charging ? "⚡" : ""}
            </div>
          )}
        </div>

        <div className="flex flex-col items-end gap-1">
          {logs.map((log, i) => (
            <span key={i} className="text-[9px] bg-black/50 px-2 py-0.5 rounded text-gray-300 font-mono">
              {log}
            </span>
          ))}
        </div>
      </div>

      {showAudioSettings && (
        <div className="absolute inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-end justify-center pb-24">
          <div className="bg-aether-900 w-full max-w-md rounded-t-2xl p-6 border-t border-aether-700 animate-in slide-in-from-bottom-10">
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-bold">Select Microphone</h3>
              <button onClick={() => setShowAudioSettings(false)}>
                <X size={20} />
              </button>
            </div>
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {audioDevices.map((device) => (
                <button
                  key={device.deviceId}
                  onClick={() => {
                    setSelectedAudioId(device.deviceId);
                    setShowAudioSettings(false);
                    setTimeout(() => initCamera(), 50);
                  }}
                  className={`w-full p-4 rounded-xl text-left text-sm flex items-center justify-between ${
                    selectedAudioId === device.deviceId ? "bg-aether-600 text-white" : "bg-white/5 text-gray-300"
                  }`}
                >
                  <span>{device.label || "Microphone"}</span>
                  {selectedAudioId === device.deviceId && <CheckCircle size={16} />}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {!isBroadcasting && !isInterrupted && !showAudioSettings && (
        <div className="relative z-30 flex flex-col items-center justify-center w-full max-w-sm px-6">
          <div className="bg-aether-900/90 backdrop-blur-md rounded-2xl p-6 w-full border border-white/10 shadow-2xl space-y-4">
            <h3 className="text-center font-bold text-lg mb-4">Ready to Stream</h3>

            <div className="space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-400 flex items-center gap-2">
                  <Camera size={14} /> Camera
                </span>
                {isCameraReady ? (
                  <CheckCircle size={16} className="text-green-500" />
                ) : (
                  <Loader2 size={16} className="animate-spin text-yellow-500" />
                )}
              </div>

              {!isCameraReady && (
                <button
                  onClick={() => initCamera()}
                  className="w-full bg-white/10 text-white text-xs py-2 rounded-lg border border-white/10 hover:bg-white/20"
                >
                  Retry Camera
                </button>
              )}

              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-400 flex items-center gap-2">
                  <Wifi size={14} /> Cloud
                </span>
                {isCloudReady ? (
                  <CheckCircle size={16} className="text-green-500" />
                ) : (
                  <Loader2 size={16} className="animate-spin text-yellow-500" />
                )}
              </div>

              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-400 flex items-center gap-2">
                  <Monitor size={14} /> Desktop
                </span>
                {hostFound ? (
                  <CheckCircle size={16} className="text-green-500" />
                ) : (
                  <Loader2 size={16} className="animate-spin text-yellow-500" />
                )}
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

      <div className="absolute bottom-0 left-0 w-full p-6 bg-gradient-to-t from-black/90 to-transparent flex items-center justify-around pb-10 z-20">
        <button
          onClick={() => {
            // this button is “mic settings”, not mute (your original design)
            setShowAudioSettings(true);
          }}
          className={`p-4 rounded-full transition-all backdrop-blur-md ${isMuted ? "bg-red-500 text-white" : "bg-white/10 text-gray-200"}`}
          title="Mic settings"
        >
          {isMuted ? <MicOff size={24} /> : <Mic size={24} />}
        </button>

        <button
          onClick={() => {
            setCamQuality((prev) =>
              prev === "auto" ? "4k" : prev === "4k" ? "1080p" : prev === "1080p" ? "720p" : "auto"
            );
          }}
          className="p-4 rounded-full bg-white/10 text-gray-200 backdrop-blur-md"
          title="Quality"
        >
          <span className="text-[10px] font-mono">{camQuality === "auto" ? "AUTO" : camQuality.toUpperCase()}</span>
        </button>

        {isBroadcasting && (
          <div className="bg-red-600 px-6 py-2 rounded-full flex items-center gap-2 animate-pulse shadow-[0_0_15px_red]">
            <div className="w-2 h-2 bg-white rounded-full" />
            <span className="font-bold text-xs tracking-widest">LIVE</span>
          </div>
        )}

        <button
          onClick={() => setFacingMode((prev) => (prev === "user" ? "environment" : "user"))}
          className="p-4 rounded-full bg-white/10 text-gray-200 backdrop-blur-md"
          title="Flip camera"
        >
          <RefreshCcw size={24} />
        </button>

        {!isBroadcasting && (
          <button onClick={resetRoom} className="p-4 rounded-full bg-white/10 text-gray-200" title="Reset">
            <Settings size={24} />
          </button>
        )}
      </div>
    </div>
  );
};
