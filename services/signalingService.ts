import { SignalData } from '../types';

type MessageHandler = (data: any) => void;

export class SignalingService {
  private ws: WebSocket | null = null;
  private url: string;
  private sessionId: string;
  private role: 'host' | 'peer';
  private messageHandlers: Set<MessageHandler> = new Set();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private isIntentionalClose = false;

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

    console.log(`Connecting to signaling: ${this.url} [${this.sessionId}]`);
    
    try {
        this.ws = new WebSocket(this.url);

        this.ws.onopen = () => {
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
            if (!this.isIntentionalClose) {
                this.scheduleReconnect();
            }
        };

        this.ws.onerror = (err) => {
            console.error('Signaling Error:', err);
        };
    } catch (e) {
        console.error('Connection failed synchronously:', e);
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

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    console.log('Scheduling reconnect in 3s...');
    this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        this.connect();
    }, 3000);
  }
}