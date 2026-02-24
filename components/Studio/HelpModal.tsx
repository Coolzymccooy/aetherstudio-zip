import React, { useMemo, useState } from 'react';
import { X, Smartphone, Monitor, Zap, Layers, Mic, Settings, Radio, HelpCircle, Search, MessageSquare, Camera, Tv, ChevronRight, Volume2, Headphones } from 'lucide-react';

interface HelpModalProps {
  onClose: () => void;
}

export const HelpModal: React.FC<HelpModalProps> = ({ onClose }) => {
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState('quick-start');

  const faq = useMemo(() => ([
    {
      q: "How do I go live to YouTube or Twitch?",
      a: "Open Settings, paste your RTMP stream key, make sure Relay is Online, then click Go Live. Your stream is sent via the local relay and ffmpeg.",
      k: ["go live", "youtube", "twitch", "stream key", "relay", "ffmpeg", "rtmp"],
    },
    {
      q: "How do I add multiple cameras?",
      a: "Open the Inputs tab, then in Input Manager click 'Local' to add webcams or capture cards. Each camera appears as a numbered input you can rename and switch.",
      k: ["multiple", "cameras", "local", "add camera", "inputs", "webcam"],
    },
    {
      q: "How do I add multiple phones?",
      a: "In the Inputs tab, click 'Phone' in Input Manager to generate a new QR code for each phone slot (max 8). Scan the QR with your phone's camera to connect.",
      k: ["phones", "qr", "add phone", "multiple phones", "slot", "mobile"],
    },
    {
      q: "How do I switch the main camera?",
      a: "In Input Manager, click 'Main' on any source. You can also use keyboard shortcuts 1-9 to instantly cut to a source. The switch is instant — no fade.",
      k: ["switch", "main", "cut", "hotkey", "keyboard"],
    },
    {
      q: "What is Composer Mode?",
      a: "Composer Mode arranges your cameras into professional layouts. Choose from Main+Thumbs (big camera + small thumbnails), Split (50/50 side-by-side), PiP (main + small corner), or Grid (2x2). Toggle it on and click Apply.",
      k: ["composer", "layout", "thumbnails", "grid", "split", "pip", "side by side"],
    },
    {
      q: "How does Auto-Director work?",
      a: "Auto-Director automatically switches cameras on a timer. Choose Sequential (round-robin), Random, or Audio Reactive (picks the loudest camera). Set the interval in seconds and toggle it on. A countdown badge shows when the next switch happens.",
      k: ["auto", "director", "automatic", "timer", "sequential", "random", "audio reactive"],
    },
    {
      q: "How do I show Lower Thirds?",
      a: "In the Lower Thirds section, type a Speaker Name and Title. Toggle visibility on, or click 'Show 5s' for a timed display. Save your name/title combos as Presets for quick recall. Customize the accent color and duration.",
      k: ["lower third", "name", "title", "overlay", "preset", "accent"],
    },
    {
      q: "What transitions are available?",
      a: "Three types: Cut (instant), Fade to Black, and Dip to White. Set the speed with preset buttons (Fast 150ms, Medium 300ms, Slow 600ms) or enter a custom duration. Use 'Preview' to test. Transitions apply when using Cut To Next or Auto-Director.",
      k: ["transition", "fade", "cut", "dip", "white", "black", "speed"],
    },
    {
      q: "How do Scene Presets work?",
      a: "Save your current camera layout as a named preset. Choose a layout type, give it a name, and click Save. Load any preset to instantly restore that layout. You can also Duplicate presets for variations.",
      k: ["scene", "preset", "save", "load", "recall", "duplicate"],
    },
    {
      q: "What is Audience Studio?",
      a: "Audience Studio lets you display messages on screen. Pin a message, run a scrolling Ticker, or build a Message Queue that auto-rotates through multiple messages. Click 'Pin' on any queued message to promote it to the pinned display.",
      k: ["audience", "message", "ticker", "pin", "queue", "rotate"],
    },
    {
      q: "Why is my phone not connecting?",
      a: "Make sure the phone opened the QR link for the correct slot, the Peer server is reachable, the phone is on the same network (or has internet), and camera permission was granted. Try 'Show QR' again from Phone Slots.",
      k: ["phone", "not connecting", "peer", "permission", "qr"],
    },
    {
      q: "How does the Audio Mixer work?",
      a: "The Audio Mixer shows real-time audio levels for all connected inputs. Use the volume slider to adjust each track. Click the Sparkles icon to toggle AI Noise Cancellation. The master output meter (headphone icon) shows the combined audio level going to stream.",
      k: ["audio", "mixer", "volume", "noise", "cancellation", "level", "meter", "output"],
    },
    {
      q: "Camera goes dark or black screen?",
      a: "This was a known issue with transitions on Make Main. Make Main now switches instantly without any overlay. If you see darkness, click directly on the camera in the canvas. Also check that your transition mode is set to 'Cut' for instant switching.",
      k: ["dark", "black", "screen", "camera", "sleeping"],
    },
    {
      q: "How do I use a capture card or pro camera?",
      a: "Connect the capture card, then click 'Local' in Input Manager and select it from the camera list. It will appear as a standard video input you can rename and switch.",
      k: ["capture", "dslr", "pro camera", "hdmi", "card"],
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
    setAnswer("I'm not sure about that. Try asking about: cameras, phone QR, going live, composer mode, auto-director, lower thirds, transitions, presets, audience, or audio mixer.");
  };

  const sections = [
    { id: 'quick-start', label: 'Quick Start', icon: <Zap size={14} /> },
    { id: 'input-manager', label: 'Input Manager', icon: <Camera size={14} /> },
    { id: 'composer', label: 'Composer Mode', icon: <Layers size={14} /> },
    { id: 'auto-director', label: 'Auto-Director', icon: <Tv size={14} /> },
    { id: 'lower-thirds', label: 'Lower Thirds', icon: <MessageSquare size={14} /> },
    { id: 'transitions', label: 'Transitions', icon: <ChevronRight size={14} /> },
    { id: 'presets', label: 'Scene Presets', icon: <Settings size={14} /> },
    { id: 'audience', label: 'Audience Studio', icon: <Radio size={14} /> },
    { id: 'phone-slots', label: 'Phone Slots', icon: <Smartphone size={14} /> },
    { id: 'audio', label: 'Audio Mixer', icon: <Headphones size={14} /> },
    { id: 'troubleshooting', label: 'Troubleshooting', icon: <HelpCircle size={14} /> },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm animate-in fade-in">
      <div className="bg-aether-900 border border-aether-700 rounded-2xl w-[800px] shadow-2xl flex flex-col max-h-[90vh]">
        <div className="flex justify-between items-center p-5 border-b border-aether-700">
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <Zap className="text-aether-500" /> Aether Studio Guide
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
            <X size={24} />
          </button>
        </div>

        <div className="flex flex-1 min-h-0">
          {/* Sidebar Navigation */}
          <nav className="w-44 border-r border-aether-700 overflow-y-auto bg-aether-800/30 py-2 shrink-0">
            {sections.map(s => (
              <button key={s.id} onClick={() => setActiveSection(s.id)}
                className={`w-full text-left px-3 py-2 text-xs flex items-center gap-2 transition-colors ${activeSection === s.id ? 'bg-aether-700/50 text-white font-medium' : 'text-gray-400 hover:text-gray-200 hover:bg-aether-800/50'
                  }`}>
                {s.icon} {s.label}
              </button>
            ))}
          </nav>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-5 space-y-5">
            {/* Help Bot */}
            <section className="bg-aether-800/40 border border-aether-700 rounded-xl p-4 space-y-3">
              <div className="flex items-center gap-2 text-aether-300">
                <Search size={14} />
                <h3 className="text-xs font-bold">Search Help</h3>
              </div>
              <div className="flex gap-2">
                <input
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleAsk(); }}
                  placeholder="Ask anything: transitions, auto-director, phone..."
                  className="flex-1 bg-black/30 border border-aether-700 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-aether-500"
                />
                <button onClick={handleAsk} className="px-3 py-2 rounded-lg bg-aether-700 hover:bg-aether-600 text-white text-sm flex items-center gap-2">
                  <Search size={14} /> Ask
                </button>
              </div>
              {answer && (
                <div className="text-sm text-gray-300 bg-black/30 border border-aether-700 rounded-lg p-3">
                  {answer}
                </div>
              )}
            </section>

            {/* Quick Start */}
            {activeSection === 'quick-start' && (
              <section className="bg-gradient-to-r from-aether-900 to-aether-800 p-5 rounded-xl border border-aether-700/50 space-y-3">
                <h3 className="text-base font-bold text-white mb-3">Quick Start (End-to-End)</h3>
                <ol className="list-decimal list-inside space-y-3 text-sm text-gray-300">
                  <li><strong>Set Stream Key:</strong> Click ⚙ Settings and enter your RTMP key.</li>
                  <li><strong>Add Cameras:</strong> Open <strong>Inputs</strong> tab → Input Manager → <strong>Local</strong> for webcams, <strong>Phone</strong> for mobile cameras.</li>
                  <li><strong>Switch Cameras:</strong> Click <strong>Main</strong> on any source, or press <strong>1–9</strong> on your keyboard.</li>
                  <li><strong>Set Layout:</strong> Enable <strong>Composer Mode</strong> and choose Main+Thumbs, Split, PiP, or Grid.</li>
                  <li><strong>Add Overlays:</strong> Set up <strong>Lower Thirds</strong> for speaker names and <strong>Audience Studio</strong> for messages.</li>
                  <li><strong>Choose Transition:</strong> Pick Cut, Fade, or Dip to White in <strong>Transitions</strong>.</li>
                  <li><strong>Go Live:</strong> Click <strong>Go Live</strong> to stream to YouTube/Twitch.</li>
                </ol>
              </section>
            )}

            {/* Input Manager */}
            {activeSection === 'input-manager' && (
              <section className="space-y-4">
                <h3 className="text-base font-bold text-white flex items-center gap-2"><Camera size={18} className="text-aether-400" /> Input Manager</h3>
                <div className="space-y-3 text-sm text-gray-300">
                  <p>Manage all your camera sources from one place. Each camera gets a numbered badge (#1, #2, etc.) and a status indicator.</p>
                  <div className="bg-aether-800/40 rounded-lg p-3 space-y-2 border border-aether-700/50">
                    <p><strong className="text-white">Add Local:</strong> Opens camera selector for webcams and capture cards.</p>
                    <p><strong className="text-white">Add Phone:</strong> Creates a phone slot with QR code for mobile cameras.</p>
                    <p><strong className="text-white">Main:</strong> Instantly promotes a camera to full-screen (no fade).</p>
                    <p><strong className="text-white">Audio:</strong> Routes that camera's microphone to the stream.</p>
                    <p><strong className="text-white">Cut To Next:</strong> Switches to the next camera in sequence (uses your transition setting).</p>
                    <p><strong className="text-white">Emergency Wide:</strong> Instantly shows all cameras in a grid — useful when things go wrong.</p>
                  </div>
                  <p className="text-xs text-gray-500">💡 <strong>Keyboard shortcuts:</strong> Press <strong>1–9</strong> to cut to cameras, <strong>0</strong> for Emergency Wide.</p>
                </div>
              </section>
            )}

            {/* Composer Mode */}
            {activeSection === 'composer' && (
              <section className="space-y-4">
                <h3 className="text-base font-bold text-white flex items-center gap-2"><Layers size={18} className="text-aether-400" /> Composer Mode</h3>
                <div className="space-y-3 text-sm text-gray-300">
                  <p>Composer Mode arranges your cameras into professional broadcast layouts automatically.</p>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="bg-aether-800/40 rounded-lg p-3 border border-aether-700/50">
                      <p className="font-bold text-white mb-1">▣ Main + Thumbs</p>
                      <p className="text-xs">Big main camera with small thumbnails below. Classic broadcast look.</p>
                    </div>
                    <div className="bg-aether-800/40 rounded-lg p-3 border border-aether-700/50">
                      <p className="font-bold text-white mb-1">◫ Split (Side by Side)</p>
                      <p className="text-xs">Two cameras at 50/50 width. Great for interviews.</p>
                    </div>
                    <div className="bg-aether-800/40 rounded-lg p-3 border border-aether-700/50">
                      <p className="font-bold text-white mb-1">◲ PiP (Picture in Picture)</p>
                      <p className="text-xs">Main camera full-screen with a small corner inset.</p>
                    </div>
                    <div className="bg-aether-800/40 rounded-lg p-3 border border-aether-700/50">
                      <p className="font-bold text-white mb-1">⊞ 2x2 Grid</p>
                      <p className="text-xs">Four cameras in equal quadrants. Great for panels.</p>
                    </div>
                  </div>
                  <p className="text-xs text-gray-500">💡 Toggle Composer Mode on, select a layout, then click <strong>Apply Layout</strong>.</p>
                </div>
              </section>
            )}

            {/* Auto-Director */}
            {activeSection === 'auto-director' && (
              <section className="space-y-4">
                <h3 className="text-base font-bold text-white flex items-center gap-2"><Tv size={18} className="text-aether-400" /> Auto-Director</h3>
                <div className="space-y-3 text-sm text-gray-300">
                  <p>Let the system switch cameras automatically so you can focus on the content.</p>
                  <div className="bg-aether-800/40 rounded-lg p-3 space-y-2 border border-aether-700/50">
                    <p><strong className="text-white">Sequential:</strong> Rotates through cameras in order (1 → 2 → 3 → 1...).</p>
                    <p><strong className="text-white">Random:</strong> Picks a different camera randomly each time.</p>
                    <p><strong className="text-white">Audio Reactive:</strong> Automatically switches to whichever camera has the loudest audio — perfect for roundtable discussions.</p>
                  </div>
                  <p>Set the <strong>interval</strong> in seconds (minimum 3s). A countdown badge shows when the next switch will happen.</p>
                </div>
              </section>
            )}

            {/* Lower Thirds */}
            {activeSection === 'lower-thirds' && (
              <section className="space-y-4">
                <h3 className="text-base font-bold text-white flex items-center gap-2"><MessageSquare size={18} className="text-aether-400" /> Lower Thirds</h3>
                <div className="space-y-3 text-sm text-gray-300">
                  <p>Display speaker names and titles with a professional animated overlay.</p>
                  <div className="bg-aether-800/40 rounded-lg p-3 space-y-2 border border-aether-700/50">
                    <p><strong className="text-white">Speaker Name & Title:</strong> Enter the person's name and role. They appear as styled text with a background box and accent bar.</p>
                    <p><strong className="text-white">Toggle / Timed Show:</strong> Turn visibility on/off, or click "Show 5s" for an auto-dismiss display.</p>
                    <p><strong className="text-white">Duration:</strong> Choose 5, 8, 10, or 15 seconds for timed displays.</p>
                    <p><strong className="text-white">Accent Color:</strong> Pick a color for the left accent bar on the lower third.</p>
                    <p><strong className="text-white">Presets:</strong> Save name/title combos for quick recall (e.g., save each speaker ahead of time).</p>
                  </div>
                </div>
              </section>
            )}

            {/* Transitions */}
            {activeSection === 'transitions' && (
              <section className="space-y-4">
                <h3 className="text-base font-bold text-white flex items-center gap-2"><ChevronRight size={18} className="text-aether-400" /> Transitions</h3>
                <div className="space-y-3 text-sm text-gray-300">
                  <p>Control how camera switches look to the audience.</p>
                  <div className="bg-aether-800/40 rounded-lg p-3 space-y-2 border border-aether-700/50">
                    <p><strong className="text-white">Cut (Instant):</strong> Immediate switch, no animation. Default and safest option.</p>
                    <p><strong className="text-white">Fade to Black:</strong> Fades through black between cameras. Professional look.</p>
                    <p><strong className="text-white">Dip to White:</strong> Fades through white. Great for energetic or bright-themed shows.</p>
                  </div>
                  <p>Speed presets: <strong>Fast</strong> (150ms), <strong>Medium</strong> (300ms), <strong>Slow</strong> (600ms). Or enter a custom value.</p>
                  <p className="text-xs text-gray-500">💡 Transitions apply to <strong>Cut To Next</strong> and <strong>Auto-Director</strong> switches. Make Main is always instant.</p>
                </div>
              </section>
            )}

            {/* Scene Presets */}
            {activeSection === 'presets' && (
              <section className="space-y-4">
                <h3 className="text-base font-bold text-white flex items-center gap-2"><Settings size={18} className="text-aether-400" /> Scene Presets</h3>
                <div className="space-y-3 text-sm text-gray-300">
                  <p>Save and restore camera layouts. Great for switching between "interview mode" and "presentation mode" during a show.</p>
                  <div className="bg-aether-800/40 rounded-lg p-3 space-y-2 border border-aether-700/50">
                    <p><strong className="text-white">Save:</strong> Name your current layout and click Save. All camera positions are stored.</p>
                    <p><strong className="text-white">Load:</strong> Click Load to restore a saved layout (uses your current transition).</p>
                    <p><strong className="text-white">Duplicate:</strong> Creates a copy of a preset for variations.</p>
                  </div>
                </div>
              </section>
            )}

            {/* Audience Studio */}
            {activeSection === 'audience' && (
              <section className="space-y-4">
                <h3 className="text-base font-bold text-white flex items-center gap-2"><Radio size={18} className="text-aether-400" /> Audience Studio</h3>
                <div className="space-y-3 text-sm text-gray-300">
                  <p>Display messages and tickers on screen for your audience.</p>
                  <div className="bg-aether-800/40 rounded-lg p-3 space-y-2 border border-aether-700/50">
                    <p><strong className="text-white">Pinned Message:</strong> A static message displayed on screen. Toggle visibility with the switch.</p>
                    <p><strong className="text-white">Ticker:</strong> A scrolling marquee message at the bottom of the screen.</p>
                    <p><strong className="text-white">Message Queue:</strong> Add multiple messages and enable Auto-rotate to cycle through them automatically. Click "Pin" on any message to promote it to the pinned display.</p>
                  </div>
                </div>
              </section>
            )}

            {/* Phone Slots */}
            {activeSection === 'phone-slots' && (
              <section className="space-y-4">
                <h3 className="text-base font-bold text-white flex items-center gap-2"><Smartphone size={18} className="text-aether-400" /> Phone Slots</h3>
                <div className="space-y-3 text-sm text-gray-300">
                  <p>Connect up to 8 phones as wireless cameras using QR codes.</p>
                  <div className="bg-aether-800/40 rounded-lg p-3 space-y-2 border border-aether-700/50">
                    <p><strong className="text-white">QR:</strong> Opens a QR code to scan with the phone camera.</p>
                    <p><strong className="text-white">Link:</strong> Copies the connection URL to clipboard (share via messaging).</p>
                    <p><strong className="text-white">Status Badges:</strong> 🟢 Live = connected, 🟡 Pending = waiting for phone, 🔴 Error = connection lost.</p>
                    <p><strong className="text-white">Connection Duration:</strong> Shows how long each phone has been connected.</p>
                  </div>
                  <p className="text-xs text-gray-500">💡 Phone and computer must be on the same network, or both must have internet access for relay mode.</p>
                </div>
              </section>
            )}

            {/* Audio Mixer */}
            {activeSection === 'audio' && (
              <section className="space-y-4">
                <h3 className="text-base font-bold text-white flex items-center gap-2"><Headphones size={18} className="text-aether-400" /> Audio Mixer</h3>
                <div className="space-y-3 text-sm text-gray-300">
                  <p>Professional audio monitoring and control at the bottom of the screen.</p>
                  <div className="bg-aether-800/40 rounded-lg p-3 space-y-2 border border-aether-700/50">
                    <p><strong className="text-white">Level Meters:</strong> Real-time audio levels per track. Green = normal, Yellow = hot, Red = clipping.</p>
                    <p><strong className="text-white">Volume Slider:</strong> Drag to adjust the volume of each track.</p>
                    <p><strong className="text-white">Mute:</strong> Click the mic icon to mute/unmute.</p>
                    <p><strong className="text-white">AI Noise Cancellation:</strong> Click the ✨ sparkles icon to remove background noise.</p>
                    <p><strong className="text-white">Master Output:</strong> The headphone meter in the top-right shows combined output level going to stream.</p>
                  </div>
                </div>
              </section>
            )}

            {/* Troubleshooting */}
            {activeSection === 'troubleshooting' && (
              <section className="space-y-4">
                <h3 className="text-base font-bold text-white flex items-center gap-2"><HelpCircle size={18} className="text-aether-400" /> Troubleshooting</h3>
                <div className="space-y-3 text-sm text-gray-300">
                  <div className="bg-aether-800/40 rounded-lg p-3 space-y-3 border border-aether-700/50">
                    <div>
                      <p className="font-bold text-white">Camera goes dark / black screen</p>
                      <p className="text-xs">Make Main switches instantly. If the canvas looks dark, click on it. Check that Transition mode is set to "Cut" for instant switching.</p>
                    </div>
                    <div>
                      <p className="font-bold text-white">Phone won't connect</p>
                      <p className="text-xs">Re-open its QR from Phone Slots. Ensure the phone granted camera permission. Both devices must be on the same network or have internet.</p>
                    </div>
                    <div>
                      <p className="font-bold text-white">"ID is taken" error</p>
                      <p className="text-xs">Click Reset Room in Settings. This clears peer IDs and allows fresh connections.</p>
                    </div>
                    <div>
                      <p className="font-bold text-white">Stream won't start</p>
                      <p className="text-xs">Ensure the Relay server is running (green indicator). Check that the stream key is correct in Settings. Try Check Updates to get the latest Relay version.</p>
                    </div>
                    <div>
                      <p className="font-bold text-white">Audio is not coming through</p>
                      <p className="text-xs">Click "Audio" on the input you want live in Input Manager. Check the Audio Mixer at the bottom — make sure tracks are not muted and volume is above 0%.</p>
                    </div>
                  </div>
                </div>
              </section>
            )}
          </div>
        </div>

        <div className="p-4 border-t border-aether-700 bg-aether-800/30 text-center flex justify-between items-center">
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
