import React from 'react';
import { X, Smartphone, Monitor, Zap, Layers, Video, Mic, Settings, Radio } from 'lucide-react';

interface HelpModalProps {
  onClose: () => void;
}

export const HelpModal: React.FC<HelpModalProps> = ({ onClose }) => {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm animate-in fade-in">
      <div className="bg-aether-900 border border-aether-700 rounded-2xl w-[600px] shadow-2xl flex flex-col max-h-[90vh]">
        <div className="flex justify-between items-center p-6 border-b border-aether-700">
          <h2 className="text-2xl font-bold text-white flex items-center gap-2">
            <Zap className="text-aether-500" /> Aether Studio Guide
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
            <X size={24} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-8">
          
          <section className="bg-gradient-to-r from-aether-900 to-aether-800 p-4 rounded-xl border border-aether-700/50 space-y-3">
             <h3 className="text-lg font-bold text-white mb-2">🚀 End-to-End Validation Flow</h3>
             <ol className="list-decimal list-inside space-y-3 text-sm text-gray-300">
                 <li>
                     <strong>Set Stream Key:</strong> Click <Settings className="inline w-3 h-3"/> Settings and enter your RTMP Key.
                 </li>
                 <li>
                     <strong>Connect Mobile:</strong> Click the <strong>Mobile</strong> button and scan the QR with your phone. Tap "Start Broadcast" on your phone.
                 </li>
                 <li>
                     <strong>Check Audio:</strong> Speak into your phone. Ensure the "Mobile Mic" meter moves in the mixer.
                 </li>
                 <li>
                     <strong>Go Live:</strong> Click <strong>"Go Live"</strong>. This will now pipe the stream to your backend (requires server running).
                 </li>
             </ol>
          </section>

          <section className="space-y-3">
            <h3 className="text-lg font-semibold text-aether-400 flex items-center gap-2">
              <Mic size={20} /> Advanced Audio
            </h3>
            <p className="text-sm text-gray-300">
              <strong>Noise Cancellation:</strong> Click the Sparkles icon on the audio track to toggle AI noise removal.
              <br/>
              <strong>Mic Selection:</strong> On your phone, tap the Mic icon in the bottom bar to switch between Internal Mic, AirPods, or Wired headsets.
            </p>
          </section>

          <section className="space-y-3">
            <h3 className="text-lg font-semibold text-aether-400 flex items-center gap-2">
              <Layers size={20} /> Editing Layers
            </h3>
            <p className="text-sm text-gray-300">
              Select any layer on the canvas to move it. Use the <strong>Properties Panel</strong> on the right to crop (Circle/Rect), apply filters, change opacity, or edit text.
            </p>
          </section>

          <section className="space-y-3">
            <h3 className="text-lg font-semibold text-aether-400 flex items-center gap-2">
              <Radio size={20} /> Virtual Cable & Output
            </h3>
            <p className="text-sm text-gray-300">
              Aether Studio includes a cloud-based virtual cable. When you click <strong>Go Live</strong>, your mixed audio and video are piped directly to the streaming server via RTMP, acting as a virtual direct line to platforms like YouTube or Twitch without needing OBS on your machine.
            </p>
          </section>

        </div>

        <div className="p-6 border-t border-aether-700 bg-aether-800/30 text-center flex justify-between items-center">
          <span className="text-[10px] font-mono text-gray-500 uppercase tracking-widest">Tech by Tiwaton</span>
          <button 
            onClick={onClose}
            className="bg-aether-500 hover:bg-aether-600 text-white px-8 py-2 rounded-lg font-medium transition-all shadow-lg shadow-aether-500/20"
          >
            Start Streaming
          </button>
        </div>
      </div>
    </div>
  );
};