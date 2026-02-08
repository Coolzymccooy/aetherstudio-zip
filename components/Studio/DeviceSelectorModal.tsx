import React, { useEffect, useState } from 'react';
import { Camera, Mic, X, RefreshCw, Loader2 } from 'lucide-react';

interface DeviceSelectorModalProps {
  onSelect: (videoDeviceId: string, audioDeviceId: string, videoLabel: string) => void;
  onClose: () => void;
}

export const DeviceSelectorModal: React.FC<DeviceSelectorModalProps> = ({ onSelect, onClose }) => {
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedVideo, setSelectedVideo] = useState<string>('');
  const [selectedAudio, setSelectedAudio] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadDevices = async () => {
    setIsLoading(true);
    setError(null);
    try {
      // Must request permission first to see labels
      await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      
      const devices = await navigator.mediaDevices.enumerateDevices();
      
      const video = devices.filter(d => d.kind === 'videoinput');
      const audio = devices.filter(d => d.kind === 'audioinput');
      
      setVideoDevices(video);
      setAudioDevices(audio);
      
      if (video.length > 0) setSelectedVideo(video[0].deviceId);
      if (audio.length > 0) setSelectedAudio(audio[0].deviceId);
      if (audio.length === 0) setSelectedAudio("");
      
    } catch (err) {
      console.error("Error loading devices", err);
      setError("Could not access devices. Please allow camera permissions.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadDevices();
  }, []);

  const handleConfirm = () => {
    const label =
      videoDevices.find((d) => d.deviceId === selectedVideo)?.label ||
      `Camera ${selectedVideo.slice(0, 5)}...`;
    onSelect(selectedVideo, selectedAudio, label);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in">
      <div className="bg-aether-900 border border-aether-700 rounded-xl w-[480px] shadow-2xl p-6">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <Camera className="text-aether-500" size={24} /> 
            Select Source
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
            <X size={20} />
          </button>
        </div>

        {error ? (
          <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-4 rounded-lg mb-4 text-sm">
            {error}
            <button 
              onClick={loadDevices} 
              className="mt-2 text-white bg-red-500/20 hover:bg-red-500/30 px-3 py-1 rounded text-xs"
            >
              Retry
            </button>
          </div>
        ) : isLoading ? (
          <div className="flex flex-col items-center justify-center py-8 text-gray-500 gap-2">
            <Loader2 className="animate-spin" size={24} />
            <span className="text-sm">Scanning for cameras...</span>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Video Selection */}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-2">
                <Camera size={14} /> Video Input
              </label>
              <select 
                value={selectedVideo}
                onChange={(e) => setSelectedVideo(e.target.value)}
                className="w-full bg-aether-800 border border-aether-700 rounded-lg p-3 text-sm text-white focus:outline-none focus:border-aether-500"
              >
                {videoDevices.map(device => (
                  <option key={device.deviceId} value={device.deviceId}>
                    {device.label || `Camera ${device.deviceId.slice(0,5)}...`}
                  </option>
                ))}
              </select>
            </div>

            {/* Audio Selection */}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-2">
                <Mic size={14} /> Audio Input
              </label>
              <select 
                value={selectedAudio}
                onChange={(e) => setSelectedAudio(e.target.value)}
                className="w-full bg-aether-800 border border-aether-700 rounded-lg p-3 text-sm text-white focus:outline-none focus:border-aether-500"
              >
                <option value="">No Microphone</option>
                {audioDevices.map(device => (
                  <option key={device.deviceId} value={device.deviceId}>
                    {device.label || `Microphone ${device.deviceId.slice(0,5)}...`}
                  </option>
                ))}
              </select>
            </div>
            
            <div className="bg-blue-500/10 border border-blue-500/20 rounded p-3 text-xs text-blue-200">
              <span className="font-bold">Pro Tip:</span> If using your phone, ensure your Camo/DroidCam app is running first, then click Refresh.
            </div>
          </div>
        )}

        <div className="flex gap-3 mt-8">
          <button 
            onClick={loadDevices}
            className="p-2.5 rounded-lg border border-aether-700 text-gray-400 hover:text-white hover:bg-aether-800 transition-colors"
            title="Refresh Devices"
          >
            <RefreshCw size={18} />
          </button>
          <button 
            onClick={handleConfirm}
            disabled={isLoading || !selectedVideo}
            className="flex-1 bg-aether-500 hover:bg-aether-600 text-white font-medium py-2.5 rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Add Source
          </button>
        </div>
      </div>
    </div>
  );
};
