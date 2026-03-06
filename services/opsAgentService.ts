// ── Aether Ops Agent Service ──────────────────────────────────────────
// Rules-based diagnostic engine that monitors system health and
// applies safe automated remediations.  No LLM on the hot path.

import { checkAiAvailability, askStudioAssistant } from './geminiService';

// ── Types ─────────────────────────────────────────────────────────────

export interface SystemSnapshot {
    relayConnected: boolean;
    relayStatus: string | null;
    streamHealth: { kbps: number; drops: number; rttMs: number | null; queueKb: number };
    streamStatus: string; // 'idle' | 'starting' | 'live' | 'stopping'
    streamKey: string;
    cameraSources: { id: string; status: string; kind: string; label: string }[];
    peerConnected: boolean;
    wsUrl: string;
    lastRelayFatal: string | null;
}

export type DiagSeverity = 'info' | 'warn' | 'critical';
export type DiagCategory = 'relay' | 'stream' | 'camera' | 'peer' | 'config';
export type FixAction =
    | 'reconnect_relay'
    | 'restart_stream'
    | 'check_health'
    | 'check_ffmpeg'
    | 'prompt_stream_key'
    | 'prompt_relay_url'
    | 'suggest_quality_down'
    | 'suggest_add_camera';

export interface DiagnosticResult {
    id: string;
    severity: DiagSeverity;
    category: DiagCategory;
    title: string;
    detail: string;
    canAutoFix: boolean;
    fixAction?: FixAction;
    fixLabel?: string;
    timestamp: number;
}

export interface OpsLogEntry {
    timestamp: number;
    type: 'diagnosis' | 'fix_attempt' | 'fix_result' | 'user_ask' | 'agent_reply';
    message: string;
    severity?: DiagSeverity;
}

export type OverallHealth = 'healthy' | 'degraded' | 'critical';

export interface RelayDiagnostics {
    ok: boolean;
    diagnostics?: {
        ffmpegAvailable: boolean;
        ffmpegVersion: string;
        activeStreams: number;
        restartAttempts: number;
        lastError: string | null;
        wsConnections: number;
        uptimeSeconds: number;
    };
    error?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────

let idCounter = 0;
const nextId = () => `diag_${Date.now()}_${++idCounter}`;

const getHttpBaseFromWsUrl = (wsUrl: string): string => {
    if (!wsUrl) return '';
    return wsUrl
        .replace(/^wss:\/\//i, 'https://')
        .replace(/^ws:\/\//i, 'http://')
        .replace(/\/ws\/?$/, '')
        .replace(/\/+$/, '');
};

// ── Diagnostic Rules ──────────────────────────────────────────────────

export function runDiagnostics(snapshot: SystemSnapshot): DiagnosticResult[] {
    const results: DiagnosticResult[] = [];
    const now = Date.now();

    // Rule 1: Relay URL not configured
    if (!snapshot.wsUrl || snapshot.wsUrl.trim() === '') {
        results.push({
            id: nextId(),
            severity: 'critical',
            category: 'config',
            title: 'Relay URL not configured',
            detail:
                'No relay WebSocket URL is set. The studio cannot stream without a relay. Please configure VITE_SIGNAL_URL or set the relay URL in Settings.',
            canAutoFix: false,
            fixAction: 'prompt_relay_url',
            fixLabel: 'Open Settings',
            timestamp: now,
        });
    }

    // Rule 2: Relay disconnected (but URL is configured)
    if (snapshot.wsUrl && !snapshot.relayConnected) {
        results.push({
            id: nextId(),
            severity: 'critical',
            category: 'relay',
            title: 'Relay offline',
            detail: `Relay at ${snapshot.wsUrl} is disconnected. Status: ${snapshot.relayStatus || 'unknown'}. The agent can attempt to reconnect.`,
            canAutoFix: true,
            fixAction: 'reconnect_relay',
            fixLabel: 'Reconnect Relay',
            timestamp: now,
        });
    }

    // Rule 3: Relay fatal error (max restart exceeded, etc.)
    if (
        snapshot.lastRelayFatal ||
        (snapshot.relayStatus && /fatal|max_restart/i.test(snapshot.relayStatus))
    ) {
        results.push({
            id: nextId(),
            severity: 'critical',
            category: 'relay',
            title: 'Relay fatal error',
            detail: `Relay encountered a fatal error: ${snapshot.lastRelayFatal || snapshot.relayStatus}. The agent can attempt to restart the stream after reconnecting.`,
            canAutoFix: true,
            fixAction: 'restart_stream',
            fixLabel: 'Restart Stream',
            timestamp: now,
        });
    }

    // Rule 4: High latency (RTT > 2000ms)
    if (snapshot.streamHealth.rttMs !== null && snapshot.streamHealth.rttMs > 2000) {
        results.push({
            id: nextId(),
            severity: 'warn',
            category: 'stream',
            title: 'High relay latency',
            detail: `Round-trip time to relay is ${snapshot.streamHealth.rttMs}ms (above 2000ms threshold). Consider reducing stream quality or checking your network connection.`,
            canAutoFix: false,
            fixAction: 'suggest_quality_down',
            fixLabel: 'Reduce Quality',
            timestamp: now,
        });
    }

    // Rule 5: Queue congestion
    if (snapshot.streamHealth.queueKb > 1500) {
        results.push({
            id: nextId(),
            severity: 'warn',
            category: 'stream',
            title: 'Relay congestion detected',
            detail: `Relay ingest queue is at ${snapshot.streamHealth.queueKb} KB. This may cause stream instability or dropped frames.`,
            canAutoFix: false,
            fixAction: 'suggest_quality_down',
            fixLabel: 'Reduce Quality',
            timestamp: now,
        });
    }

    // Rule 6: Stream key missing while streaming
    if (
        !snapshot.streamKey &&
        snapshot.streamStatus !== 'idle'
    ) {
        results.push({
            id: nextId(),
            severity: 'critical',
            category: 'config',
            title: 'Stream key not configured',
            detail:
                'The stream is active but no stream key is set. Configure your RTMP stream key in Settings.',
            canAutoFix: false,
            fixAction: 'prompt_stream_key',
            fixLabel: 'Open Settings',
            timestamp: now,
        });
    }

    // Rule 7: No camera sources
    if (snapshot.cameraSources.length === 0) {
        results.push({
            id: nextId(),
            severity: 'warn',
            category: 'camera',
            title: 'No cameras connected',
            detail:
                'No camera sources are connected. Add a local camera or connect a phone via QR code to start producing.',
            canAutoFix: false,
            fixAction: 'suggest_add_camera',
            fixLabel: 'Add Camera',
            timestamp: now,
        });
    }

    // Rule 8: Camera(s) in error state
    const errorCams = snapshot.cameraSources.filter((c) => c.status === 'error');
    if (errorCams.length > 0) {
        results.push({
            id: nextId(),
            severity: 'warn',
            category: 'camera',
            title: `${errorCams.length} camera(s) in error state`,
            detail: `Camera(s) ${errorCams.map((c) => c.label || c.id).join(', ')} reported errors. Try removing and re-adding them.`,
            canAutoFix: false,
            timestamp: now,
        });
    }

    // Rule 9: Peer server disconnected (when cameras need it)
    const hasPhoneCams = snapshot.cameraSources.some((c) => c.kind === 'phone');
    if (hasPhoneCams && !snapshot.peerConnected) {
        results.push({
            id: nextId(),
            severity: 'warn',
            category: 'peer',
            title: 'Peer server disconnected',
            detail:
                'Phone cameras require the peer server, but it appears disconnected. Phone camera feeds may be interrupted.',
            canAutoFix: false,
            timestamp: now,
        });
    }

    return results;
}

// ── Overall Health ────────────────────────────────────────────────────

export function computeOverallHealth(diagnostics: DiagnosticResult[]): OverallHealth {
    if (diagnostics.some((d) => d.severity === 'critical')) return 'critical';
    if (diagnostics.some((d) => d.severity === 'warn')) return 'degraded';
    return 'healthy';
}

// ── Remote Health Check ───────────────────────────────────────────────

export async function fetchRelayDiagnostics(wsUrl: string): Promise<RelayDiagnostics> {
    const base = getHttpBaseFromWsUrl(wsUrl);
    if (!base) return { ok: false, error: 'no_base_url' };

    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 4000);

        const [healthRes, ffmpegRes] = await Promise.allSettled([
            fetch(`${base}/health`, { signal: controller.signal }),
            fetch(`${base}/ffmpeg`, { signal: controller.signal }),
        ]);

        clearTimeout(timeout);

        let healthData: any = {};
        let ffmpegData: any = {};

        if (healthRes.status === 'fulfilled' && healthRes.value.ok) {
            healthData = await healthRes.value.json().catch(() => ({}));
        }
        if (ffmpegRes.status === 'fulfilled' && ffmpegRes.value.ok) {
            ffmpegData = await ffmpegRes.value.json().catch(() => ({}));
        }

        const metrics = healthData?.metrics || {};
        return {
            ok: healthData?.ok === true,
            diagnostics: {
                ffmpegAvailable: ffmpegData?.ok === true,
                ffmpegVersion: ffmpegData?.version || 'unknown',
                activeStreams: metrics.activeStreams ?? 0,
                restartAttempts: metrics.restartAttempts ?? 0,
                lastError: metrics.lastError ?? null,
                wsConnections: metrics.activeWsConnections ?? 0,
                uptimeSeconds: 0, // server doesn't expose uptime directly
            },
        };
    } catch (err: any) {
        return { ok: false, error: err?.message || 'fetch_failed' };
    }
}

// ── AI-Assisted Ask ───────────────────────────────────────────────────

export async function askOpsAgent(
    question: string,
    snapshot: SystemSnapshot
): Promise<string> {
    // Build a context-rich prompt that includes current system state
    const stateContext = [
        `Current System State:`,
        `- Relay: ${snapshot.relayConnected ? 'connected' : 'DISCONNECTED'} (${snapshot.relayStatus || 'unknown'})`,
        `- Stream: ${snapshot.streamStatus}`,
        `- Stream Key: ${snapshot.streamKey ? 'configured' : 'NOT SET'}`,
        `- Cameras: ${snapshot.cameraSources.length} (${snapshot.cameraSources.map((c) => `${c.label}:${c.status}`).join(', ') || 'none'})`,
        `- Peer: ${snapshot.peerConnected ? 'connected' : 'disconnected'}`,
        `- RTT: ${snapshot.streamHealth.rttMs !== null ? `${snapshot.streamHealth.rttMs}ms` : 'N/A'}`,
        `- Queue: ${snapshot.streamHealth.queueKb} KB`,
        `- Last Fatal: ${snapshot.lastRelayFatal || 'none'}`,
    ].join('\n');

    const fullQuery = `You are Aether Ops Agent, a smart troubleshooting assistant for Aether Studio (a browser-based live streaming production suite). Given the user's question and the current system state below, provide concise, actionable troubleshooting advice.\n\n${stateContext}\n\nUser Question: ${question}`;

    try {
        const aiHealth = await checkAiAvailability();
        if (!aiHealth.ok) {
            return fallbackAnswer(question, snapshot);
        }
        const response = await askStudioAssistant(fullQuery);
        return response;
    } catch {
        return fallbackAnswer(question, snapshot);
    }
}

// ── Fallback (no AI) ──────────────────────────────────────────────────

function fallbackAnswer(question: string, snapshot: SystemSnapshot): string {
    const q = question.toLowerCase();

    if (q.includes('relay') || q.includes('connect')) {
        if (!snapshot.relayConnected) {
            return 'Your relay is currently disconnected. Click "Reconnect Relay" in the diagnostics panel, or check that your relay server is running and the WebSocket URL is correct in Settings.';
        }
        return 'Your relay appears connected. If you\'re experiencing issues, check the RTT and queue metrics in the health dashboard.';
    }

    if (q.includes('stream') || q.includes('live') || q.includes('lag')) {
        if (!snapshot.streamKey) {
            return 'No stream key is configured. Go to Settings and paste your RTMP stream key (from YouTube, Twitch, etc.).';
        }
        if (snapshot.streamHealth.rttMs !== null && snapshot.streamHealth.rttMs > 2000) {
            return `Your relay latency is high (${snapshot.streamHealth.rttMs}ms). Try reducing stream quality in Settings, or check your network connection.`;
        }
        return 'Stream appears healthy. If you see buffering on the viewer side, it may be a CDN or viewer network issue.';
    }

    if (q.includes('camera') || q.includes('phone') || q.includes('black')) {
        if (snapshot.cameraSources.length === 0) {
            return 'No cameras are connected. Use Input Manager to add a local camera or connect a phone via QR code.';
        }
        const errors = snapshot.cameraSources.filter((c) => c.status === 'error');
        if (errors.length > 0) {
            return `Camera(s) ${errors.map((c) => c.label).join(', ')} are in error state. Try removing and re-adding them.`;
        }
        return 'Cameras appear connected. If you see a black screen, try clicking on the canvas or switching the main camera.';
    }

    if (q.includes('ffmpeg')) {
        return 'FFmpeg is required for streaming. Make sure it\'s installed and the relay can find it. Check the Ops Agent health dashboard for ffmpeg status.';
    }

    return 'I\'m not sure about that. Try asking about: relay connection, stream issues, camera problems, or ffmpeg. You can also check the diagnostics dashboard for a system overview.';
}

// ── Ops Agent Controller Class ────────────────────────────────────────

export type FixCallback = (action: FixAction) => Promise<boolean>;

export class OpsAgentController {
    private intervalId: ReturnType<typeof setInterval> | null = null;
    private _enabled = true;
    private _diagnostics: DiagnosticResult[] = [];
    private _log: OpsLogEntry[] = [];
    private _snapshot: SystemSnapshot | null = null;
    private _listeners: Set<() => void> = new Set();
    private _fixCallback: FixCallback | null = null;
    private _highRttCount = 0;

    readonly POLL_INTERVAL_MS = 8000;
    readonly MAX_LOG_ENTRIES = 100;
    readonly HIGH_RTT_THRESHOLD = 3; // consecutive checks before warning

    get enabled() {
        return this._enabled;
    }
    get diagnostics() {
        return this._diagnostics;
    }
    get log() {
        return this._log;
    }
    get overallHealth(): OverallHealth {
        return computeOverallHealth(this._diagnostics);
    }
    get snapshot() {
        return this._snapshot;
    }

    setFixCallback(cb: FixCallback) {
        this._fixCallback = cb;
    }

    subscribe(listener: () => void) {
        this._listeners.add(listener);
        return () => {
            this._listeners.delete(listener);
        };
    }

    private notify() {
        this._listeners.forEach((fn) => {
            try {
                fn();
            } catch { }
        });
    }

    private addLog(entry: Omit<OpsLogEntry, 'timestamp'>) {
        this._log.unshift({ ...entry, timestamp: Date.now() });
        if (this._log.length > this.MAX_LOG_ENTRIES) {
            this._log = this._log.slice(0, this.MAX_LOG_ENTRIES);
        }
    }

    updateSnapshot(snapshot: SystemSnapshot) {
        this._snapshot = snapshot;
    }

    /** Run one diagnostic cycle */
    runCycle() {
        if (!this._snapshot) return;

        const results = runDiagnostics(this._snapshot);

        // Track sustained high RTT
        if (
            this._snapshot.streamHealth.rttMs !== null &&
            this._snapshot.streamHealth.rttMs > 2000
        ) {
            this._highRttCount++;
        } else {
            this._highRttCount = 0;
        }

        // Only include RTT warning if sustained
        const filtered = results.filter((r) => {
            if (r.title === 'High relay latency' && this._highRttCount < this.HIGH_RTT_THRESHOLD) {
                return false;
            }
            return true;
        });

        // Detect changes from previous diagnostics
        const prevTitles = new Set(this._diagnostics.map((d) => d.title));
        const newTitles = new Set(filtered.map((d) => d.title));

        // Log new issues
        for (const diag of filtered) {
            if (!prevTitles.has(diag.title)) {
                this.addLog({
                    type: 'diagnosis',
                    message: `[${diag.severity.toUpperCase()}] ${diag.title}: ${diag.detail}`,
                    severity: diag.severity,
                });
            }
        }

        // Log resolved issues
        for (const prev of this._diagnostics) {
            if (!newTitles.has(prev.title)) {
                this.addLog({
                    type: 'fix_result',
                    message: `✅ Resolved: ${prev.title}`,
                    severity: 'info',
                });
            }
        }

        this._diagnostics = filtered;
        this.notify();
    }

    /** Execute a fix action */
    async executeFix(action: FixAction): Promise<boolean> {
        if (!this._fixCallback) {
            this.addLog({ type: 'fix_attempt', message: `Cannot execute "${action}" — no fix handler registered.`, severity: 'warn' });
            this.notify();
            return false;
        }

        this.addLog({ type: 'fix_attempt', message: `Attempting fix: ${action}...` });
        this.notify();

        try {
            const success = await this._fixCallback(action);
            this.addLog({
                type: 'fix_result',
                message: success ? `✅ Fix "${action}" succeeded.` : `⚠️ Fix "${action}" did not resolve the issue.`,
                severity: success ? 'info' : 'warn',
            });
            // Re-run diagnostics after a short delay to check if fix worked
            setTimeout(() => this.runCycle(), 2000);
            this.notify();
            return success;
        } catch (err: any) {
            this.addLog({
                type: 'fix_result',
                message: `❌ Fix "${action}" failed: ${err?.message || 'unknown error'}`,
                severity: 'critical',
            });
            this.notify();
            return false;
        }
    }

    /** Ask the AI agent with system context */
    async ask(question: string): Promise<string> {
        if (!this._snapshot) {
            return 'System state not available yet. Please wait a moment.';
        }

        this.addLog({ type: 'user_ask', message: question });
        this.notify();

        const answer = await askOpsAgent(question, this._snapshot);

        this.addLog({ type: 'agent_reply', message: answer });
        this.notify();

        return answer;
    }

    /** Fetch remote diagnostics from relay server */
    async fetchRemoteDiagnostics(): Promise<RelayDiagnostics | null> {
        if (!this._snapshot?.wsUrl) return null;

        const result = await fetchRelayDiagnostics(this._snapshot.wsUrl);

        // Log ffmpeg issues from remote check
        if (result.ok && result.diagnostics && !result.diagnostics.ffmpegAvailable) {
            const existing = this._diagnostics.find((d) => d.title === 'FFmpeg not available on relay');
            if (!existing) {
                const diag: DiagnosticResult = {
                    id: nextId(),
                    severity: 'critical',
                    category: 'relay',
                    title: 'FFmpeg not available on relay',
                    detail: 'The relay server cannot find ffmpeg. Streaming will not work. Check the relay server ffmpeg installation.',
                    canAutoFix: false,
                    fixAction: 'check_ffmpeg',
                    fixLabel: 'Check FFmpeg',
                    timestamp: Date.now(),
                };
                this._diagnostics.push(diag);
                this.addLog({ type: 'diagnosis', message: `[CRITICAL] ${diag.title}`, severity: 'critical' });
                this.notify();
            }
        }

        return result;
    }

    /** Start the periodic diagnostic loop */
    start() {
        this._enabled = true;
        if (this.intervalId) return;
        this.intervalId = setInterval(() => {
            if (this._enabled) this.runCycle();
        }, this.POLL_INTERVAL_MS);
        // Run immediately
        this.runCycle();
        this.addLog({ type: 'fix_result', message: '🤖 Ops Agent started — monitoring all systems.' });
        this.notify();
    }

    /** Stop the periodic diagnostic loop */
    stop() {
        this._enabled = false;
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
        this.addLog({ type: 'fix_result', message: '⏸ Ops Agent paused.' });
        this.notify();
    }

    /** Toggle on/off */
    toggle() {
        if (this._enabled) {
            this.stop();
        } else {
            this.start();
        }
    }

    /** Clean up on unmount */
    destroy() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
        this._listeners.clear();
    }
}

// ── Singleton ─────────────────────────────────────────────────────────

let _instance: OpsAgentController | null = null;
export function getOpsAgent(): OpsAgentController {
    if (!_instance) {
        _instance = new OpsAgentController();
    }
    return _instance;
}
