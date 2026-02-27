import { SignalData } from '../types';

type MessageHandler = (data: any) => void;
const MAX_HOST_SOCKETS = Number((import.meta as any)?.env?.VITE_RELAY_MAX_HOST_SOCKETS ?? 4);
const BASE_RECONNECT_DELAY_MS = 1000;
const MAX_RECONNECT_DELAY_MS = 15000;

export class SignalingService {
  private ws: WebSocket | null = null;
  private url: string;
  private sessionId: string;
  private role: 'host' | 'peer';
  private messageHandlers: Set<MessageHandler> = new Set();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private isIntentionalClose = false;
  private reconnectAttempts = 0;
  private reconnectCount = 0;
  private static hostSocketCounts: Record<string, number> = {};

  constructor(url: string, sessionId: string, role: 'host' | 'peer') {
    this.url = url;
    this.sessionId = sessionId;
    this.role = role;
  }

  public connect() {
    this.isIntentionalClose = false;

    // Safety check to avoid double connections
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
        return;
    }

    if (this.role === 'host') {
      const current = SignalingService.hostSocketCounts[this.sessionId] || 0;
      if (current >= MAX_HOST_SOCKETS) {
        console.warn(`Signaling host socket cap reached for ${this.sessionId}`);
        return;
      }
      SignalingService.hostSocketCounts[this.sessionId] = current + 1;
    }

    console.log(`Connecting to signaling: ${this.url} [${this.sessionId}]`);
    
    try {
        this.ws = new WebSocket(this.url);

        this.ws.onopen = () => {
            this.reconnectAttempts = 0;
            console.log('Signaling Connected');
            this.send({ type: 'join', sessionId: this.sessionId, role: this.role });
            if (this.reconnectTimer) {
                clearTimeout(this.reconnectTimer);
                this.reconnectTimer = null;
            }
        };

        this.ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                this.messageHandlers.forEach(handler => handler(data));
            } catch (e) {
                console.error('Failed to parse signal:', e);
            }
        };

        this.ws.onclose = () => {
            console.log('Signaling Disconnected');
            if (this.role === 'host') {
                const current = SignalingService.hostSocketCounts[this.sessionId] || 0;
                SignalingService.hostSocketCounts[this.sessionId] = Math.max(0, current - 1);
            }
            this.ws = null;
            if (!this.isIntentionalClose) {
                this.scheduleReconnect();
            }
        };

        this.ws.onerror = (err) => {
            console.error('Signaling Error:', err);
            if (this.role === 'host') {
                const current = SignalingService.hostSocketCounts[this.sessionId] || 0;
                SignalingService.hostSocketCounts[this.sessionId] = Math.max(0, current - 1);
            }
            this.ws = null;
        };
    } catch (e) {
        console.error('Connection failed synchronously:', e);
        if (this.role === 'host') {
            const current = SignalingService.hostSocketCounts[this.sessionId] || 0;
            SignalingService.hostSocketCounts[this.sessionId] = Math.max(0, current - 1);
        }
        this.scheduleReconnect();
    }
  }

  public disconnect() {
    this.isIntentionalClose = true;
    if (this.ws) {
        this.ws.close();
        this.ws = null;
    }
    if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
    }
    if (this.role === 'host') {
        const current = SignalingService.hostSocketCounts[this.sessionId] || 0;
        SignalingService.hostSocketCounts[this.sessionId] = Math.max(0, current - 1);
    }
  }

  public send(data: any) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify(data));
    } else {
        console.warn('Cannot send, socket not open', data.type);
    }
  }

  public onMessage(handler: MessageHandler) {
    this.messageHandlers.add(handler);
    return () => {
        this.messageHandlers.delete(handler);
    };
  }

  public getReconnectCount() {
    return this.reconnectCount;
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectAttempts += 1;
    this.reconnectCount += 1;
    const delay = Math.min(MAX_RECONNECT_DELAY_MS, BASE_RECONNECT_DELAY_MS * Math.pow(2, this.reconnectAttempts - 1));
    const jitter = Math.random() * 200;
    const finalDelay = Math.round(delay + jitter);
    console.log(`Scheduling reconnect in ${finalDelay}ms...`);
    this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        this.connect();
    }, finalDelay);
  }
}
