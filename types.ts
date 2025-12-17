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
