import React, { useMemo, useState } from 'react';
import { X, Smartphone, Monitor, Zap, Layers, Mic, Settings, Radio, HelpCircle, Search, MessageSquare } from 'lucide-react';

interface HelpModalProps {
  onClose: () => void;
}

export const HelpModal: React.FC<HelpModalProps> = ({ onClose }) => {
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<string | null>(null);

  const faq = useMemo(() => ([
    {
      q: "How do I go live to YouTube or Twitch?",
      a: "Open Settings, paste your stream key, make sure Relay is Online, then click Go Live. Your stream is sent via the local relay and ffmpeg.",
      k: ["go live", "youtube", "twitch", "stream key", "relay", "ffmpeg"],
    },
    {
      q: "How do I add multiple cameras?",
      a: "Open Inputs, click Add Local for each camera device. Each camera becomes its own input you can rename and switch.",
      k: ["multiple", "cameras", "local", "add camera", "inputs"],
    },
    {
      q: "How do I add multiple phones?",
      a: "Open Inputs, click Add Phone to generate a new QR for each phone slot. Each QR creates a separate phone input.",
      k: ["phones", "qr", "add phone", "multiple phones", "slot"],
    },
    {
      q: "How do I switch the main camera?",
      a: "In Inputs, click Make Main on any source. You can also use hotkeys 1-9 to cut to a source.",
      k: ["switch", "main", "cut", "hotkey"],
    },
    {
      q: "What is Composer Mode?",
      a: "Composer Mode shows a main camera plus thumbnail cameras to the audience. Enable it in Inputs and click Apply.",
      k: ["composer", "layout", "thumbnails", "grid"],
    },
    {
      q: "Why is my phone not connecting?",
      a: "Make sure the phone opened the QR link for the correct slot, the Peer server is reachable, and the phone granted camera permission.",
      k: ["phone", "not connecting", "peer", "permission"],
    },
    {
      q: "How do I use a capture card or pro camera?",
      a: "Connect the capture card, then Add Local and select it from the camera list. It will appear as a standard video input.",
      k: ["capture", "dslr", "pro camera", "hdmi"],
    },
  ]), []);

  const handleAsk = () => {
    const q = question.trim().toLowerCase();
    if (!q) return;
    const hit = faq.find(item => item.k.some(k => q.includes(k)));
    if (hit) {
      setAnswer(hit.a);
      return;
    }
    setAnswer("I am not sure. Try asking about: adding cameras, phone QR, going live, or composer mode.");
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm animate-in fade-in">
      <div className="bg-aether-900 border border-aether-700 rounded-2xl w-[720px] shadow-2xl flex flex-col max-h-[90vh]">
        <div className="flex justify-between items-center p-6 border-b border-aether-700">
          <h2 className="text-2xl font-bold text-white flex items-center gap-2">
            <Zap className="text-aether-500" /> Aether Studio Guide
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
            <X size={24} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-8">
          <section className="bg-aether-800/40 border border-aether-700 rounded-xl p-4 space-y-3">
            <div className="flex items-center gap-2 text-aether-300">
              <MessageSquare size={16} />
              <h3 className="text-sm font-bold">Help Bot (Local)</h3>
            </div>
            <div className="flex gap-2">
              <input
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="Ask: How do I add multiple phones?"
                className="flex-1 bg-black/30 border border-aether-700 rounded-lg px-3 py-2 text-sm text-white outline-none"
              />
              <button
                onClick={handleAsk}
                className="px-3 py-2 rounded-lg bg-aether-700 hover:bg-aether-600 text-white text-sm flex items-center gap-2"
              >
                <Search size={14} /> Ask
              </button>
            </div>
            {answer && (
              <div className="text-sm text-gray-300 bg-black/30 border border-aether-700 rounded-lg p-3">
                {answer}
              </div>
            )}
            <div className="text-[10px] text-gray-500">
              This bot is local and uses built-in help topics (no network calls).
            </div>
          </section>

          <section className="bg-gradient-to-r from-aether-900 to-aether-800 p-4 rounded-xl border border-aether-700/50 space-y-3">
            <h3 className="text-lg font-bold text-white mb-2">Quick Start (End-to-End)</h3>
            <ol className="list-decimal list-inside space-y-3 text-sm text-gray-300">
              <li>
                <strong>Set Stream Key:</strong> Click <Settings className="inline w-3 h-3"/> Settings and enter your RTMP key.
              </li>
              <li>
                <strong>Add Cameras:</strong> Open <strong>Inputs</strong>. Click <strong>Add Local</strong> for webcams or capture cards.
              </li>
              <li>
                <strong>Add Phones:</strong> Click <strong>Add Phone</strong> to generate a QR for each phone slot.
              </li>
              <li>
                <strong>Choose Audio:</strong> Click <strong>Use Audio</strong> on the input you want live.
              </li>
              <li>
                <strong>Go Live:</strong> Click <strong>Go Live</strong> to send the program stream to YouTube or Twitch.
              </li>
            </ol>
          </section>

          <section className="space-y-3">
            <h3 className="text-lg font-semibold text-aether-400 flex items-center gap-2">
              <Monitor size={20} /> Inputs and Switching
            </h3>
            <p className="text-sm text-gray-300">
              Use the <strong>Inputs</strong> panel to rename cameras, preview, and switch. Click <strong>Make Main</strong> to cut live.
              Hotkeys: <strong>1-9</strong> cut to sources, <strong>0</strong> triggers Emergency Wide.
            </p>
          </section>

          <section className="space-y-3">
            <h3 className="text-lg font-semibold text-aether-400 flex items-center gap-2">
              <Layers size={20} /> Composer Mode
            </h3>
            <p className="text-sm text-gray-300">
              Enable <strong>Composer Mode</strong> to show a main camera plus thumbnails. Click <strong>Apply</strong> for layout.
              Save or load a layout using <strong>Save Scene</strong> / <strong>Load Scene</strong>.
            </p>
          </section>

          <section className="space-y-3">
            <h3 className="text-lg font-semibold text-aether-400 flex items-center gap-2">
              <Mic size={20} /> Advanced Audio
            </h3>
            <p className="text-sm text-gray-300">
              <strong>Noise Cancellation:</strong> Click the Sparkles icon on the audio track to toggle AI noise removal.
              <br/>
              <strong>Mic Selection:</strong> On your phone, tap the Mic icon to switch microphones.
            </p>
          </section>

          <section className="space-y-3">
            <h3 className="text-lg font-semibold text-aether-400 flex items-center gap-2">
              <Layers size={20} /> Editing Layers
            </h3>
            <p className="text-sm text-gray-300">
              Select any layer on the canvas to move it. Use the <strong>Properties Panel</strong> on the right to crop, apply filters, change opacity, or edit text.
            </p>
          </section>

          <section className="space-y-3">
            <h3 className="text-lg font-semibold text-aether-400 flex items-center gap-2">
              <Radio size={20} /> Virtual Cable and Output
            </h3>
            <p className="text-sm text-gray-300">
              When you click <strong>Go Live</strong>, your mixed audio and video are piped to the streaming server via RTMP, acting as a direct line to platforms like YouTube or Twitch without needing OBS.
            </p>
          </section>

          <section className="space-y-3">
            <h3 className="text-lg font-semibold text-aether-400 flex items-center gap-2">
              <HelpCircle size={20} /> Troubleshooting
            </h3>
            <p className="text-sm text-gray-300">
              If a phone will not connect, re-open its QR from <strong>Phone Slots</strong>. If you see "ID is taken," click <strong>Reset Room</strong>.
              For local streaming, ensure the relay server is running and the stream key is correct.
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
