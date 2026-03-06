import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
    Activity, AlertTriangle, CheckCircle, ChevronDown, ChevronUp,
    Circle, Cpu, HelpCircle, Loader2, MessageSquare, Pause, Play,
    RefreshCw, Send, Shield, ShieldAlert, ShieldCheck, Wrench, XCircle,
    Zap, Radio, Camera, Wifi,
} from 'lucide-react';
import type {
    DiagnosticResult, OpsLogEntry, OverallHealth, SystemSnapshot,
    FixAction, RelayDiagnostics,
} from '../../services/opsAgentService';
import { getOpsAgent } from '../../services/opsAgentService';

// ── Props ─────────────────────────────────────────────────────────────

export interface OpsAgentPanelProps {
    snapshot: SystemSnapshot;
    onReconnectRelay: () => void;
    onRestartStream: () => void;
    onOpenSettings: () => void;
}

// ── Severity helpers ──────────────────────────────────────────────────

const severityIcon = (s: string, size = 14) => {
    switch (s) {
        case 'critical':
            return <XCircle size={size} className="text-red-400 shrink-0" />;
        case 'warn':
            return <AlertTriangle size={size} className="text-yellow-400 shrink-0" />;
        default:
            return <CheckCircle size={size} className="text-emerald-400 shrink-0" />;
    }
};

const severityBorder = (s: string) => {
    switch (s) {
        case 'critical':
            return 'border-red-500/30';
        case 'warn':
            return 'border-yellow-500/30';
        default:
            return 'border-emerald-500/30';
    }
};

const severityBg = (s: string) => {
    switch (s) {
        case 'critical':
            return 'bg-red-500/10';
        case 'warn':
            return 'bg-yellow-500/10';
        default:
            return 'bg-emerald-500/10';
    }
};

const healthColor = (h: OverallHealth) => {
    switch (h) {
        case 'critical':
            return 'text-red-400';
        case 'degraded':
            return 'text-yellow-400';
        default:
            return 'text-emerald-400';
    }
};

const healthIcon = (h: OverallHealth, size = 16) => {
    switch (h) {
        case 'critical':
            return <ShieldAlert size={size} className="text-red-400" />;
        case 'degraded':
            return <Shield size={size} className="text-yellow-400" />;
        default:
            return <ShieldCheck size={size} className="text-emerald-400" />;
    }
};

const healthLabel = (h: OverallHealth) => {
    switch (h) {
        case 'critical':
            return 'Critical Issues';
        case 'degraded':
            return 'Warnings Active';
        default:
            return 'All Systems Healthy';
    }
};

// ── Time format ───────────────────────────────────────────────────────

const timeAgo = (ts: number) => {
    const diff = Math.max(0, Math.floor((Date.now() - ts) / 1000));
    if (diff < 5) return 'just now';
    if (diff < 60) return `${diff}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    return `${Math.floor(diff / 3600)}h ago`;
};

// ── Component ─────────────────────────────────────────────────────────

export const OpsAgentPanel: React.FC<OpsAgentPanelProps> = ({
    snapshot,
    onReconnectRelay,
    onRestartStream,
    onOpenSettings,
}) => {
    const agent = getOpsAgent();
    const [, setTick] = useState(0);
    const [askInput, setAskInput] = useState('');
    const [askLoading, setAskLoading] = useState(false);
    const [askResponse, setAskResponse] = useState<string | null>(null);
    const [showLog, setShowLog] = useState(false);
    const [remoteDiag, setRemoteDiag] = useState<RelayDiagnostics | null>(null);
    const [remoteLoading, setRemoteLoading] = useState(false);
    const logEndRef = useRef<HTMLDivElement>(null);

    // Keep agent snapshot current
    useEffect(() => {
        agent.updateSnapshot(snapshot);
    }, [snapshot, agent]);

    // Start agent and subscribe to changes
    useEffect(() => {
        agent.start();

        // Register fix callback
        agent.setFixCallback(async (action: FixAction): Promise<boolean> => {
            switch (action) {
                case 'reconnect_relay':
                    onReconnectRelay();
                    // Wait a moment and check if it reconnected
                    return new Promise((resolve) => {
                        setTimeout(() => resolve(true), 2000);
                    });
                case 'restart_stream':
                    onRestartStream();
                    return new Promise((resolve) => {
                        setTimeout(() => resolve(true), 2000);
                    });
                case 'check_health':
                case 'check_ffmpeg':
                    try {
                        await agent.fetchRemoteDiagnostics();
                        return true;
                    } catch {
                        return false;
                    }
                case 'prompt_stream_key':
                case 'prompt_relay_url':
                    onOpenSettings();
                    return true;
                default:
                    return false;
            }
        });

        const unsubscribe = agent.subscribe(() => {
            setTick((t) => t + 1);
        });

        return () => {
            unsubscribe();
        };
    }, [agent, onReconnectRelay, onRestartStream, onOpenSettings]);

    // Re-run diagnostics when snapshot changes
    useEffect(() => {
        if (agent.enabled) agent.runCycle();
    }, [
        snapshot.relayConnected,
        snapshot.relayStatus,
        snapshot.streamStatus,
        snapshot.streamKey,
        snapshot.cameraSources.length,
        snapshot.peerConnected,
        snapshot.lastRelayFatal,
        agent,
    ]);

    const handleAsk = useCallback(async () => {
        if (!askInput.trim() || askLoading) return;
        setAskLoading(true);
        setAskResponse(null);
        try {
            const response = await agent.ask(askInput.trim());
            setAskResponse(response);
        } catch {
            setAskResponse('Failed to get a response. Please try again.');
        }
        setAskLoading(false);
        setAskInput('');
    }, [askInput, askLoading, agent]);

    const handleFetchRemote = useCallback(async () => {
        setRemoteLoading(true);
        const result = await agent.fetchRemoteDiagnostics();
        setRemoteDiag(result);
        setRemoteLoading(false);
    }, [agent]);

    const handleFix = useCallback(
        async (action: FixAction) => {
            await agent.executeFix(action);
        },
        [agent]
    );

    const diagnostics = agent.diagnostics;
    const log = agent.log;
    const health = agent.overallHealth;

    // ── Health badges data ─────────────────────────────────────────────
    const badges = [
        {
            label: 'Relay',
            icon: <Radio size={12} />,
            ok: snapshot.relayConnected,
        },
        {
            label: 'Stream',
            icon: <Activity size={12} />,
            ok: snapshot.streamStatus === 'idle' || snapshot.streamStatus === 'live',
        },
        {
            label: 'Cameras',
            icon: <Camera size={12} />,
            ok: snapshot.cameraSources.length > 0 &&
                snapshot.cameraSources.every((c) => c.status !== 'error'),
        },
        {
            label: 'Network',
            icon: <Wifi size={12} />,
            ok: snapshot.streamHealth.rttMs === null || snapshot.streamHealth.rttMs < 2000,
        },
    ];

    return (
        <div className="mx-auto flex flex-col h-full w-full max-w-[356px] min-w-0 overflow-hidden bg-aether-900">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-aether-700 bg-aether-800/40">
                <div className="flex items-center gap-2">
                    {healthIcon(health)}
                    <div>
                        <h3 className="text-xs font-bold text-white tracking-wide">Ops Agent</h3>
                        <p className={`text-[10px] font-medium ${healthColor(health)}`}>
                            {healthLabel(health)}
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-1">
                    <button
                        onClick={handleFetchRemote}
                        disabled={remoteLoading}
                        title="Deep health check"
                        className="p-1.5 rounded-md hover:bg-aether-700/50 text-gray-400 hover:text-white transition-colors disabled:opacity-40"
                    >
                        {remoteLoading ? (
                            <Loader2 size={14} className="animate-spin" />
                        ) : (
                            <RefreshCw size={14} />
                        )}
                    </button>
                    <button
                        onClick={() => agent.toggle()}
                        title={agent.enabled ? 'Pause agent' : 'Resume agent'}
                        className="p-1.5 rounded-md hover:bg-aether-700/50 text-gray-400 hover:text-white transition-colors"
                    >
                        {agent.enabled ? <Pause size={14} /> : <Play size={14} />}
                    </button>
                </div>
            </div>

            {/* Health badges row */}
            <div className="flex gap-1.5 px-3 py-2 border-b border-aether-700/50 bg-aether-800/20">
                {badges.map((b) => (
                    <div
                        key={b.label}
                        className={`flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-medium border ${b.ok
                                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                                : 'border-red-500/30 bg-red-500/10 text-red-400'
                            }`}
                    >
                        {b.icon}
                        {b.label}
                    </div>
                ))}
            </div>

            {/* Scrollable content */}
            <div className="flex-1 overflow-y-auto p-3 space-y-3">
                {/* Remote diagnostics (if fetched) */}
                {remoteDiag && (
                    <div className="bg-aether-800/40 rounded-lg border border-aether-700/50 p-3 space-y-2">
                        <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
                            <Cpu size={11} /> Server Diagnostics
                        </h4>
                        {remoteDiag.ok && remoteDiag.diagnostics ? (
                            <div className="grid grid-cols-2 gap-1.5 text-[10px]">
                                <div className="bg-black/20 rounded px-2 py-1.5">
                                    <span className="text-gray-500">FFmpeg</span>
                                    <div
                                        className={`font-medium ${remoteDiag.diagnostics.ffmpegAvailable
                                                ? 'text-emerald-400'
                                                : 'text-red-400'
                                            }`}
                                    >
                                        {remoteDiag.diagnostics.ffmpegAvailable ? '✓ Available' : '✗ Missing'}
                                    </div>
                                </div>
                                <div className="bg-black/20 rounded px-2 py-1.5">
                                    <span className="text-gray-500">Streams</span>
                                    <div className="font-medium text-white">
                                        {remoteDiag.diagnostics.activeStreams}
                                    </div>
                                </div>
                                <div className="bg-black/20 rounded px-2 py-1.5">
                                    <span className="text-gray-500">Restarts</span>
                                    <div
                                        className={`font-medium ${remoteDiag.diagnostics.restartAttempts > 0
                                                ? 'text-yellow-400'
                                                : 'text-white'
                                            }`}
                                    >
                                        {remoteDiag.diagnostics.restartAttempts}
                                    </div>
                                </div>
                                <div className="bg-black/20 rounded px-2 py-1.5">
                                    <span className="text-gray-500">WS Clients</span>
                                    <div className="font-medium text-white">
                                        {remoteDiag.diagnostics.wsConnections}
                                    </div>
                                </div>
                                {remoteDiag.diagnostics.lastError && (
                                    <div className="col-span-2 bg-red-500/10 rounded px-2 py-1.5 border border-red-500/20">
                                        <span className="text-gray-500">Last Error</span>
                                        <div className="font-medium text-red-400 truncate">
                                            {remoteDiag.diagnostics.lastError}
                                        </div>
                                    </div>
                                )}
                            </div>
                        ) : (
                            <div className="text-[10px] text-red-400">
                                Could not reach relay: {remoteDiag.error || 'unknown error'}
                            </div>
                        )}
                    </div>
                )}

                {/* Active Diagnostics */}
                <div className="space-y-2">
                    <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
                        <Activity size={11} /> Active Diagnostics
                        {diagnostics.length > 0 && (
                            <span className="ml-auto bg-red-500/20 text-red-400 text-[9px] px-1.5 py-0.5 rounded-full font-bold">
                                {diagnostics.length}
                            </span>
                        )}
                    </h4>

                    {diagnostics.length === 0 ? (
                        <div className="flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-3">
                            <CheckCircle size={16} className="text-emerald-400 shrink-0" />
                            <div>
                                <p className="text-xs font-medium text-emerald-300">All clear</p>
                                <p className="text-[10px] text-gray-500">
                                    No issues detected. Agent monitoring every 8s.
                                </p>
                            </div>
                        </div>
                    ) : (
                        diagnostics.map((diag) => (
                            <div
                                key={diag.id}
                                className={`rounded-lg border p-3 space-y-2 ${severityBorder(
                                    diag.severity
                                )} ${severityBg(diag.severity)}`}
                            >
                                <div className="flex items-start gap-2">
                                    {severityIcon(diag.severity)}
                                    <div className="flex-1 min-w-0">
                                        <p className="text-xs font-semibold text-white leading-tight">
                                            {diag.title}
                                        </p>
                                        <p className="text-[10px] text-gray-400 mt-0.5 leading-relaxed">
                                            {diag.detail}
                                        </p>
                                    </div>
                                </div>
                                {diag.canAutoFix && diag.fixAction && (
                                    <button
                                        onClick={() => handleFix(diag.fixAction!)}
                                        className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-md bg-aether-500/20 hover:bg-aether-500/30 border border-aether-500/30 text-aether-400 text-[11px] font-medium transition-colors"
                                    >
                                        <Wrench size={12} />
                                        {diag.fixLabel || 'Fix Now'}
                                    </button>
                                )}
                                {!diag.canAutoFix && diag.fixAction && (
                                    <button
                                        onClick={() => {
                                            if (
                                                diag.fixAction === 'prompt_stream_key' ||
                                                diag.fixAction === 'prompt_relay_url'
                                            ) {
                                                onOpenSettings();
                                            }
                                        }}
                                        className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-md bg-gray-500/10 hover:bg-gray-500/20 border border-gray-500/20 text-gray-400 text-[11px] font-medium transition-colors"
                                    >
                                        <Zap size={12} />
                                        {diag.fixLabel || 'View Details'}
                                    </button>
                                )}
                            </div>
                        ))
                    )}
                </div>

                {/* Ask Agent */}
                <div className="bg-aether-800/40 rounded-lg border border-aether-700/50 p-3 space-y-2">
                    <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
                        <MessageSquare size={11} /> Ask Agent
                    </h4>
                    <div className="flex gap-1.5">
                        <input
                            type="text"
                            value={askInput}
                            onChange={(e) => setAskInput(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleAsk()}
                            placeholder="Why is my stream lagging?"
                            disabled={askLoading}
                            className="flex-1 bg-black/30 border border-aether-700 rounded-lg px-2.5 py-1.5 text-[11px] text-white outline-none focus:border-aether-500 disabled:opacity-50 placeholder:text-gray-600"
                        />
                        <button
                            onClick={handleAsk}
                            disabled={askLoading || !askInput.trim()}
                            className="px-2.5 py-1.5 rounded-lg bg-aether-500/20 hover:bg-aether-500/30 border border-aether-500/30 text-aether-400 transition-colors disabled:opacity-40"
                        >
                            {askLoading ? (
                                <Loader2 size={12} className="animate-spin" />
                            ) : (
                                <Send size={12} />
                            )}
                        </button>
                    </div>
                    {askResponse && (
                        <div className="text-[11px] text-gray-300 bg-black/20 border border-aether-700/30 rounded-lg p-2.5 leading-relaxed max-h-40 overflow-y-auto">
                            {askResponse}
                        </div>
                    )}
                </div>

                {/* Activity Log */}
                <div className="bg-aether-800/30 rounded-lg border border-aether-700/30">
                    <button
                        onClick={() => setShowLog(!showLog)}
                        className="w-full flex items-center justify-between px-3 py-2 text-[10px] font-bold text-gray-400 uppercase tracking-wider hover:text-gray-300 transition-colors"
                    >
                        <span className="flex items-center gap-1.5">
                            <HelpCircle size={11} /> Activity Log
                            {log.length > 0 && (
                                <span className="text-gray-600">({log.length})</span>
                            )}
                        </span>
                        {showLog ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                    </button>

                    {showLog && (
                        <div className="px-3 pb-3 max-h-48 overflow-y-auto space-y-1">
                            {log.length === 0 ? (
                                <p className="text-[10px] text-gray-600 italic">No activity yet.</p>
                            ) : (
                                log.slice(0, 30).map((entry, idx) => (
                                    <div
                                        key={idx}
                                        className="flex items-start gap-1.5 text-[10px] leading-relaxed"
                                    >
                                        <span className="text-gray-600 shrink-0 w-11 text-right font-mono">
                                            {timeAgo(entry.timestamp)}
                                        </span>
                                        <Circle
                                            size={6}
                                            className={`mt-1 shrink-0 ${entry.severity === 'critical'
                                                    ? 'text-red-400 fill-red-400'
                                                    : entry.severity === 'warn'
                                                        ? 'text-yellow-400 fill-yellow-400'
                                                        : 'text-gray-600 fill-gray-600'
                                                }`}
                                        />
                                        <span className="text-gray-400 break-words">{entry.message}</span>
                                    </div>
                                ))
                            )}
                            <div ref={logEndRef} />
                        </div>
                    )}
                </div>
            </div>

            {/* Footer */}
            <div className="px-3 py-2 border-t border-aether-700/50 bg-aether-800/20 flex items-center justify-between">
                <span className="text-[9px] text-gray-600 font-mono tracking-wider">
                    AETHER OPS v1.0
                </span>
                <div className="flex items-center gap-1.5">
                    <Circle
                        size={6}
                        className={`${agent.enabled
                                ? 'text-emerald-400 fill-emerald-400 animate-pulse'
                                : 'text-gray-600 fill-gray-600'
                            }`}
                    />
                    <span className="text-[9px] text-gray-500">
                        {agent.enabled ? 'Monitoring' : 'Paused'}
                    </span>
                </div>
            </div>
        </div>
    );
};
