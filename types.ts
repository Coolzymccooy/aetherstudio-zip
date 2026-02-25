export enum SourceType {
  CAMERA = 'CAMERA',
  SCREEN = 'SCREEN',
  IMAGE = 'IMAGE',
  TEXT = 'TEXT'
}

export interface LayerStyle {
  rounded?: number; // 0-100%
  opacity?: number; // 0-1
  scale?: number; // 1 = 100%
  rotation?: number; // degrees
  filter?: string; // CSS-like filter string (e.g. "grayscale(100%)")
  border?: boolean;
  borderColor?: string;
  circular?: boolean; // For Camo-like circle crop
  scrolling?: boolean; // Text ticker
  scrollSpeed?: number; // Pixels per frame

  // Text Specific
  fontSize?: number;
  fontFamily?: string;
  fontWeight?: string; // 'normal' | 'bold'
  color?: string;

  // Lower-third / overlay rendering
  bgColor?: string;       // Background box color (e.g. "rgba(0,0,0,0.75)")
  bgPadding?: number;     // Padding inside background box (px)
  bgRounding?: number;    // Border radius for background box
  accentColor?: string;   // Left accent bar color
  accentWidth?: number;   // Width of left accent bar (px)
  slideIn?: boolean;      // Animate in from left edge
  slideSpeed?: number;    // px per frame for slide animation (default 60)
}

export interface Layer {
  id: string;
  type: SourceType;
  label: string;
  visible: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
  src?: string | MediaStream; // For images or video streams
  content?: string; // For text
  zIndex: number;
  style: LayerStyle;
  backgroundRemoval?: boolean; // New: AI Green Screen
}

export interface AudioTrackConfig {
  id: string;
  label: string;
  volume: number;
  muted: boolean;
  isMic: boolean;
  noiseCancellation: boolean;
  stream?: MediaStream;
}

export interface AIResponse {
  text?: string;
  imageUrl?: string;
  action?: string;
}

export enum StreamStatus {
  IDLE = 'IDLE',
  RECORDING = 'RECORDING',
  LIVE = 'LIVE'
}

// Signaling Types
export interface SignalData {
  type: 'offer' | 'answer' | 'ice-candidate';
  roomId: string;
  payload: any;
}

// Telemetry Types
export interface TelemetryEvent {
  id?: string;
  uid: string;
  email: string;
  type: 'stream_start' | 'stream_stop' | 'stream_error';
  timestamp: any; // ServerTimestamp
  sessionId: string;
  duration?: number; // seconds
  destinations?: string[];
  quality?: string;
  error?: string;
  appVersion: string;
  platform: string;
}
