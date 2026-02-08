import React, { useEffect, useState } from 'react';
import { Bot, Image as ImageIcon, Send, Sparkles, Loader2, Key } from 'lucide-react';
import { askStudioAssistant, generateStudioBackground, ensureImageGenApiKey, checkAiAvailability } from '../../services/geminiService';

interface AIPanelProps {
  onAddLayer: (src: string, type: 'IMAGE') => void;
}

export const AIPanel: React.FC<AIPanelProps> = ({ onAddLayer }) => {
  const [activeTab, setActiveTab] = useState<'chat' | 'generate'>('generate');
  const [prompt, setPrompt] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aiAvailable, setAiAvailable] = useState<boolean | null>(null);
  const [chatHistory, setChatHistory] = useState<{role: 'user' | 'ai', text: string}[]>([]);

  useEffect(() => {
    checkAiAvailability().then(setAiAvailable).catch(() => setAiAvailable(false));
  }, []);

  const ensureAiAvailable = async () => {
    if (aiAvailable === true) return true;
    const ok = await checkAiAvailability().catch(() => false);
    setAiAvailable(ok);
    return ok;
  };

  const handleGenerateImage = async () => {
    if (!prompt.trim()) return;
    setError(null);
    setIsLoading(true);

    try {
      const ok = await ensureAiAvailable();
      if (!ok) {
        setError("AI backend not available. Please start your AI server or configure VITE_AI_BASE_URL.");
        setIsLoading(false);
        return;
      }

      const hasKey = await ensureImageGenApiKey();
      if (!hasKey) {
        setError("API Key selection was cancelled or failed.");
        setIsLoading(false);
        return;
      }

      const result = await generateStudioBackground(prompt);
      if (result) {
        onAddLayer(result, 'IMAGE');
        setPrompt('');
      } else {
        setError("Failed to generate image. Please try a different prompt.");
      }
    } catch (e: any) {
      const msg = String(e?.message || '');
      if (msg.includes('AI base URL not configured') || msg.includes('Failed to fetch')) {
        setError("AI backend not available. Please start your AI server or configure VITE_AI_BASE_URL.");
      } else if (msg.includes('403') || msg.toLowerCase().includes('permission denied')) {
        setError("Permission denied. You may need to select a paid project API Key.");
      } else {
        setError("An unexpected error occurred during generation.");
      }
    }
    setIsLoading(false);
  };

  const handleChat = async () => {
    if (!prompt.trim()) return;
    const userMsg = prompt;
    setPrompt('');
    setChatHistory(prev => [...prev, { role: 'user', text: userMsg }]);
    
    setIsLoading(true);
    const ok = await ensureAiAvailable();
    if (!ok) {
      setChatHistory(prev => [...prev, { role: 'ai', text: "AI backend not available. Please start your AI server or configure VITE_AI_BASE_URL." }]);
      setIsLoading(false);
      return;
    }
    const response = await askStudioAssistant(userMsg);
    setChatHistory(prev => [...prev, { role: 'ai', text: response }]);
    setIsLoading(false);
  };

  return (
    <div className="flex flex-col h-full bg-aether-900 border-l border-aether-700 w-80">
      <div className="flex border-b border-aether-700">
        <button
          onClick={() => setActiveTab('generate')}
          className={`flex-1 py-3 text-sm font-medium flex items-center justify-center gap-2 ${activeTab === 'generate' ? 'bg-aether-800 text-aether-400 border-b-2 border-aether-500' : 'text-gray-500 hover:text-gray-300'}`}
        >
          <Sparkles size={16} /> Assets
        </button>
        <button
          onClick={() => setActiveTab('chat')}
          className={`flex-1 py-3 text-sm font-medium flex items-center justify-center gap-2 ${activeTab === 'chat' ? 'bg-aether-800 text-aether-400 border-b-2 border-aether-500' : 'text-gray-500 hover:text-gray-300'}`}
        >
          <Bot size={16} /> Assistant
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {activeTab === 'generate' ? (
          <div className="space-y-6">
            <div className="bg-aether-800/50 p-4 rounded-lg border border-aether-700/50">
              <h3 className="text-sm font-semibold text-gray-200 mb-2">Generative Backgrounds</h3>
              <p className="text-xs text-gray-400 mb-4">Use Gemini to create unique, royalty-free backgrounds for your stream. <strong>Requires paid project key.</strong></p>

              {aiAvailable === false && (
                <div className="mb-3 text-xs text-yellow-300 bg-yellow-500/10 p-2 rounded border border-yellow-500/20">
                  AI backend not available. Please start your AI server or configure VITE_AI_BASE_URL.
                </div>
              )}
              
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="E.g., Neon cyberpunk city street at night, rainy, highly detailed..."
                className="w-full bg-aether-900 border border-aether-700 rounded-md p-2 text-sm text-gray-200 focus:outline-none focus:border-aether-500 h-24 resize-none"
              />
              
              {error && (
                <div className="mt-2 text-xs text-red-400 bg-red-500/10 p-2 rounded border border-red-500/20">
                  {error}
                </div>
              )}

              <button
                onClick={handleGenerateImage}
                disabled={isLoading || aiAvailable === false}
                className="mt-3 w-full bg-aether-500 hover:bg-aether-600 text-white py-2 rounded-md text-sm font-medium flex items-center justify-center gap-2 transition-all"
              >
                {isLoading ? <Loader2 className="animate-spin" size={16} /> : <Sparkles size={16} />}
                Generate & Add
              </button>
            </div>
            
            <div className="bg-aether-800/30 p-4 rounded-lg border border-aether-700/30">
               <h4 className="text-xs font-semibold text-gray-400 uppercase mb-2">Hints</h4>
               <ul className="text-xs text-gray-500 space-y-1 list-disc list-inside">
                  <li>Try "Cozy loft with brick walls"</li>
                  <li>Try "Futuristic news anchor desk"</li>
                  <li>Try "Abstract purple motion blur"</li>
               </ul>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {aiAvailable === false && (
              <div className="text-xs text-yellow-300 bg-yellow-500/10 p-2 rounded border border-yellow-500/20">
                AI backend not available. Please start your AI server or configure VITE_AI_BASE_URL.
              </div>
            )}
            {chatHistory.length === 0 && (
              <div className="text-center text-gray-500 text-xs mt-10">
                Ask me about streaming setups, OBS tips, or engaging your audience.
              </div>
            )}
            {chatHistory.map((msg, idx) => (
              <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] rounded-lg p-3 text-sm ${msg.role === 'user' ? 'bg-aether-500 text-white' : 'bg-aether-800 text-gray-200'}`}>
                  {msg.text}
                </div>
              </div>
            ))}
            {isLoading && (
               <div className="flex justify-start">
                  <div className="bg-aether-800 rounded-lg p-3">
                     <Loader2 className="animate-spin text-aether-400" size={16} />
                  </div>
               </div>
            )}
          </div>
        )}
      </div>

      {activeTab === 'chat' && (
        <div className="p-4 border-t border-aether-700 bg-aether-800">
          <div className="relative">
            <input
              type="text"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleChat()}
              placeholder="Ask Aether..."
              disabled={aiAvailable === false}
              className="w-full bg-aether-900 border border-aether-700 rounded-full py-2 px-4 pr-10 text-sm text-gray-200 focus:outline-none focus:border-aether-500 disabled:opacity-60"
            />
            <button 
              onClick={handleChat}
              disabled={aiAvailable === false}
              className="absolute right-2 top-1.5 text-aether-500 hover:text-aether-400 disabled:opacity-60"
            >
              <Send size={16} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
