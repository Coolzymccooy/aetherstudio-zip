import React, { useEffect, useMemo, useState } from 'react';
import { Bot, Send, Sparkles, Loader2, Activity } from 'lucide-react';
import {
  askStudioAssistant,
  checkAiAvailability,
  ensureImageGenApiKey,
  formatAiHealthMessage,
  generateStudioBackground,
  type AiHealthStatus,
} from '../../services/geminiService';

interface AIPanelProps {
  onAddLayer: (src: string, type: 'IMAGE') => void;
}

const FALLBACK_AI_STATUS: AiHealthStatus = {
  ok: false,
  reason: 'missing_base_url',
  baseUrl: '',
  isLocal: true,
};

export const AIPanel: React.FC<AIPanelProps> = ({ onAddLayer }) => {
  const [activeTab, setActiveTab] = useState<'chat' | 'generate'>('generate');
  const [prompt, setPrompt] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aiHealth, setAiHealth] = useState<AiHealthStatus | null>(null);
  const [chatHistory, setChatHistory] = useState<{ role: 'user' | 'ai'; text: string }[]>([]);

  const refreshAiHealth = async () => {
    const result = await checkAiAvailability().catch(() => FALLBACK_AI_STATUS);
    setAiHealth(result);
    return result;
  };

  useEffect(() => {
    refreshAiHealth();
  }, []);

  const aiStatusText = useMemo(
    () => (aiHealth ? formatAiHealthMessage(aiHealth) : 'Checking local AI health...'),
    [aiHealth]
  );
  const aiAvailable = aiHealth?.ok === true;

  const ensureAiAvailable = async () => {
    if (aiHealth?.ok) return aiHealth;
    return refreshAiHealth();
  };

  const handleGenerateImage = async () => {
    if (!prompt.trim()) return;
    setError(null);
    setIsLoading(true);

    try {
      const status = await ensureAiAvailable();
      if (!status.ok) {
        setError(formatAiHealthMessage(status));
        setIsLoading(false);
        return;
      }

      const hasKey = await ensureImageGenApiKey();
      if (!hasKey) {
        setError('API Key selection was cancelled or failed.');
        setIsLoading(false);
        return;
      }

      const result = await generateStudioBackground(prompt);
      if (result) {
        onAddLayer(result, 'IMAGE');
        setPrompt('');
      } else {
        setError('Failed to generate image. Please try a different prompt.');
      }
    } catch (e: any) {
      const msg = String(e?.message || '');
      if (msg.includes('missing_gemini_api_key')) {
        setError('Local AI relay is running, but GEMINI_API_KEY is missing.');
      } else if (msg.includes('AI base URL not configured') || msg.includes('Failed to fetch')) {
        setError('AI relay is not reachable from this app.');
      } else if (msg.includes('403') || msg.toLowerCase().includes('permission denied')) {
        setError('Permission denied. You may need to use a paid Gemini project key on the relay.');
      } else if (msg) {
        setError(`AI error: ${msg}`);
      } else {
        setError('An unexpected error occurred during generation.');
      }
    }
    setIsLoading(false);
  };

  const handleChat = async () => {
    if (!prompt.trim()) return;
    const userMsg = prompt;
    setPrompt('');
    setChatHistory((prev) => [...prev, { role: 'user', text: userMsg }]);

    setIsLoading(true);
    const status = await ensureAiAvailable();
    if (!status.ok) {
      setChatHistory((prev) => [...prev, { role: 'ai', text: formatAiHealthMessage(status) }]);
      setIsLoading(false);
      return;
    }
    const response = await askStudioAssistant(userMsg);
    setChatHistory((prev) => [...prev, { role: 'ai', text: response }]);
    setIsLoading(false);
  };

  const statusTone = aiAvailable
    ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200'
    : 'border-amber-500/20 bg-amber-500/10 text-amber-200';

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-[356px] min-w-0 overflow-hidden flex-col bg-aether-900">
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

      <div className="border-b border-aether-700/80 bg-[#07111d] px-4 py-3">
        <div className={`rounded-xl border px-3 py-2 text-xs ${statusTone}`}>
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 font-semibold uppercase tracking-[0.18em]">
              <Activity size={13} />
              <span>{aiAvailable ? 'AI Ready' : 'AI Health'}</span>
            </div>
            <button
              onClick={() => void refreshAiHealth()}
              className="rounded-md border border-white/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/80 hover:bg-white/5"
            >
              Refresh
            </button>
          </div>
          <div className="mt-2 text-[11px] leading-relaxed">{aiStatusText}</div>
          {aiHealth?.baseUrl && (
            <div className="mt-2 font-mono text-[10px] text-white/65">{aiHealth.baseUrl}</div>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {activeTab === 'generate' ? (
          <div className="space-y-6">
            <div className="rounded-xl border border-aether-700/60 bg-aether-800/40 p-4">
              <h3 className="mb-2 text-sm font-semibold text-gray-200">Generative Backgrounds</h3>
              <p className="mb-4 text-xs text-gray-400">Use Gemini to create stream backgrounds. The relay must expose AI routes and have a Gemini key.</p>

              {!aiAvailable && (
                <div className="mb-3 rounded border border-amber-500/20 bg-amber-500/10 p-2 text-xs text-amber-200">
                  {aiStatusText}
                </div>
              )}

              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="E.g., Neon cyberpunk city street at night, rainy, highly detailed..."
                className="h-24 w-full resize-none rounded-md border border-aether-700 bg-aether-900 p-2 text-sm text-gray-200 focus:border-aether-500 focus:outline-none"
              />

              {error && (
                <div className="mt-2 rounded border border-red-500/20 bg-red-500/10 p-2 text-xs text-red-300">
                  {error}
                </div>
              )}

              <button
                onClick={handleGenerateImage}
                disabled={isLoading || !aiAvailable}
                className="mt-3 flex w-full items-center justify-center gap-2 rounded-md bg-aether-500 py-2 text-sm font-medium text-white transition-all hover:bg-aether-600 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isLoading ? <Loader2 className="animate-spin" size={16} /> : <Sparkles size={16} />}
                Generate & Add
              </button>
            </div>

            <div className="rounded-xl border border-aether-700/40 bg-aether-800/20 p-4">
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-gray-400">Hints</h4>
              <ul className="list-inside list-disc space-y-1 text-xs text-gray-500">
                <li>Try "Cozy loft with brick walls"</li>
                <li>Try "Futuristic news anchor desk"</li>
                <li>Try "Abstract teal motion blur"</li>
              </ul>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {!aiAvailable && (
              <div className="rounded border border-amber-500/20 bg-amber-500/10 p-2 text-xs text-amber-200">
                {aiStatusText}
              </div>
            )}
            {chatHistory.length === 0 && (
              <div className="mt-10 text-center text-xs text-gray-500">
                Ask about streaming setup, relay issues, or live production workflow.
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
                <div className="rounded-lg bg-aether-800 p-3">
                  <Loader2 className="animate-spin text-aether-400" size={16} />
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {activeTab === 'chat' && (
        <div className="border-t border-aether-700 bg-aether-800 p-4">
          <div className="relative">
            <input
              type="text"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleChat()}
              placeholder="Ask Aether..."
              disabled={!aiAvailable}
              className="w-full rounded-full border border-aether-700 bg-aether-900 py-2 px-4 pr-10 text-sm text-gray-200 focus:border-aether-500 focus:outline-none disabled:opacity-60"
            />
            <button
              onClick={handleChat}
              disabled={!aiAvailable}
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
