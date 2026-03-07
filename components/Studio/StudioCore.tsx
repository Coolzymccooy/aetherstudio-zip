import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Monitor, Camera, Image as ImageIcon, Type, Circle, Zap, Settings, PlaySquare, StopCircle, Radio, X, Sliders, Sparkles, Download, Package, FolderInput, Network, ExternalLink, AlertCircle, AlertTriangle, Smartphone, HelpCircle, Disc, Square, Cloud, LogOut, Link as LinkIcon, RefreshCw, Activity, Tv, ChevronRight, Shield } from 'lucide-react';
import { getPeerEnv } from "../../src/utils/peerEnv";
import { CanvasStage } from './CanvasStage';
import { AudioMixer } from './AudioMixer';
import { AIPanel } from '../AI/AIPanel';
import { checkAiAvailability, formatAiHealthMessage, type AiHealthStatus } from '../../services/geminiService';
import { LayerProperties } from './LayerProperties';
import { DeviceSelectorModal } from './DeviceSelectorModal';
import { QRConnectModal } from './QRConnectModal';
import { HelpModal } from './HelpModal';
import { OpsAgentPanel } from './OpsAgentPanel';
import type { SystemSnapshot } from '../../services/opsAgentService';
import { Layer, SourceType, AudioTrackConfig, StreamStatus } from '../../types';
import { auth } from '../../services/firebase';
import { verifyLicenseKey, issueLicenseKey } from '../../services/licenseService';
import { signOut, User } from 'firebase/auth';
import { logStreamStart, logStreamStop, logStreamError } from '../../services/telemetryService';
import { generateRoomId, getCleanPeerId } from '../../utils/peerId';
import { computeComposerLayout, computeTransitionAlpha, type ComposerLayoutRenderMeta } from './composerLayout';
import {
  buildLayoutSelection,
  DEFAULT_BRAND_COLORS,
  DEFAULT_LAYOUT_THEME_ID,
  getLayoutThemeDefinition,
  LAYOUT_PACKS,
  LAYOUT_THEMES,
  layoutThemeIdFromTemplate,
  type BackgroundStyleId,
  type ComposerLayoutTemplate,
  type FrameStyleId,
  type LayoutPackId,
  type LayoutThemeId,
  type MotionStyleId,
} from './cinematicLayout';
import {
  inferIntentFromLuminaState,
  inferThemeFromLuminaState,
  normalizeLuminaState,
  type LuminaContentMode,
  type NormalizedLuminaState,
  type SmartBroadcastIntent,
} from './luminaSync';
import {
  resolveComposerMainLayerId,
  resolveProgramLayerId,
} from './studioInteraction';
import {
  buildGlobalScrollSegments,
  buildCanvasLayoutRevision,
  mapGlobalNodeScrollTopToProgress,
  mapGlobalProgressToNodeScrollTop,
  computeOperatorRailScrollState,
  computeInputSectionBodyHeights,
  type GlobalScrollSegments,
} from './studioShell';
import Peer, { DataConnection, MediaConnection } from "peerjs";

const generateId = () => Math.random().toString(36).substr(2, 9);
const MAX_PHONE_CAMS = (() => {
  const raw = Number((import.meta as any).env?.VITE_MAX_PHONE_CAMS ?? 4);
  if (!Number.isFinite(raw) || raw < 1) return 4;
  return Math.floor(raw);
})();

// Stability-first: cap the number of camera sources actively composed into the
// program output. Extra cameras stay connected but are excluded from the canvas
// composition to prevent stream collapse and encoder stalls.
const MAX_COMPOSED_CAMERAS = (() => {
  const raw = Number((import.meta as any).env?.VITE_MAX_COMPOSED_CAMERAS ?? 4);
  if (!Number.isFinite(raw) || raw < 1) return 4;
  return Math.floor(raw);
})();

const DEFAULT_OPERATOR_RAIL_WIDTH = 384;
const MIN_OPERATOR_RAIL_WIDTH = 360;
const MAX_OPERATOR_RAIL_WIDTH = 560;
const INPUT_RAIL_DISABLED_THUMB_HEIGHT = 56;
const INPUT_RAIL_OUTER_SCROLL_ID = '__outer_rail__';

type ScenePreset = {
  id: string;
  name: string;
  layout: ComposerLayoutTemplate;
  themeId: LayoutThemeId;
  backgroundStyle: BackgroundStyleId;
  frameStyle: FrameStyleId;
  motionStyle: MotionStyleId;
  layoutPack: LayoutPackId;
  brandColors: string[];
  mainLayerId?: string | null;
  positions: Array<{ layerId: string; x: number; y: number; width: number; height: number; zIndex: number }>;
  composerMode?: boolean;
  transitionMode?: string;
  version?: number;
  cameraOrder?: string[];
  swappedRoles?: boolean;
};

const normalizeScenePreset = (raw: any): ScenePreset | null => {
  if (!raw || typeof raw !== 'object') return null;
  const id = String(raw.id || '').trim();
  if (!id) return null;

  const allowedLayouts: ComposerLayoutTemplate[] = [
    'freeform',
    'main_thumbs',
    'grid_2x2',
    'side_by_side',
    'pip_corner',
    'speaker_focus',
    'scripture_focus',
    'sermon_split_left',
    'sermon_split_right',
  ];
  const layout: ComposerLayoutTemplate = allowedLayouts.includes(raw.layout)
    ? raw.layout
    : 'freeform';
  const themeId = LAYOUT_THEMES.some((theme) => theme.id === raw.themeId)
    ? raw.themeId as LayoutThemeId
    : layoutThemeIdFromTemplate(layout);
  const selection = buildLayoutSelection(themeId, {
    backgroundStyle: raw.backgroundStyle,
    frameStyle: raw.frameStyle,
    motionStyle: raw.motionStyle,
  });

  const positions = Array.isArray(raw.positions)
    ? raw.positions
      .map((p: any) => ({
        layerId: String(p?.layerId || '').trim(),
        x: Number(p?.x || 0),
        y: Number(p?.y || 0),
        width: Number(p?.width || 0),
        height: Number(p?.height || 0),
        zIndex: Number(p?.zIndex || 0),
      }))
      .filter((p: any) => !!p.layerId)
    : [];

  const cameraOrder = Array.isArray(raw.cameraOrder)
    ? raw.cameraOrder.map((id: unknown) => String(id || '').trim()).filter(Boolean)
    : undefined;

  return {
    id,
    name: String(raw.name || 'Scene').trim() || 'Scene',
    layout,
    themeId,
    backgroundStyle: selection.backgroundStyle,
    frameStyle: selection.frameStyle,
    motionStyle: selection.motionStyle,
    layoutPack: LAYOUT_PACKS.some((pack) => pack.id === raw.layoutPack)
      ? raw.layoutPack as LayoutPackId
      : selection.packId,
    brandColors: Array.isArray(raw.brandColors) && raw.brandColors.length
      ? raw.brandColors.map((value: unknown) => String(value || '').trim()).filter(Boolean)
      : [...DEFAULT_BRAND_COLORS],
    mainLayerId: raw.mainLayerId ? String(raw.mainLayerId) : null,
    positions,
    composerMode: typeof raw.composerMode === 'boolean' ? raw.composerMode : undefined,
    transitionMode: typeof raw.transitionMode === 'string' ? raw.transitionMode : undefined,
    version: Number(raw.version || 2),
    cameraOrder,
    swappedRoles: raw.swappedRoles === true,
  };
};

const normalizeScenePresets = (raw: unknown): ScenePreset[] => {
  if (!Array.isArray(raw)) return [];
  return raw.map(normalizeScenePreset).filter((p): p is ScenePreset => !!p);
};

interface StudioProps {
  user: User;
  onBack: () => void;
}

type StreamQualityPreset = 'high' | 'medium' | 'low';
type BroadcastIntent = SmartBroadcastIntent;
type StudioStatusMsg = {
  type: 'error' | 'info' | 'warn';
  text: string;
  persistent?: boolean;
};
type CinematicPresetPreview = {
  layoutTheme: LayoutThemeId;
  appliedTheme: LayoutThemeId;
  previewTheme: LayoutThemeId;
  backgroundStyle: BackgroundStyleId;
  frameStyle: FrameStyleId;
  motionStyle: MotionStyleId;
  layoutPack: LayoutPackId;
  brandColors: string[];
  swappedRoles: boolean;
};
type EncoderBootstrapStats = {
  recorderState: string;
  firstChunkReceived: boolean;
  chunksSent: number;
  zeroSizeChunks: number;
  firstChunkDelayMs: number | null;
};
type DesktopUpdaterStatus = {
  type: 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error';
  version?: string | null;
  percent?: number;
  message?: string;
};

const SourceButton: React.FC<{ icon: React.ReactNode; label: string; onClick: () => void; disabled?: boolean }> = ({ icon, label, onClick, disabled }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    className={`group relative p-3 rounded-xl transition-all flex items-center justify-center ${disabled
      ? 'text-gray-600 cursor-not-allowed opacity-50'
      : 'text-gray-400 hover:text-white hover:bg-aether-700/50'
      }`}
  >
    {icon}
    <div className="absolute left-14 top-1/2 -translate-y-1/2 px-2 py-1 bg-black/80 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-50 border border-white/10 backdrop-blur-sm">
      {label}
    </div>
  </button>
);

const SourcePreview: React.FC<{ stream?: MediaStream }> = ({ stream }) => {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current) {
      (ref.current as any).srcObject = stream || null;
    }
  }, [stream]);
  if (!stream) {
    return <div className="w-16 h-10 bg-black/40 rounded border border-aether-700" />;
  }
  return <video ref={ref} autoPlay muted playsInline className="w-16 h-10 object-contain bg-black/60 rounded border border-aether-700" />;
};

const CollapsibleSection: React.FC<{
  title: string;
  subtitle?: string;
  defaultOpen?: boolean;
  open?: boolean;
  onToggle?: (open: boolean) => void;
  className?: string;
  summaryClassName?: string;
  bodyClassName?: string;
  scrollBodyClassName?: string;
  bodyStyle?: React.CSSProperties;
  footer?: React.ReactNode;
  footerClassName?: string;
  children: React.ReactNode;
}> = ({
  title,
  subtitle,
  defaultOpen,
  open,
  onToggle,
  className,
  summaryClassName,
  bodyClassName,
  scrollBodyClassName,
  bodyStyle,
  footer,
  footerClassName,
  children
}) => (
  <details
    open={open ?? defaultOpen}
    onToggle={(e) => {
      if (!onToggle) return;
      const el = e.currentTarget as HTMLDetailsElement;
      // Skip programmatic toggles caused by React reconciling the controlled `open`
      // prop. When React sets el.open = false (closing another section), the browser
      // fires a toggle event. At that point the prop value already matches the new
      // DOM state — the user didn't interact. A genuine user click always has
      // el.open !== the current prop because the prop hasn't updated yet.
      const expectedOpen = open ?? defaultOpen ?? false;
      if (el.open === expectedOpen) return;
      onToggle(el.open);
    }}
    className={`flex min-h-0 flex-col overflow-hidden ${className || "bg-aether-800/40 border border-aether-700 rounded-lg"}`}
  >
    <summary className={summaryClassName || "sticky top-0 z-20 cursor-pointer list-none px-3 py-2 flex items-center justify-between bg-[#05101b]"}>
      <div>
        <div className="text-[13px] font-semibold text-white">{title}</div>
        {subtitle && <div className="text-xs text-gray-300">{subtitle}</div>}
      </div>
      <div className="text-xs text-gray-400">Toggle</div>
    </summary>
    <div className={bodyClassName || "min-h-0 overflow-hidden px-3 pb-3 pt-1"}>
      <div className={scrollBodyClassName || "space-y-2"} style={bodyStyle}>
        {children}
      </div>
    </div>
    {footer ? <div className={footerClassName || "relative z-20 shrink-0 pointer-events-auto"}>{footer}</div> : null}
  </details>
);

const SettingsSection: React.FC<{
  title: string;
  subtitle?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}> = ({ title, subtitle, defaultOpen, children }) => (
  <details open={defaultOpen} className="bg-aether-800/50 border border-aether-700 rounded-lg">
    <summary className="cursor-pointer list-none px-4 py-3 flex items-center justify-between">
      <div>
        <div className="text-sm font-bold text-white">{title}</div>
        {subtitle && <div className="text-[10px] text-gray-400">{subtitle}</div>}
      </div>
      <div className="text-[10px] text-gray-400">Toggle</div>
    </summary>
    <div className="px-4 pb-4 space-y-3">
      {children}
    </div>
  </details>
);

export const StudioCore: React.FC<StudioProps> = ({ user, onBack }) => {
  const desktopUpdater = (window as any).aetherDesktop as undefined | {
    checkForUpdates?: () => Promise<{ ok: boolean; reason?: string; message?: string; version?: string | null }>;
    installDownloadedUpdate?: () => Promise<{ ok: boolean; reason?: string }>;
    onUpdateStatus?: (handler: (status: DesktopUpdaterStatus) => void) => () => void;
  };
  // --- STATE DECLARATIONS ---
  const [cloudConnected, setCloudConnected] = useState(false);
  const [layers, setLayers] = useState<Layer[]>([]);
  const [audioTracks, setAudioTracks] = useState<AudioTrackConfig[]>([]);
  const [streamStatus, setStreamStatus] = useState<StreamStatus>(StreamStatus.IDLE);

  // Prevent accidental refresh/close during live stream
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (streamStatus === StreamStatus.LIVE) {
        e.preventDefault();
        e.returnValue = ''; // Standard for most browsers
        return ''; // Standard for some browsers
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [streamStatus]);
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);
  const [rightPanelTab, setRightPanelTab] = useState<'properties' | 'ai' | 'inputs' | 'ops'>('ai');
  const [showSettings, setShowSettings] = useState(false);
  const [settingsPos, setSettingsPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [inputsSection, setInputsSection] = useState<string>('input-manager');
  const [windowViewport, setWindowViewport] = useState(() => ({
    width: typeof window !== 'undefined' ? window.innerWidth : 0,
    height: typeof window !== 'undefined' ? window.innerHeight : 0,
  }));
  const [operatorRailWidth, setOperatorRailWidth] = useState(() => {
    if (typeof window === 'undefined') return DEFAULT_OPERATOR_RAIL_WIDTH;
    const raw = Number(localStorage.getItem('aether_operator_rail_width') || DEFAULT_OPERATOR_RAIL_WIDTH);
    if (!Number.isFinite(raw)) return DEFAULT_OPERATOR_RAIL_WIDTH;
    return Math.max(MIN_OPERATOR_RAIL_WIDTH, Math.min(MAX_OPERATOR_RAIL_WIDTH, Math.round(raw)));
  });
  const [operatorRailSize, setOperatorRailSize] = useState({ width: 0, height: 0 });
  const [inputRailScrollState, setInputRailScrollState] = useState(() => computeOperatorRailScrollState({
    clientHeight: 0,
    scrollHeight: 0,
    scrollTop: 0,
    trackHeight: 0,
  }));

  const [showDeviceSelector, setShowDeviceSelector] = useState(false);
  const [desktopSources, setDesktopSources] = useState<Array<{ id: string; name: string; thumbnail: string }> | null>(null);
  const [showQRModal, setShowQRModal] = useState(false);
  const [showHelpModal, setShowHelpModal] = useState(false);
  const [cloudError, setCloudError] = useState<string | null>(null);
  const [incomingRes, setIncomingRes] = useState<string>("");
  const [micPickerTrackId, setMicPickerTrackId] = useState<string | null>(null);
  const [availableMics, setAvailableMics] = useState<MediaDeviceInfo[]>([]);
  const [streamKey, setStreamKey] = useState(() => localStorage.getItem('aether_stream_key') || '');
  const [licenseKey, setLicenseKey] = useState(() => (localStorage.getItem('aether_license_key') || '').toUpperCase());
  const [licenseStatus, setLicenseStatus] = useState<{ state: 'idle' | 'checking' | 'valid' | 'invalid' | 'error'; message?: string; source?: 'server' | 'offline' }>({ state: 'idle' });
  const [adminToken, setAdminToken] = useState(() => {
    if (typeof window === 'undefined') return '';
    return sessionStorage.getItem('aether_admin_token') || '';
  });
  const [issueEmail, setIssueEmail] = useState(() => user?.email || '');
  const [issueDays, setIssueDays] = useState(365);
  const [issueStatus, setIssueStatus] = useState<{ state: 'idle' | 'issuing' | 'ok' | 'error'; message?: string; key?: string }>({ state: 'idle' });
  const [streamQuality, setStreamQuality] = useState<StreamQualityPreset>(() => (localStorage.getItem('aether_stream_quality') as any) || 'medium');
  const [wifiMode, setWifiMode] = useState(() => localStorage.getItem('aether_wifi_mode') === 'true');
  const [desktopConnected, setDesktopConnected] = useState(false);
  const [relayConnected, setRelayConnected] = useState(false);
  const [relayStatus, setRelayStatus] = useState<string | null>(null);
  const [peerId, setPeerId] = useState<string>('');
  const [isRecording, setIsRecording] = useState(false);
  const [statusMsg, setStatusMsg] = useState<StudioStatusMsg | null>(null);
  const [isCheckingUpdates, setIsCheckingUpdates] = useState(false);
  const [streamHealth, setStreamHealth] = useState<{ kbps: number; drops: number; rttMs: number | null; queueKb: number }>({
    kbps: 0,
    drops: 0,
    rttMs: null,
    queueKb: 0,
  });
  const [encoderBootstrap, setEncoderBootstrap] = useState<EncoderBootstrapStats>({
    recorderState: 'inactive',
    firstChunkReceived: false,
    chunksSent: 0,
    zeroSizeChunks: 0,
    firstChunkDelayMs: null,
  });
  const [outputDeviceId, setOutputDeviceId] = useState(() => localStorage.getItem('aether_audio_output') || 'default');
  const [masterMonitorVolume, setMasterMonitorVolume] = useState(() => Number(localStorage.getItem('aether_monitor_volume') || 80));

  type CameraSourceKind = 'local' | 'phone';
  type CameraSourceStatus = 'pending' | 'live' | 'failed';
  type CameraSource = {
    id: string;
    kind: CameraSourceKind;
    label: string;
    status: CameraSourceStatus;
    layerId?: string;
    stream?: MediaStream;
    peerId?: string;
    audioTrackId?: string;
  };

  const [cameraSources, setCameraSources] = useState<CameraSource[]>([]);
  const [activePhoneSourceId, setActivePhoneSourceId] = useState<string | null>(null);
  const [composerMode, setComposerMode] = useState(false);
  const [composerMainLayerId, setComposerMainLayerId] = useState<string | null>(null);
  const [autoDirectorOn, setAutoDirectorOn] = useState(() => localStorage.getItem('aether_auto_director') === 'true');
  const [autoDirectorInterval, setAutoDirectorInterval] = useState(() => Number(localStorage.getItem('aether_auto_director_interval') || 12));
  const [autoDirectorMode, setAutoDirectorMode] = useState<'sequential' | 'random' | 'audio_reactive'>(() => (localStorage.getItem('aether_auto_director_mode') as any) || 'sequential');
  const [autoDirectorCountdown, setAutoDirectorCountdown] = useState(0);

  const [lowerThirdName, setLowerThirdName] = useState(() => localStorage.getItem('aether_lower_third_name') || 'Guest Name');
  const [lowerThirdTitle, setLowerThirdTitle] = useState(() => localStorage.getItem('aether_lower_third_title') || 'Title / Role');
  const [lowerThirdVisible, setLowerThirdVisible] = useState(false);

  const [pinnedMessage, setPinnedMessage] = useState(() => localStorage.getItem('aether_pinned_message') || '');
  const [tickerMessage, setTickerMessage] = useState(() => localStorage.getItem('aether_ticker_message') || '');
  const [pinnedVisible, setPinnedVisible] = useState(false);
  const [tickerVisible, setTickerVisible] = useState(false);

  // Audience message queue
  const [audienceMessages, setAudienceMessages] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('aether_audience_messages') || '[]'); } catch { return []; }
  });
  const [audienceNewMsg, setAudienceNewMsg] = useState('');
  const [audienceRotateOn, setAudienceRotateOn] = useState(false);
  const [audienceRotateInterval, setAudienceRotateInterval] = useState(8);
  const [audienceCurrentIdx, setAudienceCurrentIdx] = useState(0);

  // Lower third presets
  const [lowerThirdPresets, setLowerThirdPresets] = useState<Array<{ id: string; name: string; title: string }>>(() => {
    try { return JSON.parse(localStorage.getItem('aether_lt_presets') || '[]'); } catch { return []; }
  });
  const [lowerThirdDuration, setLowerThirdDuration] = useState(() => Number(localStorage.getItem('aether_lt_duration') || 5));
  const [lowerThirdAccentColor, setLowerThirdAccentColor] = useState(() => localStorage.getItem('aether_lt_accent') || '#d946ef');

  // Phone connection timestamps
  const phoneConnectedAtRef = useRef<Map<string, number>>(new Map());

  type StreamDestination = { id: string; label: string; url: string; enabled: boolean };
  const [destinations, setDestinations] = useState<StreamDestination[]>(() => {
    try {
      const raw = localStorage.getItem('aether_stream_destinations');
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });

  const [scenePresets, setScenePresets] = useState<ScenePreset[]>(() => {
    try {
      const raw = localStorage.getItem('aether_scene_presets');
      return raw ? normalizeScenePresets(JSON.parse(raw)) : [];
    } catch {
      return [];
    }
  });
  const [presetName, setPresetName] = useState('Main + Thumbs');
  const [layoutTheme, setLayoutTheme] = useState<LayoutThemeId>(() => {
    const raw = localStorage.getItem('aether_layout_theme');
    return LAYOUT_THEMES.some((theme) => theme.id === raw) ? raw as LayoutThemeId : DEFAULT_LAYOUT_THEME_ID;
  });
  const [previewTheme, setPreviewTheme] = useState<LayoutThemeId>(() => {
    const raw = localStorage.getItem('aether_preview_theme');
    return LAYOUT_THEMES.some((theme) => theme.id === raw) ? raw as LayoutThemeId : DEFAULT_LAYOUT_THEME_ID;
  });
  const [appliedTheme, setAppliedTheme] = useState<LayoutThemeId>(() => {
    const raw = localStorage.getItem('aether_applied_theme');
    return LAYOUT_THEMES.some((theme) => theme.id === raw) ? raw as LayoutThemeId : DEFAULT_LAYOUT_THEME_ID;
  });
  const [backgroundStyle, setBackgroundStyle] = useState<BackgroundStyleId>(() => {
    const raw = localStorage.getItem('aether_background_style');
    return ['blurred_camera', 'gradient_motion', 'brand_wave', 'light_studio'].includes(raw || '')
      ? raw as BackgroundStyleId
      : getLayoutThemeDefinition(DEFAULT_LAYOUT_THEME_ID).backgroundStyle;
  });
  const [frameStyle, setFrameStyle] = useState<FrameStyleId>(() => {
    const raw = localStorage.getItem('aether_frame_style');
    return ['floating', 'flat', 'glass'].includes(raw || '')
      ? raw as FrameStyleId
      : getLayoutThemeDefinition(DEFAULT_LAYOUT_THEME_ID).frameStyle;
  });
  const [motionStyle, setMotionStyle] = useState<MotionStyleId>(() => {
    const raw = localStorage.getItem('aether_motion_style');
    return ['smooth', 'snappy', 'gentle'].includes(raw || '')
      ? raw as MotionStyleId
      : getLayoutThemeDefinition(DEFAULT_LAYOUT_THEME_ID).motionStyle;
  });
  const [layoutPack, setLayoutPack] = useState<LayoutPackId>(() => {
    const raw = localStorage.getItem('aether_layout_pack');
    return LAYOUT_PACKS.some((pack) => pack.id === raw)
      ? raw as LayoutPackId
      : getLayoutThemeDefinition(DEFAULT_LAYOUT_THEME_ID).packId;
  });
  const [layoutTemplate, setLayoutTemplate] = useState<ComposerLayoutTemplate>(() => {
    return getLayoutThemeDefinition(DEFAULT_LAYOUT_THEME_ID).layoutTemplate;
  });
  const [previewLayoutTemplate, setPreviewLayoutTemplate] = useState<ComposerLayoutTemplate>(() => {
    return getLayoutThemeDefinition(previewTheme).layoutTemplate;
  });
  const [previewBackgroundStyle, setPreviewBackgroundStyle] = useState<BackgroundStyleId>(() => {
    return getLayoutThemeDefinition(previewTheme).backgroundStyle;
  });
  const [previewFrameStyle, setPreviewFrameStyle] = useState<FrameStyleId>(() => {
    return getLayoutThemeDefinition(previewTheme).frameStyle;
  });
  const [previewMotionStyle, setPreviewMotionStyle] = useState<MotionStyleId>(() => {
    return getLayoutThemeDefinition(previewTheme).motionStyle;
  });
  const [previewLayoutPack, setPreviewLayoutPack] = useState<LayoutPackId>(() => {
    return getLayoutThemeDefinition(previewTheme).packId;
  });
  const [brandColors, setBrandColors] = useState<string[]>(() => {
    try {
      const raw = JSON.parse(localStorage.getItem('aether_brand_colors') || '[]');
      return Array.isArray(raw) && raw.length ? raw.map((value: unknown) => String(value || '').trim()).filter(Boolean) : [...DEFAULT_BRAND_COLORS];
    } catch {
      return [...DEFAULT_BRAND_COLORS];
    }
  });
  const [swapPending, setSwapPending] = useState(() => localStorage.getItem('aether_layout_swapped') === 'true');
  const [smartLayoutEnabled, setSmartLayoutEnabled] = useState(() => localStorage.getItem('aether_smart_layout_enabled') !== 'false');
  const [luminaState, setLuminaState] = useState<NormalizedLuminaState>({
    event: 'idle',
    sceneName: null,
    contentMode: 'idle',
    hasProjectorContent: false,
    title: null,
    presenter: null,
    shouldAutoSwitch: true,
    payload: {},
    ts: Date.now(),
  });
  const [composerRenderMeta, setComposerRenderMeta] = useState<ComposerLayoutRenderMeta>(() => (
    computeComposerLayout({
      layoutTemplate: getLayoutThemeDefinition(DEFAULT_LAYOUT_THEME_ID).layoutTemplate,
      cameraLayerIds: [],
      canvasWidth: 1920,
      canvasHeight: 1080,
      maxComposedCameras: MAX_COMPOSED_CAMERAS,
      themeId: DEFAULT_LAYOUT_THEME_ID,
      backgroundStyle: getLayoutThemeDefinition(DEFAULT_LAYOUT_THEME_ID).backgroundStyle,
      frameStyle: getLayoutThemeDefinition(DEFAULT_LAYOUT_THEME_ID).frameStyle,
      motionStyle: getLayoutThemeDefinition(DEFAULT_LAYOUT_THEME_ID).motionStyle,
      aspectRatioBehavior: getLayoutThemeDefinition(DEFAULT_LAYOUT_THEME_ID).aspectRatioBehavior,
      safeMargins: getLayoutThemeDefinition(DEFAULT_LAYOUT_THEME_ID).safeMargins,
    }).renderMeta
  ));
  const [backgroundSourceLayerId, setBackgroundSourceLayerId] = useState<string | null>(null);
  const [intentDirectorOn, setIntentDirectorOn] = useState(() => localStorage.getItem('aether_intent_director_on') === 'true');
  const [intentDirectorStatus, setIntentDirectorStatus] = useState('Idle');
  const [intentCooldownMs, setIntentCooldownMs] = useState(() => Number(localStorage.getItem('aether_intent_cooldown_ms') || 1200));
  const [aiHealth, setAiHealth] = useState<AiHealthStatus | null>(null);

  const [transitionMode, setTransitionMode] = useState<'cut' | 'fade' | 'dip_white'>(() => {
    return (localStorage.getItem('aether_transition_mode') as any) || 'cut';
  });
  const [transitionMs, setTransitionMs] = useState(() => Number(localStorage.getItem('aether_transition_ms') || 300));
  const [transitionAlpha, setTransitionAlpha] = useState(0);

  const [peerMode, setPeerMode] = useState<'cloud' | 'custom'>(() => {
    return (localStorage.getItem('aether_peer_mode') as any) || 'cloud';
  });
  const [peerUiMode, setPeerUiMode] = useState<'auto' | 'local' | 'advanced'>(() => {
    return (localStorage.getItem('aether_peer_ui_mode') as any) || 'auto';
  });
  const [peerHost, setPeerHost] = useState(() => localStorage.getItem('aether_peer_host') || 'localhost');
  const [peerPort, setPeerPort] = useState(() => localStorage.getItem('aether_peer_port') || '9000');
  const [peerPath, setPeerPath] = useState(() => localStorage.getItem('aether_peer_path') || '/peerjs');
  const [peerSecure, setPeerSecure] = useState(() => {
    const raw = localStorage.getItem('aether_peer_secure');
    if (raw === null) return false;
    return raw === 'true';
  });

  const [roomId, setRoomId] = useState(() => {
    const saved = localStorage.getItem('aether_host_room_id');
    if (saved) return saved;
    const newId = generateRoomId();
    localStorage.setItem('aether_host_room_id', newId);
    return newId;
  });

  const normalizedLicenseKey = licenseKey.trim().toUpperCase();
  const localFormatValid =
    /^PRO_[A-Z0-9]{4}(?:-[A-Z0-9]{4}){1,3}$/.test(normalizedLicenseKey) ||
    /^PRO_[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(normalizedLicenseKey);
  const allowOfflinePro = (import.meta.env.VITE_ALLOW_OFFLINE_PRO as string | undefined) === 'true' || import.meta.env.DEV;
  const adminEmails = (import.meta.env.VITE_ADMIN_EMAILS as string | undefined || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  const isAdminByEmail = !!user?.email && adminEmails.includes(user.email.toLowerCase());
  const adminUnlocked = isAdminByEmail || !!adminToken;
  const isPro = licenseStatus.state === 'valid' ? true : (licenseStatus.state === 'invalid' ? false : (allowOfflinePro && localFormatValid));

  // --- REFS ---
  const activeCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const keepAliveRef = useRef<number | null>(null);
  const peerHttpKeepAliveRef = useRef<number | null>(null);
  const fatalRecoveryCountRef = useRef(0);
  const mobileCamLayerIdRef = useRef<string | null>(null);
  const localRecorderRef = useRef<MediaRecorder | null>(null);
  const localChunksRef = useRef<Blob[]>([]);
  const settingsPanelRef = useRef<HTMLDivElement | null>(null);
  const operatorRailRef = useRef<HTMLDivElement | null>(null);
  const inputRailScrollRef = useRef<HTMLDivElement | null>(null);
  const inputRailTrackRef = useRef<HTMLDivElement | null>(null);
  const layoutThemeLibraryRef = useRef<HTMLDetailsElement | null>(null);
  const inputRailScrollStateRef = useRef(inputRailScrollState);
  const inputRailThumbDragRef = useRef<{ trackTop: number; thumbHeight: number; dragOffset: number } | null>(null);
  const inputRailProgrammaticScrollRef = useRef(false);
  const operatorRailResizeRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const settingsDragRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);

  // Audio Refs
  const audioContext = useRef<AudioContext | null>(null);
  const audioDestination = useRef<MediaStreamAudioDestinationNode | null>(null);
  const audioSources = useRef<Map<string, MediaStreamAudioSourceNode>>(new Map());
  const audioGains = useRef<Map<string, GainNode>>(new Map());
  const audioFilters = useRef<Map<string, BiquadFilterNode>>(new Map());
  const audioCompressors = useRef<Map<string, DynamicsCompressorNode>>(new Map());
  const hyperGateNodes = useRef<Map<string, { input: GainNode; hp: BiquadFilterNode; analyser: AnalyserNode; gate: GainNode; }>>(new Map());
  const hyperGateState = useRef<Map<string, { isOpen: boolean; lastAboveMs: number; lastDb: number; }>>(new Map());
  const masterMixInput = useRef<GainNode | null>(null);
  const masterHighPass = useRef<BiquadFilterNode | null>(null);
  const masterPresence = useRef<BiquadFilterNode | null>(null);
  const masterAir = useRef<BiquadFilterNode | null>(null);
  const masterCompressor = useRef<DynamicsCompressorNode | null>(null);
  const masterLimiter = useRef<DynamicsCompressorNode | null>(null);
  const masterOutputGain = useRef<GainNode | null>(null);
  const masterMonitorGain = useRef<GainNode | null>(null);
  const audioMonitoringNodes = useRef<Map<string, GainNode>>(new Map());

  // Connection Refs
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamingSocketRef = useRef<WebSocket | null>(null);
  const peerRef = useRef<Peer | null>(null);
  const layersRef = useRef<Layer[]>([]);
  const cameraSourcesRef = useRef<CameraSource[]>([]);
  const cloudDisconnectTimerRef = useRef<number | null>(null);
  const cloudSyncTimerRef = useRef<number | null>(null);
  const mobileMetaRef = useRef<Map<string, { sourceId?: string; label?: string }>>(new Map());
  const phoneCallsRef = useRef<Map<string, MediaConnection>>(new Map());
  const phonePendingTimersRef = useRef<Map<string, number>>(new Map());
  const lowerThirdIdsRef = useRef<{ nameId?: string; titleId?: string }>({});
  const pinnedLayerIdRef = useRef<string | null>(null);
  const tickerLayerIdRef = useRef<string | null>(null);
  const autoDirectorTimerRef = useRef<number | null>(null);
  const liveIntentRef = useRef<boolean>(false);
  const liveStartGuardRef = useRef<number>(0);
  const transitionRafRef = useRef<number | null>(null);
  const transitionTokenRef = useRef<number>(0);
  const layoutTemplateRef = useRef<ComposerLayoutTemplate>(layoutTemplate);
  const layoutThemeRef = useRef<LayoutThemeId>(layoutTheme);
  const backgroundStyleRef = useRef<BackgroundStyleId>(backgroundStyle);
  const frameStyleRef = useRef<FrameStyleId>(frameStyle);
  const motionStyleRef = useRef<MotionStyleId>(motionStyle);
  const layoutPackRef = useRef<LayoutPackId>(layoutPack);
  const brandColorsRef = useRef<string[]>(brandColors);
  const swapPendingRef = useRef<boolean>(swapPending);
  const composerMainLayerIdRef = useRef<string | null>(composerMainLayerId);
  const smartLayoutEnabledRef = useRef<boolean>(smartLayoutEnabled);
  const previewThemeRef = useRef<LayoutThemeId>(previewTheme);
  const previewLayoutTemplateRef = useRef<ComposerLayoutTemplate>(previewLayoutTemplate);
  const previewBackgroundStyleRef = useRef<BackgroundStyleId>(previewBackgroundStyle);
  const previewFrameStyleRef = useRef<FrameStyleId>(previewFrameStyle);
  const previewMotionStyleRef = useRef<MotionStyleId>(previewMotionStyle);
  const previewLayoutPackRef = useRef<LayoutPackId>(previewLayoutPack);
  const appliedThemeRef = useRef<LayoutThemeId>(appliedTheme);
  const intentDirectorOnRef = useRef<boolean>(intentDirectorOn);
  const intentLastSwitchedAtRef = useRef<number>(0);
  const intentLastAppliedRef = useRef<BroadcastIntent | null>(null);
  const routeIntentSignalRef = useRef<(signalName: string, payload?: any) => void>(() => {});
  const hiddenByLayoutRef = useRef<number>(0);
  const streamHealthRef = useRef<{ bytes: number; drops: number; lastTs: number }>({ bytes: 0, drops: 0, lastTs: Date.now() });
  const streamHealthTimerRef = useRef<number | null>(null);
  const relayPingTimerRef = useRef<number | null>(null);
  const liveQualityRef = useRef<StreamQualityPreset>(streamQuality);
  const qualityDowngradeInFlightRef = useRef(false);
  const congestionWindowStartRef = useRef<number | null>(null);
  const congestionWarningShownRef = useRef(false);
  const encoderRetryInFlightRef = useRef(false);
  const encoderChunkStateRef = useRef<{ count: number; lastAt: number }>({ count: 0, lastAt: 0 });
  const encoderStartAtRef = useRef<number | null>(null);
  const streamSessionIdRef = useRef<string | null>(null);
  const telemetryLogIdRef = useRef<string | null>(null);
  const relayReconnectAttemptsRef = useRef<number>(0);
  const relayReconnectTotalRef = useRef<number>(0);
  const relayUptimeStartRef = useRef<number | null>(null);
  const relayBindErrorRef = useRef<string | null>(null);
  const pendingStartRef = useRef<{ streamKey: string; destinations: string[]; sent: boolean; sentAt: number | null } | null>(null);

  // --- EFFECTS ---
  const clampSettingsPos = useCallback((x: number, y: number) => {
    const panel = settingsPanelRef.current;
    const width = panel?.offsetWidth || 520;
    const height = panel?.offsetHeight || 600;
    const maxX = Math.max(8, window.innerWidth - width - 8);
    const maxY = Math.max(8, window.innerHeight - height - 8);
    return {
      x: Math.min(Math.max(8, x), maxX),
      y: Math.min(Math.max(8, y), maxY),
    };
  }, []);

  useEffect(() => {
    layersRef.current = layers;
  }, [layers]);

  useEffect(() => {
    cameraSourcesRef.current = cameraSources;
  }, [cameraSources]);

  useEffect(() => {
    layoutTemplateRef.current = layoutTemplate;
  }, [layoutTemplate]);

  useEffect(() => {
    layoutThemeRef.current = layoutTheme;
  }, [layoutTheme]);

  useEffect(() => {
    backgroundStyleRef.current = backgroundStyle;
  }, [backgroundStyle]);

  useEffect(() => {
    frameStyleRef.current = frameStyle;
  }, [frameStyle]);

  useEffect(() => {
    motionStyleRef.current = motionStyle;
  }, [motionStyle]);

  useEffect(() => {
    layoutPackRef.current = layoutPack;
  }, [layoutPack]);

  useEffect(() => {
    brandColorsRef.current = brandColors;
  }, [brandColors]);

  useEffect(() => {
    swapPendingRef.current = swapPending;
  }, [swapPending]);

  useEffect(() => {
    composerMainLayerIdRef.current = composerMainLayerId;
  }, [composerMainLayerId]);

  useEffect(() => {
    smartLayoutEnabledRef.current = smartLayoutEnabled;
  }, [smartLayoutEnabled]);

  useEffect(() => {
    previewThemeRef.current = previewTheme;
  }, [previewTheme]);

  useEffect(() => {
    previewLayoutTemplateRef.current = previewLayoutTemplate;
  }, [previewLayoutTemplate]);

  useEffect(() => {
    previewBackgroundStyleRef.current = previewBackgroundStyle;
  }, [previewBackgroundStyle]);

  useEffect(() => {
    previewFrameStyleRef.current = previewFrameStyle;
  }, [previewFrameStyle]);

  useEffect(() => {
    previewMotionStyleRef.current = previewMotionStyle;
  }, [previewMotionStyle]);

  useEffect(() => {
    previewLayoutPackRef.current = previewLayoutPack;
  }, [previewLayoutPack]);

  useEffect(() => {
    appliedThemeRef.current = appliedTheme;
  }, [appliedTheme]);

  useEffect(() => {
    intentDirectorOnRef.current = intentDirectorOn;
  }, [intentDirectorOn]);

  const refreshAiHealth = useCallback(async () => {
    const next = await checkAiAvailability().catch(() => ({
      ok: false,
      reason: 'unreachable',
      baseUrl: '',
      isLocal: true,
    } satisfies AiHealthStatus));
    setAiHealth(next);
    return next;
  }, []);

  useEffect(() => {
    if (rightPanelTab !== 'ai' && rightPanelTab !== 'inputs') return;
    void refreshAiHealth();
  }, [rightPanelTab, refreshAiHealth]);

  useEffect(() => {
    const handleWindowResize = () => {
      setWindowViewport({ width: window.innerWidth, height: window.innerHeight });
    };
    window.addEventListener('resize', handleWindowResize);
    return () => window.removeEventListener('resize', handleWindowResize);
  }, []);

  useEffect(() => {
    localStorage.setItem('aether_operator_rail_width', String(operatorRailWidth));
  }, [operatorRailWidth]);

  useEffect(() => {
    inputRailScrollStateRef.current = inputRailScrollState;
  }, [inputRailScrollState]);

  const syncOperatorRailSize = useCallback(() => {
    const rail = operatorRailRef.current;
    if (!rail) return;
    const width = rail.clientWidth || 0;
    const height = rail.clientHeight || 0;
    setOperatorRailSize((prev) => (prev.width === width && prev.height === height ? prev : { width, height }));
  }, []);

  const collectInputRailGlobalContext = useCallback(() => {
    const outerRail = inputRailScrollRef.current;
    const emptySegments: GlobalScrollSegments = { segments: [], totalScrollable: 0 };
    if (!outerRail) {
      return {
        nodes: [] as Array<{ id: string; element: HTMLElement }>,
        snapshots: [] as Array<{ id: string; maxScrollTop: number; scrollTop: number }>,
        segments: emptySegments,
        outerClientHeight: 0,
      };
    }

    // The outer slider scrolls the outer rail container, bringing sections
    // into view. Each section has its own inner scroll for its content.
    const nodes: Array<{ id: string; element: HTMLElement }> = [
      { id: INPUT_RAIL_OUTER_SCROLL_ID, element: outerRail },
    ];

    const snapshots = nodes.map((node) => ({
      id: node.id,
      maxScrollTop: Math.max(0, node.element.scrollHeight - node.element.clientHeight),
      scrollTop: Math.max(0, node.element.scrollTop || 0),
    }));
    const segments = buildGlobalScrollSegments({ nodes: snapshots });

    return {
      nodes,
      snapshots,
      segments,
      outerClientHeight: outerRail.clientHeight || 0,
    };
  }, []);

  const syncInputRailScrollState = useCallback(() => {
    const trackHeight = inputRailTrackRef.current?.clientHeight || inputRailScrollRef.current?.clientHeight || 0;
    const {
      snapshots,
      segments,
      outerClientHeight,
    } = collectInputRailGlobalContext();

    const globalProgress = mapGlobalNodeScrollTopToProgress({
      nodes: snapshots,
      segments,
    });
    const maxScrollTop = Math.max(0, segments.totalScrollable);
    const nextState = computeOperatorRailScrollState({
      clientHeight: outerClientHeight,
      scrollHeight: outerClientHeight + maxScrollTop,
      scrollTop: globalProgress * maxScrollTop,
      trackHeight,
      minThumbHeight: 56,
    });
    setInputRailScrollState(nextState);
  }, [collectInputRailGlobalContext]);

  const applyInputRailGlobalProgress = useCallback((progress: number) => {
    const {
      nodes,
      snapshots,
      segments,
    } = collectInputRailGlobalContext();
    if (segments.totalScrollable <= 0) {
      syncInputRailScrollState();
      return;
    }

    const nextById = mapGlobalProgressToNodeScrollTop({
      nodes: snapshots,
      segments,
      progress,
    });
    inputRailProgrammaticScrollRef.current = true;
    nodes.forEach((node) => {
      const nextTop = Math.max(0, nextById[node.id] || 0);
      if (Math.abs(node.element.scrollTop - nextTop) > 0.5) {
        node.element.scrollTop = nextTop;
      }
    });
    window.requestAnimationFrame(() => {
      inputRailProgrammaticScrollRef.current = false;
      syncInputRailScrollState();
    });
  }, [collectInputRailGlobalContext, syncInputRailScrollState]);

  useEffect(() => {
    syncOperatorRailSize();
    const rail = operatorRailRef.current;
    if (!rail) return;
    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => syncOperatorRailSize());
      resizeObserver.observe(rail);
    }
    return () => resizeObserver?.disconnect();
  }, [syncOperatorRailSize]);

  useEffect(() => {
    if (rightPanelTab !== 'inputs') return;
    const raf = window.requestAnimationFrame(() => {
      syncOperatorRailSize();
      syncInputRailScrollState();
    });
    return () => window.cancelAnimationFrame(raf);
  }, [rightPanelTab, inputsSection, composerMode, syncInputRailScrollState, syncOperatorRailSize]);

  useEffect(() => {
    if (rightPanelTab !== 'inputs') return;
    const outerRail = inputRailScrollRef.current;
    if (!outerRail) return;
    const handleScroll = () => {
      if (inputRailProgrammaticScrollRef.current) return;
      syncInputRailScrollState();
    };
    // Capture-phase listener on the outer container catches scroll from all
    // descendants (outer rail + any inner .input-section-scroll) without
    // needing a snapshot list of targets.
    outerRail.addEventListener('scroll', handleScroll, { capture: true, passive: true });
    handleScroll();
    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => syncInputRailScrollState());
      resizeObserver.observe(outerRail);
      outerRail.querySelectorAll<HTMLElement>('.input-section-scroll').forEach((el) => resizeObserver?.observe(el));
      if (inputRailTrackRef.current) resizeObserver.observe(inputRailTrackRef.current);
    }
    const raf = window.requestAnimationFrame(() => syncInputRailScrollState());
    return () => {
      inputRailThumbDragRef.current = null;
      window.cancelAnimationFrame(raf);
      outerRail.removeEventListener('scroll', handleScroll, { capture: true });
      resizeObserver?.disconnect();
    };
  }, [rightPanelTab, inputsSection, composerMode, syncInputRailScrollState]);

  // When the active IN section changes, scroll the outer rail to reveal the newly
  // opened section so it is never hidden below the viewport.
  useEffect(() => {
    if (!inputsSection) return;
    const outerRail = inputRailScrollRef.current;
    if (!outerRail) return;
    const raf = window.requestAnimationFrame(() => {
      const openDetails = outerRail.querySelector<HTMLDetailsElement>('details[open]');
      if (openDetails) {
        openDetails.scrollIntoView({ block: 'nearest' });
      }
    });
    return () => window.cancelAnimationFrame(raf);
  }, [inputsSection]);

  useEffect(() => {
    const handlePointerMove = (event: MouseEvent) => {
      if (operatorRailResizeRef.current) {
        const deltaX = operatorRailResizeRef.current.startX - event.clientX;
        const nextWidth = Math.max(
          MIN_OPERATOR_RAIL_WIDTH,
          Math.min(MAX_OPERATOR_RAIL_WIDTH, Math.round(operatorRailResizeRef.current.startWidth + deltaX))
        );
        setOperatorRailWidth(nextWidth);
      }

      const thumbDrag = inputRailThumbDragRef.current;
      const scrollState = inputRailScrollStateRef.current;
      const track = inputRailTrackRef.current;
      if (thumbDrag && track) {
        const maxThumbTop = Math.max(0, track.clientHeight - thumbDrag.thumbHeight);
        const nextThumbTop = Math.max(
          0,
          Math.min(maxThumbTop, event.clientY - thumbDrag.trackTop - thumbDrag.dragOffset)
        );
        if (scrollState.overflow) {
          const progress = maxThumbTop <= 0 ? 0 : nextThumbTop / maxThumbTop;
          applyInputRailGlobalProgress(progress);
        }
      }
    };

    const handlePointerUp = () => {
      operatorRailResizeRef.current = null;
      inputRailThumbDragRef.current = null;
    };

    window.addEventListener('mousemove', handlePointerMove);
    window.addEventListener('mouseup', handlePointerUp);
    return () => {
      window.removeEventListener('mousemove', handlePointerMove);
      window.removeEventListener('mouseup', handlePointerUp);
    };
  }, [applyInputRailGlobalProgress]);

  const handleSettingsDrag = useCallback((e: MouseEvent) => {
    const drag = settingsDragRef.current;
    if (!drag) return;
    const next = clampSettingsPos(drag.originX + (e.clientX - drag.startX), drag.originY + (e.clientY - drag.startY));
    setSettingsPos(next);
  }, [clampSettingsPos]);

  const endSettingsDrag = useCallback(() => {
    settingsDragRef.current = null;
    window.removeEventListener('mousemove', handleSettingsDrag);
    window.removeEventListener('mouseup', endSettingsDrag);
  }, [handleSettingsDrag]);

  const startSettingsDrag = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest('[data-no-drag]')) return;
    e.preventDefault();
    settingsDragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      originX: settingsPos.x,
      originY: settingsPos.y,
    };
    window.addEventListener('mousemove', handleSettingsDrag);
    window.addEventListener('mouseup', endSettingsDrag);
  }, [endSettingsDrag, handleSettingsDrag, settingsPos.x, settingsPos.y]);

  useEffect(() => {
    if (!showSettings) return;
    const timer = window.setTimeout(() => {
      setSettingsPos(prev => {
        if (prev.x !== 0 || prev.y !== 0) return prev;
        return clampSettingsPos(window.innerWidth - 560, 80);
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [showSettings, clampSettingsPos]);

  useEffect(() => {
    if (!showSettings) {
      endSettingsDrag();
    }
  }, [showSettings, endSettingsDrag]);

  // Audio Context Resume
  useEffect(() => {
    const resumeAudio = () => {
      if (audioContext.current?.state === 'suspended') {
        audioContext.current.resume().catch(() => { });
      }
    };
    window.addEventListener('click', resumeAudio);
    window.addEventListener('keydown', resumeAudio);
    return () => {
      window.removeEventListener('click', resumeAudio);
      window.removeEventListener('keydown', resumeAudio);
    };
  }, []);

  // Persist Settings
  useEffect(() => {
    localStorage.setItem('aether_stream_key', streamKey);
  }, [streamKey]);

  useEffect(() => {
    localStorage.setItem('aether_license_key', normalizedLicenseKey);
  }, [normalizedLicenseKey]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (adminToken) {
      sessionStorage.setItem('aether_admin_token', adminToken);
    } else {
      sessionStorage.removeItem('aether_admin_token');
    }
  }, [adminToken]);

  useEffect(() => {
    localStorage.setItem('aether_wifi_mode', wifiMode ? 'true' : 'false');
  }, [wifiMode]);

  useEffect(() => {
    liveQualityRef.current = streamQuality;
  }, [streamQuality]);

  useEffect(() => {
    localStorage.setItem('aether_auto_director', String(autoDirectorOn));
    localStorage.setItem('aether_auto_director_interval', String(autoDirectorInterval || 12));
    localStorage.setItem('aether_auto_director_mode', autoDirectorMode);
    localStorage.setItem('aether_intent_director_on', String(intentDirectorOn));
    localStorage.setItem('aether_intent_cooldown_ms', String(intentCooldownMs || 1200));
  }, [autoDirectorOn, autoDirectorInterval, autoDirectorMode, intentDirectorOn, intentCooldownMs]);

  useEffect(() => {
    localStorage.setItem('aether_layout_theme', layoutTheme);
    localStorage.setItem('aether_preview_theme', previewTheme);
    localStorage.setItem('aether_applied_theme', appliedTheme);
    localStorage.setItem('aether_background_style', backgroundStyle);
    localStorage.setItem('aether_frame_style', frameStyle);
    localStorage.setItem('aether_motion_style', motionStyle);
    localStorage.setItem('aether_layout_pack', layoutPack);
    localStorage.setItem('aether_layout_swapped', swapPending ? 'true' : 'false');
    localStorage.setItem('aether_smart_layout_enabled', smartLayoutEnabled ? 'true' : 'false');
    localStorage.setItem('aether_brand_colors', JSON.stringify(brandColors));
  }, [
    layoutTheme,
    previewTheme,
    appliedTheme,
    backgroundStyle,
    frameStyle,
    motionStyle,
    layoutPack,
    swapPending,
    smartLayoutEnabled,
    brandColors,
  ]);

  useEffect(() => {
    localStorage.setItem('aether_lower_third_name', lowerThirdName);
    localStorage.setItem('aether_lower_third_title', lowerThirdTitle);
    localStorage.setItem('aether_lt_duration', String(lowerThirdDuration));
    localStorage.setItem('aether_lt_accent', lowerThirdAccentColor);
    localStorage.setItem('aether_lt_presets', JSON.stringify(lowerThirdPresets));
  }, [lowerThirdName, lowerThirdTitle, lowerThirdDuration, lowerThirdAccentColor, lowerThirdPresets]);

  useEffect(() => {
    localStorage.setItem('aether_pinned_message', pinnedMessage);
    localStorage.setItem('aether_ticker_message', tickerMessage);
    localStorage.setItem('aether_audience_messages', JSON.stringify(audienceMessages));
    localStorage.setItem('aether_monitor_volume', String(masterMonitorVolume));
  }, [pinnedMessage, tickerMessage, audienceMessages, masterMonitorVolume]);

  useEffect(() => {
    const handleOutputChange = (e: any) => {
      const deviceId = e.detail?.deviceId;
      if (deviceId) {
        setOutputDeviceId(deviceId);
        applySinkId(deviceId);
      }
    };
    window.addEventListener('aether:audio-output-change', handleOutputChange);
    return () => window.removeEventListener('aether:audio-output-change', handleOutputChange);
  }, []);

  const applySinkId = async (deviceId: string) => {
    try {
      const ctx = audioContext.current;
      if (ctx && (ctx as any).setSinkId) {
        await (ctx as any).setSinkId(deviceId);
        console.log("AudioContext SinkId applied:", deviceId);
      }
    } catch (err) {
      console.error("Failed to set audio sink ID", err);
    }
  };

  useEffect(() => {
    localStorage.setItem('aether_stream_destinations', JSON.stringify(destinations));
  }, [destinations]);

  useEffect(() => {
    localStorage.setItem('aether_scene_presets', JSON.stringify(scenePresets));
  }, [scenePresets]);

  useEffect(() => {
    localStorage.setItem('aether_transition_mode', transitionMode);
    localStorage.setItem('aether_transition_ms', String(transitionMs || 300));
  }, [transitionMode, transitionMs]);

  // UI Tab Switching — only auto-switch to Properties when user clicks the canvas,
  // NOT when makeMain or other code updates the selectedLayerId while on Inputs.
  useEffect(() => {
    if (selectedLayerId && rightPanelTab !== 'inputs') setRightPanelTab('properties');
  }, [selectedLayerId]);

  // Status Message Auto-Dismiss
  useEffect(() => {
    if (statusMsg && !statusMsg.persistent) {
      const timer = setTimeout(() => setStatusMsg(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [statusMsg]);

  useEffect(() => {
    if (!desktopUpdater?.onUpdateStatus) return;
    const off = desktopUpdater.onUpdateStatus((status) => {
      if (!status?.type) return;
      if (status.type === 'checking') {
        setStatusMsg({ type: 'info', text: 'Checking for updates...' });
        return;
      }
      if (status.type === 'available') {
        const v = status.version ? ` ${status.version}` : '';
        setStatusMsg({ type: 'info', text: `Update available${v}. Downloading...` });
        return;
      }
      if (status.type === 'downloading') {
        const pct = Number(status.percent || 0);
        setStatusMsg({ type: 'info', text: `Downloading update... ${pct.toFixed(1)}%` });
        return;
      }
      if (status.type === 'downloaded') {
        const v = status.version ? ` ${status.version}` : '';
        setStatusMsg({ type: 'info', text: `Update${v} downloaded. Restart to install.` });
        return;
      }
      if (status.type === 'not-available') {
        setStatusMsg({ type: 'info', text: 'You are on the latest version.' });
        return;
      }
      if (status.type === 'error') {
        setStatusMsg({ type: 'error', text: status.message || 'Update check failed.' });
      }
    });
    return () => {
      try { off?.(); } catch { }
    };
  }, [desktopUpdater]);

  useEffect(() => {
    if (!normalizedLicenseKey) {
      setLicenseStatus({ state: 'idle' });
      return;
    }
    if (!localFormatValid) {
      setLicenseStatus({ state: 'invalid', message: 'Invalid key format.', source: 'offline' });
      return;
    }
    let cancelled = false;
    setLicenseStatus({ state: 'checking' });
    const timer = window.setTimeout(async () => {
      const res = await verifyLicenseKey(normalizedLicenseKey);
      if (cancelled) return;
      if (res.source === 'server') {
        setLicenseStatus(res.ok && res.pro ? { state: 'valid', message: res.message, source: 'server' } : { state: 'invalid', message: res.message || 'License not valid.', source: 'server' });
        return;
      }
      if (allowOfflinePro && localFormatValid) {
        setLicenseStatus({ state: 'valid', message: 'Offline validation (dev mode).', source: 'offline' });
        return;
      }
      setLicenseStatus({ state: 'error', message: 'License server unreachable.', source: 'offline' });
    }, 450);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [normalizedLicenseKey, localFormatValid, allowOfflinePro]);

  const handleIssueLicense = useCallback(async () => {
    if (!adminToken) {
      setIssueStatus({ state: 'error', message: 'Admin token required.' });
      return;
    }
    setIssueStatus({ state: 'issuing' });
    const res = await issueLicenseKey({
      token: adminToken,
      email: issueEmail?.trim(),
      days: issueDays,
      plan: "pro",
    });
    if (!res.ok || !res.key) {
      setIssueStatus({ state: 'error', message: res.message || 'Failed to issue license.' });
      return;
    }
    setIssueStatus({ state: 'ok', key: res.key, message: 'License issued.' });
    try {
      await navigator.clipboard?.writeText(res.key);
    } catch { }
  }, [adminToken, issueDays, issueEmail]);

  useEffect(() => {
    if (streamHealthTimerRef.current) {
      window.clearInterval(streamHealthTimerRef.current);
      streamHealthTimerRef.current = null;
    }
    if (streamStatus !== StreamStatus.LIVE) {
      setStreamHealth((prev) => ({ ...prev, kbps: 0, drops: 0, queueKb: 0 }));
      streamHealthRef.current = { bytes: 0, drops: 0, lastTs: Date.now() };
      congestionWindowStartRef.current = null;
      congestionWarningShownRef.current = false;
      qualityDowngradeInFlightRef.current = false;
      encoderRetryInFlightRef.current = false;
      encoderChunkStateRef.current = { count: 0, lastAt: 0 };
      pendingStartRef.current = null;
      encoderStartAtRef.current = null;
      resetEncoderBootstrap('inactive');
      return;
    }

    streamHealthRef.current = { bytes: 0, drops: 0, lastTs: Date.now() };
    streamHealthTimerRef.current = window.setInterval(() => {
      const now = Date.now();
      const elapsed = Math.max(1, (now - streamHealthRef.current.lastTs) / 1000);
      const kbps = Math.round((streamHealthRef.current.bytes * 8) / 1000 / elapsed);
      const queueKb = Math.round((streamingSocketRef.current?.bufferedAmount || 0) / 1024);
      setStreamHealth((prev) => ({
        ...prev,
        kbps,
        drops: streamHealthRef.current.drops,
        queueKb,
      }));
      streamHealthRef.current.bytes = 0;
      streamHealthRef.current.lastTs = now;
    }, 1000);

    return () => {
      if (streamHealthTimerRef.current) {
        window.clearInterval(streamHealthTimerRef.current);
        streamHealthTimerRef.current = null;
      }
    };
  }, [streamStatus]);

  useEffect(() => {
    if (relayPingTimerRef.current) {
      window.clearInterval(relayPingTimerRef.current);
      relayPingTimerRef.current = null;
    }
    if (!relayConnected) {
      setStreamHealth((prev) => ({ ...prev, rttMs: null }));
      return;
    }
    relayPingTimerRef.current = window.setInterval(() => {
      const ws = streamingSocketRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify({ type: "ping", t: Date.now(), token: import.meta.env.VITE_RELAY_TOKEN }));
    }, 5000);
    return () => {
      if (relayPingTimerRef.current) {
        window.clearInterval(relayPingTimerRef.current);
        relayPingTimerRef.current = null;
      }
    };
  }, [relayConnected]);

  useEffect(() => {
    if (lowerThirdVisible) ensureLowerThirdLayers();
    updateLowerThirdContent();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lowerThirdName, lowerThirdTitle]);

  useEffect(() => {
    const id = pinnedLayerIdRef.current;
    if (!id) return;
    setLayers(prev => prev.map(l => l.id === id ? { ...l, content: pinnedMessage } : l));
  }, [pinnedMessage]);

  useEffect(() => {
    const id = tickerLayerIdRef.current;
    if (!id) return;
    setLayers(prev => prev.map(l => l.id === id ? { ...l, content: tickerMessage } : l));
  }, [tickerMessage]);

  // Video Resolution Event Listener
  useEffect(() => {
    const onSize = (e: Event) => {
      const evt = e as CustomEvent<{ layerId: string; width: number; height: number }>;
      const mobileId = mobileCamLayerIdRef.current;
      if (!mobileId) return;

      if (evt.detail?.layerId === mobileId) {
        setIncomingRes(`${evt.detail.width}×${evt.detail.height}`);
      }
    };
    window.addEventListener("aether:video-size", onSize as any);
    return () => window.removeEventListener("aether:video-size", onSize as any);
  }, []);

  // --- AUDIO ENGINE ---
  useEffect(() => {
    if (!audioContext.current) {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      audioContext.current = new AudioContextClass();
      audioDestination.current = audioContext.current.createMediaStreamDestination();

      // Initialize Master Monitor
      masterMonitorGain.current = audioContext.current.createGain();
      masterMonitorGain.current.connect(audioContext.current.destination);

      // Master stream bus: subtle voice polish + compressor/limiter for stable output.
      masterMixInput.current = audioContext.current.createGain();
      masterHighPass.current = audioContext.current.createBiquadFilter();
      masterHighPass.current.type = 'highpass';
      masterHighPass.current.frequency.value = 55;
      masterHighPass.current.Q.value = 0.707;

      masterPresence.current = audioContext.current.createBiquadFilter();
      masterPresence.current.type = 'peaking';
      masterPresence.current.frequency.value = 2800;
      masterPresence.current.Q.value = 0.9;
      masterPresence.current.gain.value = 1.8;

      masterAir.current = audioContext.current.createBiquadFilter();
      masterAir.current.type = 'highshelf';
      masterAir.current.frequency.value = 7600;
      masterAir.current.gain.value = 1.2;

      masterCompressor.current = audioContext.current.createDynamicsCompressor();
      masterCompressor.current.threshold.value = -18;
      masterCompressor.current.knee.value = 18;
      masterCompressor.current.ratio.value = 3;
      masterCompressor.current.attack.value = 0.004;
      masterCompressor.current.release.value = 0.16;

      masterLimiter.current = audioContext.current.createDynamicsCompressor();
      masterLimiter.current.threshold.value = -3.5;
      masterLimiter.current.knee.value = 0;
      masterLimiter.current.ratio.value = 20;
      masterLimiter.current.attack.value = 0.0015;
      masterLimiter.current.release.value = 0.08;

      masterOutputGain.current = audioContext.current.createGain();
      masterOutputGain.current.gain.value = 1.03;

      masterMixInput.current.connect(masterHighPass.current);
      masterHighPass.current.connect(masterPresence.current);
      masterPresence.current.connect(masterAir.current);
      masterAir.current.connect(masterCompressor.current);
      masterCompressor.current.connect(masterLimiter.current);
      masterLimiter.current.connect(masterOutputGain.current);
      masterOutputGain.current.connect(audioDestination.current);

      // Apply initial sinkId if supported
      if (outputDeviceId && (audioContext.current as any).setSinkId) {
        (audioContext.current as any).setSinkId(outputDeviceId).catch(() => { });
      }
    }
    const ctx = audioContext.current;
    const dest = audioDestination.current;
    const monitorMaster = masterMonitorGain.current;
    const mixInput = masterMixInput.current;
    if (!ctx || !dest || !monitorMaster || !mixInput) return;

    // Update Master Monitor Volume
    monitorMaster.gain.setTargetAtTime(masterMonitorVolume / 100, ctx.currentTime, 0.05);

    // Cleanup removed tracks
    const currentIds = new Set(audioTracks.map(t => t.id));
    audioSources.current.forEach((_, id) => {
      if (!currentIds.has(id)) {
        audioSources.current.get(id)?.disconnect();
        audioGains.current.get(id)?.disconnect();
        audioFilters.current.get(id)?.disconnect();
        audioCompressors.current.get(id)?.disconnect();
        audioMonitoringNodes.current.get(id)?.disconnect();

        audioSources.current.delete(id);
        audioGains.current.delete(id);
        audioFilters.current.delete(id);
        audioCompressors.current.delete(id);
        audioMonitoringNodes.current.delete(id);
        hyperGateNodes.current.delete(id);
        hyperGateState.current.delete(id);
      }
    });

    // Add/Update tracks
    audioTracks.forEach(track => {
      if (!track.stream) return;

      if (!audioSources.current.has(track.id)) {
        const source = ctx.createMediaStreamSource(track.stream);

        // HyperGate Chain
        const hg = createHyperGateChain(ctx);
        source.connect(hg.input);

        // Filter & Gain
        const filter = ctx.createBiquadFilter();
        const compressor = ctx.createDynamicsCompressor();
        const gain = ctx.createGain();
        const monitorGain = ctx.createGain();
        applyTrackTone(filter, compressor, track.isMic);

        hg.gate.connect(filter);
        filter.connect(compressor);
        compressor.connect(gain);
        gain.connect(mixInput);

        // Monitoring path
        gain.connect(monitorGain);
        // We only connect monitorGain to monitorMaster if monitoring is enabled
        if (track.monitoring) {
          monitorGain.connect(monitorMaster);
        }

        audioSources.current.set(track.id, source);
        audioGains.current.set(track.id, gain);
        audioFilters.current.set(track.id, filter);
        audioCompressors.current.set(track.id, compressor);
        audioMonitoringNodes.current.set(track.id, monitorGain);
        hyperGateNodes.current.set(track.id, hg);
      }

      const filterNode = audioFilters.current.get(track.id);
      const compressorNode = audioCompressors.current.get(track.id);
      if (filterNode && compressorNode) {
        applyTrackTone(filterNode, compressorNode, track.isMic);
      }

      const gainNode = audioGains.current.get(track.id);
      if (gainNode) {
        gainNode.gain.setTargetAtTime(track.muted ? 0 : (track.volume / 100), ctx.currentTime, 0.05);
      }

      const monGain = audioMonitoringNodes.current.get(track.id);
      if (monGain) {
        // Handle dynamic monitoring toggle
        try { monGain.disconnect(monitorMaster); } catch { }
        if (track.monitoring && !track.muted) {
          monGain.connect(monitorMaster);
        }
      }
    });

    if (ctx.state === 'suspended') ctx.resume().catch(() => { });
  }, [audioTracks, masterMonitorVolume]);

  // HyperGate Processing Loop
  useEffect(() => {
    const ctx = audioContext.current;
    if (!ctx) return;

    const timer = window.setInterval(() => {
      const now = Date.now();
      hyperGateNodes.current.forEach((nodes, trackId) => {
        const track = audioTracks.find(t => t.id === trackId);
        const st = hyperGateState.current.get(trackId) || { isOpen: true, lastAboveMs: now, lastDb: -120 };
        if (!track) return;

        if (!track.noiseCancellation) {
          if (!st.isOpen) {
            nodes.gate.gain.setTargetAtTime(1, ctx.currentTime, 0.03);
            st.isOpen = true;
          }
          st.lastAboveMs = now;
          st.lastDb = -120;
          hyperGateState.current.set(trackId, st);
          return;
        }

        const db = rmsDbFromAnalyser(nodes.analyser);
        st.lastDb = db;

        const openThresholdDb = -50;
        const closeThresholdDb = -56;
        const holdMs = 320;
        const openGain = 1.0;
        const closedGain = 0.18;
        const attack = 0.03;
        const release = 0.20;

        if (db > openThresholdDb) {
          st.lastAboveMs = now;
          if (!st.isOpen) {
            nodes.gate.gain.setTargetAtTime(openGain, ctx.currentTime, attack);
            st.isOpen = true;
          }
        } else {
          const since = now - st.lastAboveMs;
          if (since > holdMs && st.isOpen && db < closeThresholdDb) {
            nodes.gate.gain.setTargetAtTime(closedGain, ctx.currentTime, release);
            st.isOpen = false;
          }
        }
        hyperGateState.current.set(trackId, st);
      });
    }, 60);
    return () => window.clearInterval(timer);
  }, [audioTracks]);

  // --- PEERJS SIGNALING ---
  useEffect(() => {
    const myPeerId = getCleanPeerId(roomId, "host");
    const peerEnv = getPeerEnv();

    const rotateRoomId = () => {
      const newId = generateRoomId();
      localStorage.setItem("aether_host_room_id", newId);
      setRoomId(newId);
      setStatusMsg({ type: "info", text: "Room ID was in use. New room generated." });
    };

    const scheduleCloudOffline = () => {
      if (cloudDisconnectTimerRef.current) window.clearTimeout(cloudDisconnectTimerRef.current);
      cloudDisconnectTimerRef.current = window.setTimeout(() => {
        setCloudConnected(false);
        setStatusMsg({ type: "warn", text: "Cloud disconnected. Reconnecting..." });
      }, 1500);
    };

    const clearCloudOffline = () => {
      if (cloudDisconnectTimerRef.current) {
        window.clearTimeout(cloudDisconnectTimerRef.current);
        cloudDisconnectTimerRef.current = null;
      }
    };

    // Cleanup old peer if ID changed
    const existing: any = peerRef.current;
    if (existing && !existing.destroyed && existing.id !== myPeerId) {
      try { existing.destroy(); } catch { }
      peerRef.current = null;
    }

    // Keepalive loop
    if (keepAliveRef.current) {
      window.clearInterval(keepAliveRef.current);
      keepAliveRef.current = null;
    }

    // Reuse existing peer if valid
    const stillAlive: any = peerRef.current;
    if (stillAlive && !stillAlive.destroyed && stillAlive.id === myPeerId) {
      if (stillAlive.id) setPeerId(stillAlive.id);
      if (!stillAlive.disconnected) {
        setCloudConnected(true);
        setCloudError(null);
      }
    } else {
      // Create new Peer
      const peer = new Peer(myPeerId, {
        debug: 1,
        host: peerEnv.host,
        port: peerEnv.port,
        path: peerEnv.path,
        secure: peerEnv.secure,
        config: {
          iceServers: [
            { urls: "stun:stun.l.google.com:19302" },
            { urls: "stun:stun1.l.google.com:19302" },
          ],
        },
      });
      peerRef.current = peer;

      peer.on("open", (id) => {
        setPeerId(id);
        clearCloudOffline();
        setCloudConnected(true);
        setCloudError(null);
        setStatusMsg({ type: "info", text: "Cloud Online." });
      });

      peer.on("disconnected", () => {
        scheduleCloudOffline();
        try { (peer as any).reconnect?.(); } catch { }
      });

      peer.on("close", () => {
        clearCloudOffline();
        setCloudConnected(false);
        setStatusMsg({ type: "warn", text: "Cloud closed." });
      });

      peer.on("error", (err: any) => {
        console.error("[Cloud] Error:", err?.type, err?.message, err);
        scheduleCloudOffline();
        setCloudError(err?.type || "error");
        if (err?.type === "unavailable-id") {
          rotateRoomId();
        }
      });

      peer.on("connection", (conn) => {
        conn.on("data", (data: any) => {
          if (data?.type === "mobile-handshake") {
            mobileMetaRef.current.set(conn.peer, {
              sourceId: data.sourceId,
              label: data.label,
            });
          } else if (data?.type === "audience-message" && data.text) {
            const category = data.category || "Message";
            const formatted = `[${category}] ${data.text}`;
            setAudienceMessages(prev => [...prev, formatted]);
            setStatusMsg({ type: "info", text: `New audience message received: ${category}` });
            routeIntentSignalRef.current('audience.message', { category, text: data.text });
          }
        });
      });

      peer.on("call", (call) => {
        setStatusMsg({ type: "info", text: "Mobile Camera Incoming..." });
        const getSourceMeta = () => {
          const metaFromCall: any = (call as any).metadata || {};
          const metaFromConn = mobileMetaRef.current.get(call.peer) || {};
          const sourceId = metaFromCall.sourceId || metaFromConn.sourceId;
          const label = metaFromCall.label || metaFromConn.label || "Phone Cam";
          return { sourceId, label };
        };
        const registerSourceCall = (sourceId?: string) => {
          if (!sourceId) return;
          const existing = phoneCallsRef.current.get(sourceId);
          if (existing && existing !== call) {
            try { existing.close(); } catch { }
          }
          phoneCallsRef.current.set(sourceId, call);
        };
        const markSourceDisconnected = (sourceId?: string) => {
          if (!sourceId) return;
          const activeCall = phoneCallsRef.current.get(sourceId);
          if (activeCall && activeCall !== call) return;
          phoneCallsRef.current.delete(sourceId);
          setCameraSources(prev => prev.map((s) => {
            if (s.id !== sourceId) return s;
            if (s.stream) {
              try { s.stream.getTracks().forEach((t) => t.stop()); } catch { }
            }
            return { ...s, status: 'failed', stream: undefined, peerId: undefined };
          }));
          setLayers(prev => {
            const source = cameraSourcesRef.current.find((s) => s.id === sourceId);
            if (!source?.layerId) return prev;
            return prev.map((l) => l.id === source.layerId ? { ...l, src: undefined } : l);
          });
          setAudioTracks(prev => prev.map((t) => t.id === `mobile-mic-${sourceId}` ? { ...t, stream: undefined, muted: true } : t));
        };
        const initialMeta = getSourceMeta();
        registerSourceCall(initialMeta.sourceId);
        call.answer();
        call.on("stream", (remoteStream) => {
          const meta = getSourceMeta();
          const sourceId = meta.sourceId || generateId();
          const label = meta.label;
          registerSourceCall(sourceId);
          handleMobileStream(remoteStream, sourceId, label, call.peer);
        });
        call.on("close", () => {
          const meta = getSourceMeta();
          markSourceDisconnected(meta.sourceId);
          mobileMetaRef.current.delete(call.peer);
        });
        call.on("error", () => {
          const meta = getSourceMeta();
          markSourceDisconnected(meta.sourceId);
          mobileMetaRef.current.delete(call.peer);
        });
      });
    }

    // Keepalive Interval
    keepAliveRef.current = window.setInterval(() => {
      const p: any = peerRef.current;
      if (!p) return;
      if (p.disconnected) {
        try { p.reconnect(); } catch { }
      }
    }, 5000);

    // PeerJS server HTTP keep-alive — prevents Render free-tier from sleeping
    if (peerHttpKeepAliveRef.current) window.clearInterval(peerHttpKeepAliveRef.current);
    const peerHttpBase = `http${peerEnv.secure ? 's' : ''}://${peerEnv.host}:${peerEnv.port}${peerEnv.path || ''}`;
    peerHttpKeepAliveRef.current = window.setInterval(() => {
      fetch(`${peerHttpBase}/`, { method: 'GET', mode: 'no-cors' }).catch(() => { });
    }, 240000); // every 4 minutes

    // Sync Timer
    if (cloudSyncTimerRef.current) window.clearInterval(cloudSyncTimerRef.current);
    cloudSyncTimerRef.current = window.setInterval(() => {
      const p: any = peerRef.current;
      if (!p || p.destroyed) return;
      if (p.open) {
        setCloudConnected((prev) => (prev ? prev : true));
        setCloudError(null);
      }
    }, 1000);

    // Relay Connection
    let ws: WebSocket | null = null;
    let relayRetryTimer: number | null = null;
    let relayConnecting = false;
    const relayMaxBackoffMs = 15000;

    const scheduleRelayReconnect = (hint?: string) => {
      if (relayRetryTimer) return;
      const attempt = relayReconnectAttemptsRef.current;
      const delay = Math.min(relayMaxBackoffMs, 1500 * Math.pow(2, attempt));
      relayReconnectTotalRef.current += 1;
      relayReconnectAttemptsRef.current = attempt + 1;
      const jitter = Math.random() * 250;
      const finalDelay = Math.round(delay + jitter);
      if (hint && liveIntentRef.current) {
        setStatusMsg({ type: 'warn', text: `${hint} Reconnecting in ${Math.round(finalDelay / 1000)}s...` });
      }
      relayRetryTimer = window.setTimeout(() => {
        relayRetryTimer = null;
        connectRelay();
      }, finalDelay);
    };

    const connectRelay = () => {
      if (relayConnecting) return;
      if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;

      const effectiveWsUrl = getRelayWsUrl();
      const effectiveRelayToken = getRelayToken();

      if (!effectiveWsUrl) {
        setRelayConnected(false);
        setRelayStatus("Relay URL not configured");
        return;
      }
      const pageIsHttps = window.location.protocol === "https:";
      const pageHost = window.location.hostname;
      const pageIsLocal = pageHost === "localhost" || pageHost === "127.0.0.1";

      // Final mixed-content check
      if (pageIsHttps && effectiveWsUrl.startsWith("ws://")) {
        setRelayConnected(false);
        setRelayStatus("Insecure relay URL on HTTPS page");
        setStatusMsg({
          type: "error",
          text: "Relay URL uses ws:// on an HTTPS page. Please check VITE_SIGNAL_URL_PROD.",
          persistent: true,
        });
        return;
      }

      if (!pageIsLocal && /^(ws|wss):\/\/(localhost|127\.0\.0\.1)(:|\/|$)/i.test(effectiveWsUrl)) {
        setRelayConnected(false);
        setRelayStatus("Local relay URL cannot be used from deployed app");
        setStatusMsg({
          type: "error",
          text: "You are on a deployed app host, but relay URL points to localhost. Use local app for local relay, or set public wss relay URL.",
          persistent: true,
        });
        return;
      }
      try {
        relayConnecting = true;
        ws = new WebSocket(effectiveWsUrl);
        streamingSocketRef.current = ws;

        ws.onopen = () => {
          relayConnecting = false;
          relayReconnectAttemptsRef.current = 0;
          relayUptimeStartRef.current = Date.now();
          if (relayRetryTimer) { window.clearTimeout(relayRetryTimer); relayRetryTimer = null; }
          setRelayConnected(true);
          setRelayStatus("Relay connected");
          ws?.send(JSON.stringify({
            type: "join",
            role: "host",
            sessionId: roomId,
            token: effectiveRelayToken,
          }));
          if (liveIntentRef.current) {
            const now = Date.now();
            if (now - liveStartGuardRef.current > 1500) {
              liveStartGuardRef.current = now;
              startStreamingSession({ fromReconnect: true, forceRestart: false });
              setStatusMsg({ type: 'info', text: "Relay reconnected. Resuming stream..." });
            }
          }
        };

        ws.onclose = (ev) => {
          relayConnecting = false;
          relayUptimeStartRef.current = null;
          setRelayConnected(false);
          setRelayStatus(`Relay closed (${ev.code})`);
          setStreamHealth((prev) => ({ ...prev, rttMs: null }));
          ws = null;
          streamingSocketRef.current = null;
          if (ev.code === 4001) {
            setStatusMsg({ type: 'warn', text: "Another Studio host tab is active for this room. This tab will stay disconnected." });
            liveIntentRef.current = false;
            return;
          }
          if (liveIntentRef.current) {
            setStatusMsg({ type: 'warn', text: "Relay lost. Attempting to reconnect..." });
          }
          if (relayRetryTimer) window.clearTimeout(relayRetryTimer);
          scheduleRelayReconnect("Relay socket closed.");
        };

        ws.onerror = () => {
          relayConnecting = false;
          setRelayConnected(false);
          setStatusMsg({ type: "error", text: "Relay connection failed" });
          scheduleRelayReconnect("Relay error.");
        };

        ws.onmessage = (ev) => {
          try {
            const msg = JSON.parse(String(ev.data || "{}"));
            if (msg?.type === "pong" && msg?.echo) {
              const rtt = Date.now() - Number(msg.echo);
              setStreamHealth((prev) => ({ ...prev, rttMs: rtt }));
              return;
            }
            if (msg?.type === "started") setRelayStatus("Relay streaming");
            if (msg?.type === "ffmpeg_restarting") {
              setRelayStatus(`Relay restarting (attempt ${msg?.attempt || "?"})`);
            }
            if (msg?.type === "ffmpeg_error") {
              setRelayStatus(`Relay ffmpeg warning: ${msg?.message || "unknown"}`);
            }
            if (msg?.type === "relay_congestion") {
              if (msg?.level === "hard") {
                setRelayStatus("Relay congestion hard limit reached");
                setStatusMsg({ type: "error", text: "Relay congestion exceeded hard limit. Stream stopping." });
              } else if (msg?.level === "soft") {
                setRelayStatus("Relay congestion detected");
              } else if (msg?.level === "recovered") {
                setRelayStatus("Relay congestion recovered");
              }
            }
            if (msg?.type === "destination_status" && (msg?.status === "degraded" || msg?.status === "down")) {
              const target = msg?.target ? ` (${msg.target})` : "";
              setRelayStatus(`Destination ${msg.status}${target}`);
            }
            if (msg?.type === "relay_fatal") {
              applyRelayFatalStatus(msg?.reason, undefined, msg);
              return;
            }
            if (msg?.type === "error") {
              const errorCode = String(msg?.error || "unknown");
              if (errorCode === "not_active_host") {
                setRelayStatus("Relay error: not_active_host");
                setStatusMsg({
                  type: "error",
                  text: "Another tab/session owns this room.",
                  persistent: true,
                });
                liveIntentRef.current = false;
                return;
              }
              setRelayStatus(`Relay error: ${errorCode}`);
            }

            // Handle Lumina Control Bridge Events
            if (msg?.type === "lumina_event") {
              const { event, payload } = msg;
              const nextLuminaState = normalizeLuminaState(event, payload);
              setLuminaState(nextLuminaState);
              routeIntentSignalRef.current(event, payload);
              if (event === "lumina.scene.switch") {
                const targetScene = payload?.sceneName || payload?.target;
                if (targetScene) {
                  const preset = scenePresets.find((scene) => scene.name?.toLowerCase() === String(targetScene).toLowerCase());
                  if (preset) {
                    runTransition(() => loadScenePresetById(preset.id));
                    setStatusMsg({ type: "info", text: `Lumina Scene Transition: ${preset.name}` });
                  } else {
                    const matchingTheme = LAYOUT_THEMES.find((theme) => theme.name.toLowerCase() === String(targetScene).toLowerCase());
                    if (matchingTheme) {
                      runTransition(() => applySelectedLayoutTheme(matchingTheme.id));
                      setStatusMsg({ type: "info", text: `Lumina Theme Transition: ${matchingTheme.name}` });
                    } else {
                      setStatusMsg({ type: "warn", text: `Lumina requested scene '${targetScene}' but no preset or theme matched.` });
                    }
                  }
                }
              } else if (event === "lumina.state.sync") {
                setStatusMsg({ type: "info", text: `Lumina sync: ${nextLuminaState.contentMode}` });
              }
            }

          } catch { }
        };
      } catch {
        relayConnecting = false;
        scheduleRelayReconnect("Relay connect threw.");
      }
    };

    connectRelay();

    return () => {
      if (keepAliveRef.current) clearInterval(keepAliveRef.current);
      if (peerHttpKeepAliveRef.current) clearInterval(peerHttpKeepAliveRef.current);
      if (cloudDisconnectTimerRef.current) clearTimeout(cloudDisconnectTimerRef.current);
      if (cloudSyncTimerRef.current) clearInterval(cloudSyncTimerRef.current);
      if (relayRetryTimer) clearTimeout(relayRetryTimer);
      phoneCallsRef.current.forEach((call) => {
        try { call.close(); } catch { }
      });
      phoneCallsRef.current.clear();
      mobileMetaRef.current.clear();

      try { ws?.close(); } catch { }

      const p: any = peerRef.current;
      if (p && p.id === myPeerId) {
        try { p.destroy(); } catch { }
        peerRef.current = null;
      }
    };
  }, [roomId]); // Re-run if room ID changes

  // --- HELPER FUNCTIONS ---
  const buildPreferredAudioConstraints = (deviceId?: string): MediaTrackConstraints => {
    const constraints: MediaTrackConstraints = {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      channelCount: { ideal: 2 },
      sampleRate: { ideal: 48000 },
      sampleSize: { ideal: 16 },
    };
    if (deviceId) {
      constraints.deviceId = { exact: deviceId };
    }
    return constraints;
  };

  const handleMobileStream = (stream: MediaStream, sourceId: string, label: string, peerId?: string) => {
    const existingSource = cameraSourcesRef.current.find(s => s.id === sourceId);
    let layerId = existingSource?.layerId;
    const pendingTimer = phonePendingTimersRef.current.get(sourceId);
    if (pendingTimer) {
      window.clearTimeout(pendingTimer);
      phonePendingTimersRef.current.delete(sourceId);
    }
    if (existingSource?.stream && existingSource.stream !== stream) {
      try { existingSource.stream.getTracks().forEach((t) => t.stop()); } catch { }
    }

    setLayers(prev => {
      const safePrev = Array.isArray(prev) ? prev : [];
      if (layerId) {
        return safePrev.map(l => l.id === layerId ? { ...l, src: stream, label } : l);
      }
      const newLayer: Layer = {
        id: generateId(),
        type: SourceType.CAMERA,
        label: label || 'Phone Cam',
        visible: true,
        x: 50, y: 50, width: 480, height: 270,
        src: stream,
        zIndex: safePrev.length + 10,
        style: { circular: false, border: true, borderColor: '#7c3aed' }
      };
      layerId = newLayer.id;
      return [...safePrev, newLayer];
    });

    if (layerId) {
      mobileCamLayerIdRef.current = layerId;
    }

    setCameraSources(prev => {
      const idx = prev.findIndex(s => s.id === sourceId);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], label, status: 'live', stream, layerId, peerId };
        cameraSourcesRef.current = next;
        return next;
      }
      const next = [...prev, { id: sourceId, kind: 'phone', label, status: 'live', stream, layerId, peerId }];
      cameraSourcesRef.current = next;
      return next;
    });

    const micId = `mobile-mic-${sourceId}`;
    setAudioTracks(prev => {
      if (prev.some(t => t.id === micId)) {
        return prev.map(t => t.id === micId ? { ...t, stream: stream, label: `${label} Mic` } : t);
      }
      return [...prev, {
        id: micId,
        label: `${label} Mic`,
        volume: 100,
        muted: false,
        isMic: true,
        noiseCancellation: false,
        stream: stream
      }];
    });

    setStatusMsg({ type: 'info', text: `${label} Connected & Live!` });
    setShowQRModal(false);

    setCameraSources(prev => prev.map(s => s.id === sourceId ? { ...s, audioTrackId: micId } : s));
  };

  const regenerateRoomId = () => {
    const newId = generateRoomId();
    setRoomId(newId);
    localStorage.setItem('aether_host_room_id', newId);
    setStatusMsg({ type: 'info', text: "New Room ID Generated." });
  };

  const addCameraSource = async (videoDeviceId: string, audioDeviceId: string, videoLabel: string, audioLabel?: string) => {
    try {
      const audioConstraint = audioDeviceId
        ? buildPreferredAudioConstraints(audioDeviceId)
        : false;
      const attempts: MediaStreamConstraints[] = [
        { video: { deviceId: { exact: videoDeviceId }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: audioConstraint },
        { video: { deviceId: { exact: videoDeviceId } }, audio: audioConstraint },
        {
          video: true,
          audio: audioDeviceId
            ? { deviceId: { exact: audioDeviceId } }
            : audioConstraint,
        },
      ];

      let stream: MediaStream | null = null;
      let lastErr: any = null;
      for (const constraints of attempts) {
        try {
          stream = await navigator.mediaDevices.getUserMedia(constraints);
          break;
        } catch (err) {
          lastErr = err;
        }
      }
      if (!stream) throw lastErr;

      const layerId = generateId();
      const newLayer: Layer = {
        id: layerId, type: SourceType.CAMERA, label: videoLabel || 'Camera', visible: true, x: 0, y: 0, width: 1920, height: 1080, src: stream, zIndex: layers.length + 1, style: {}
      };
      setLayers(prev => [...prev, newLayer]);
      let audioTrackId: string | undefined;
      if (stream.getAudioTracks().length > 0) {
        audioTrackId = generateId();
        const trackLabel = audioLabel || `${videoLabel || 'Cam'} Mic`;
        setAudioTracks(prev => [...prev, { id: audioTrackId!, label: trackLabel, volume: 100, muted: false, isMic: true, noiseCancellation: false, stream }]);
      }
      const sourceId = generateId();
      setCameraSources(prev => [
        ...prev,
        {
          id: sourceId,
          kind: 'local',
          label: videoLabel || `Camera ${prev.filter(s => s.kind === 'local').length + 1}`,
          status: 'live',
          layerId,
          stream,
          audioTrackId,
        }
      ]);
      setSelectedLayerId(layerId);
      setComposerMainLayerId((prev) => prev || layerId);
      setShowDeviceSelector(false);
    } catch (err) {
      const name = (err as any)?.name || '';
      let msg = "Failed to access device.";
      if (name === 'NotReadableError') msg = "Camera is busy or already in use. Close other apps and retry.";
      else if (name === 'NotAllowedError' || name === 'SecurityError') msg = "Camera permission blocked. Allow access in browser settings.";
      else if (name === 'NotFoundError') msg = "No camera device found.";
      setStatusMsg({ type: 'error', text: msg });
    }
  };

  const addDesktopSource = async (sourceId: string, sourceName: string) => {
    setDesktopSources(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          // Electron-specific desktop capture constraints
          mandatory: {
            chromeMediaSource: 'desktop',
            chromeMediaSourceId: sourceId,
            minWidth: 1280,
            maxWidth: 1920,
            minHeight: 720,
            maxHeight: 1080,
          },
        } as any,
      });
      const newLayer: Layer = {
        id: generateId(), type: SourceType.SCREEN, label: sourceName || 'Screen',
        visible: true, x: 0, y: 0, width: 1920, height: 1080, src: stream, zIndex: 0, style: {},
      };
      setLayers(prev => [newLayer, ...prev]);
      setSelectedLayerId(newLayer.id);
      setComposerMainLayerId((prev) => prev || newLayer.id);
    } catch (err: any) {
      setStatusMsg({ type: 'error', text: err.message || 'Screen capture failed.' });
    }
  };

  const addScreenSource = async () => {
    // In Electron the desktop API is available — show a custom source picker
    // so the user can choose which screen or window to capture.
    const desktop = (window as any).aetherDesktop;
    if (typeof desktop?.getDesktopSources === 'function') {
      try {
        const sources = await desktop.getDesktopSources();
        setDesktopSources(sources);
      } catch (err: any) {
        setStatusMsg({ type: 'error', text: 'Failed to list screen sources.' });
      }
      return;
    }
    // Web browser fallback — use the standard getDisplayMedia picker.
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      const newLayer: Layer = {
        id: generateId(), type: SourceType.SCREEN, label: 'Screen', visible: true, x: 0, y: 0, width: 1920, height: 1080, src: stream, zIndex: 0, style: {}
      };
      setLayers(prev => [newLayer, ...prev]);
      if (stream.getAudioTracks().length > 0) {
        setAudioTracks(prev => [...prev, { id: generateId(), label: 'System Audio', volume: 80, muted: false, isMic: false, noiseCancellation: false, stream }]);
      }
      setSelectedLayerId(newLayer.id);
      setComposerMainLayerId((prev) => prev || newLayer.id);
    } catch (err: any) {
      if (err.name === 'NotAllowedError') return;
      setStatusMsg({ type: 'error', text: err.message || 'Screen capture failed.' });
    }
  };

  const addImageLayer = (src: string, label: string = 'Image') => {
    const newLayer: Layer = { id: generateId(), type: SourceType.IMAGE, label, visible: true, x: 100, y: 100, width: 480, height: 270, src, zIndex: layers.length + 1, style: {} };
    setLayers(prev => [...prev, newLayer]);
    setSelectedLayerId(newLayer.id);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => event.target?.result && addImageLayer(event.target.result as string, file.name);
      reader.readAsDataURL(file);
    }
  };

  const addTextLayer = () => {
    const newLayer: Layer = { id: generateId(), type: SourceType.TEXT, label: 'Text', visible: true, x: 200, y: 200, width: 400, height: 100, content: 'Double Click to Edit', zIndex: layers.length + 1, style: {} };
    setLayers(prev => [...prev, newLayer]);
    setSelectedLayerId(newLayer.id);
  };

  const updateLayer = (id: string, updates: Partial<Layer>) => setLayers(prev => prev.map(l => l.id === id ? { ...l, ...updates } : l));

  const deleteLayer = (id: string) => {
    setLayers(prev => prev.filter(l => l.id !== id));
    if (selectedLayerId === id) setSelectedLayerId(null);
    if (composerMainLayerIdRef.current === id) setComposerMainLayerId(null);
  };

  const updateAudioTrack = (id: string, updates: Partial<AudioTrackConfig>) => setAudioTracks(prev => prev.map(t => t.id === id ? { ...t, ...updates } : t));

  const handleCanvasReady = (canvas: HTMLCanvasElement) => {
    activeCanvasRef.current = canvas;
  };

  const getMixedStream = (fps: number = 30, includeAudio: boolean = true) => {
    if (!activeCanvasRef.current) return null;
    const canvasStream = activeCanvasRef.current.captureStream(fps);
    const audioTracks = includeAudio ? (audioDestination.current?.stream.getAudioTracks() || []) : [];
    return new MediaStream([...canvasStream.getVideoTracks(), ...audioTracks]);
  };

  const openVirtualCable = () => {
    if (audioContext.current?.state === 'suspended') {
      audioContext.current.resume();
    }

    if (!activeCanvasRef.current) return;

    const win = window.open('', 'AetherVirtualCable', 'width=1280,height=720,menubar=no,toolbar=no,location=no,status=no,resizable=yes');
    if (!win) {
      setStatusMsg({ type: 'error', text: "Popup blocked! Allow popups for Virtual Cable." });
      return;
    }

    win.document.title = "Aether Virtual Output";
    win.document.body.style.margin = '0';
    win.document.body.style.backgroundColor = 'black';
    win.document.body.style.overflow = 'hidden';
    win.document.body.style.display = 'flex';
    win.document.body.style.alignItems = 'center';
    win.document.body.style.justifyContent = 'center';

    const outCanvas = win.document.createElement('canvas');
    outCanvas.width = 1920;
    outCanvas.height = 1080;
    outCanvas.style.width = '100vw';
    outCanvas.style.height = '100vh';
    outCanvas.style.objectFit = 'contain';
    win.document.body.appendChild(outCanvas);

    const msg = win.document.createElement('div');
    msg.innerText = "Virtual Cable Active: Capture this window in Zoom/OBS";
    msg.style.position = 'absolute';
    msg.style.bottom = '10px';
    msg.style.left = '10px';
    msg.style.color = 'rgba(255,255,255,0.3)';
    msg.style.fontFamily = 'sans-serif';
    msg.style.fontSize = '12px';
    msg.style.pointerEvents = 'none';
    win.document.body.appendChild(msg);

    const ctx = outCanvas.getContext('2d');
    const syncLoop = () => {
      if (!win.closed && ctx && activeCanvasRef.current) {
        ctx.drawImage(activeCanvasRef.current, 0, 0, outCanvas.width, outCanvas.height);
        win.requestAnimationFrame(syncLoop);
      }
    };
    syncLoop();
    setStatusMsg({ type: 'info', text: "Virtual Output Window Opened" });
  };

  const toggleRecording = () => {
    if (isRecording) {
      localRecorderRef.current?.stop();
      setIsRecording(false);
    } else {
      if (audioContext.current?.state === 'suspended') {
        audioContext.current.resume();
      }

      const stream = getMixedStream();
      if (!stream) {
        setStatusMsg({ type: 'error', text: "No stream available (Canvas not ready)" });
        return;
      }

      const recorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
      localChunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) localChunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        const blob = new Blob(localChunksRef.current, { type: 'video/webm' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `recording-${Date.now()}.webm`;
        a.click();
        setStatusMsg({ type: 'info', text: "Recording Saved!" });
      };

      recorder.start();
      localRecorderRef.current = recorder;
      setIsRecording(true);
      setStatusMsg({ type: 'info', text: "Recording Started" });
    }
  };

  const applyStreamQuality = (quality: StreamQualityPreset) => {
    setStreamQuality(quality);
    localStorage.setItem('aether_stream_quality', quality);
  };

  const getNextLowerQuality = (quality: StreamQualityPreset): StreamQualityPreset | null => {
    if (quality === 'high') return 'medium';
    if (quality === 'medium') return 'low';
    return null;
  };

  const buildMulticastDestinations = () => {
    const enabled = destinations.filter(d => d.enabled && d.url.trim()).map(d => d.url.trim());
    return enabled;
  };

  const sendRelayCommand = (payload: Record<string, unknown>) => {
    const socket = streamingSocketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;

    const relayToken = import.meta.env.VITE_RELAY_TOKEN;
    const message: Record<string, unknown> = { ...payload };
    if (relayToken && !Object.prototype.hasOwnProperty.call(message, 'token')) {
      message.token = relayToken;
    }

    try {
      socket.send(JSON.stringify(message));
      return true;
    } catch {
      return false;
    }
  };

  function resetEncoderBootstrap(recorderState: string = 'inactive') {
    setEncoderBootstrap({
      recorderState,
      firstChunkReceived: false,
      chunksSent: 0,
      zeroSizeChunks: 0,
      firstChunkDelayMs: null,
    });
  }

  function applyRelayFatalStatus(reasonRaw: unknown, fallbackText?: string, meta?: Record<string, unknown>) {
    const reason = String(reasonRaw || '').trim() || 'unknown_relay_fatal';
    const reasonMap: Record<string, string> = {
      no_input_data_from_encoder: "Browser encoder produced no media data.",
      no_input_data: "Browser encoder produced no media data.",
      not_active_host: "Another tab/session owns this room.",
      max_restart_exceeded: "Stream stopped after repeated failures. Check your stream key and network.",
      relay_hard_congestion: "Upload bandwidth too low for current stream quality. Try a lower quality preset.",
      all_destinations_failed: "All stream destinations failed. Verify your stream keys are correct.",
    };
    let text = reasonMap[reason] || fallbackText || `Relay fatal: ${reason}`;
    // Append diagnostic metadata if available
    const attempts = meta?.attempts ?? (meta as any)?.attempts;
    const lastError = meta?.lastError ?? (meta as any)?.lastError;
    if (attempts != null) text += ` (${attempts} attempts)`;
    if (lastError) text += ` — ${String(lastError).slice(0, 120)}`;
    setRelayStatus(`Relay fatal: ${reason}`);

    // Auto-recovery: for recoverable fatals, attempt to restart after a delay
    const nonRecoverable = ['not_active_host'];
    if (!nonRecoverable.includes(reason) && fatalRecoveryCountRef.current < 2) {
      fatalRecoveryCountRef.current += 1;
      const recoveryAttempt = fatalRecoveryCountRef.current;
      setStatusMsg({ type: 'warn', text: `${text} — Auto-recovering (attempt ${recoveryAttempt}/2)...`, persistent: false });
      // Keep liveIntent alive so the relay reconnect resumes the stream
      qualityDowngradeInFlightRef.current = false;
      congestionWindowStartRef.current = null;
      congestionWarningShownRef.current = false;
      encoderRetryInFlightRef.current = false;
      encoderChunkStateRef.current = { count: 0, lastAt: 0 };
      pendingStartRef.current = null;
      encoderStartAtRef.current = null;
      resetEncoderBootstrap('inactive');
      try { mediaRecorderRef.current?.stop(); } catch { }
      // Wait, then restart the stream
      setTimeout(() => {
        if (!liveIntentRef.current) return; // user manually stopped
        startStreamingSession({ fromReconnect: true, forceRestart: true });
      }, 5000);
      return;
    }

    // Non-recoverable or exhausted recovery attempts
    setStatusMsg({ type: "error", text, persistent: true });
    liveIntentRef.current = false;
    fatalRecoveryCountRef.current = 0;
    qualityDowngradeInFlightRef.current = false;
    congestionWindowStartRef.current = null;
    congestionWarningShownRef.current = false;
    encoderRetryInFlightRef.current = false;
    encoderChunkStateRef.current = { count: 0, lastAt: 0 };
    pendingStartRef.current = null;
    if (telemetryLogIdRef.current && encoderStartAtRef.current) {
      const duration = (Date.now() - encoderStartAtRef.current) / 1000;
      const telemetryExtras = {
        reconnectCount: relayReconnectTotalRef.current,
        uptimeMs: relayUptimeStartRef.current ? Date.now() - relayUptimeStartRef.current : undefined,
        bindError: relayBindErrorRef.current,
      };
      void logStreamStop(telemetryLogIdRef.current, duration, telemetryExtras);
    }
    telemetryLogIdRef.current = null;
    streamSessionIdRef.current = null;
    encoderStartAtRef.current = null;
    resetEncoderBootstrap('inactive');
    try { mediaRecorderRef.current?.stop(); } catch { }
    setStreamStatus(StreamStatus.IDLE);
  }

  const startStreamingSession = async (opts?: {
    fromReconnect?: boolean;
    forceRestart?: boolean;
    qualityOverride?: StreamQualityPreset;
    compatibilityMode?: boolean;
    videoOnly?: boolean;
    fallbackStage?: number;
  }) => {
    if (audioContext.current?.state === 'suspended') {
      await audioContext.current.resume();
    }

    const cleanKey = streamKey.trim();
    if (!cleanKey) {
      pendingStartRef.current = null;
      setRelayStatus("Missing stream key.");
      if (!opts?.fromReconnect) {
        setStatusMsg({ type: 'error', text: "No Stream Key Set! Check Settings." });
        setShowSettings(true);
      }
      return;
    }

    if (!relayConnected && !opts?.fromReconnect) {
      pendingStartRef.current = null;
      setRelayStatus("Relay offline.");
      setStatusMsg({ type: 'error', text: "Relay Offline. Wait for relay to connect." });
      return;
    }

    const destinationsList = buildMulticastDestinations();
    pendingStartRef.current = {
      streamKey: cleanKey,
      destinations: destinationsList,
      sent: false,
      sentAt: null,
    };
    const sendStartStreamCommand = () => {
      const pending = pendingStartRef.current || {
        streamKey: cleanKey,
        destinations: destinationsList,
        sent: false,
        sentAt: null,
      };
      const sent = sendRelayCommand({
        type: 'start-stream',
        streamKey: pending.streamKey,
        destinations: pending.destinations,
      });
      if (sent) {
        pending.sent = true;
        pending.sentAt = Date.now();
        pendingStartRef.current = pending;
      }
      return sent;
    };
    const sendStopStreamCommand = () => sendRelayCommand({ type: 'stop-stream' });

    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording' && !opts?.forceRestart) {
      const encoderHealthy =
        encoderChunkStateRef.current.count > 0 &&
        Date.now() - encoderChunkStateRef.current.lastAt < 4000;
      if (encoderHealthy) {
        const sent = sendStartStreamCommand();
        if (!sent) {
          setRelayStatus("Relay start command pending: socket not open.");
        }
        setStreamStatus(StreamStatus.LIVE);
        return;
      }
      if (telemetryLogIdRef.current && encoderStartAtRef.current) {
        const duration = (Date.now() - encoderStartAtRef.current) / 1000;
        const telemetryExtras = {
          reconnectCount: relayReconnectTotalRef.current,
          uptimeMs: relayUptimeStartRef.current ? Date.now() - relayUptimeStartRef.current : undefined,
          bindError: relayBindErrorRef.current,
        };
        void logStreamStop(telemetryLogIdRef.current, duration, telemetryExtras);
      }
      try { mediaRecorderRef.current.stop(); } catch { }
    }

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try { mediaRecorderRef.current.stop(); } catch { }
    }

    const chosenQuality = opts?.qualityOverride || streamQuality;
    if (!wifiMode) {
      liveQualityRef.current = chosenQuality;
    }
    const qualitySettings: Record<StreamQualityPreset, { v: number; a: number; fps: number }> = {
      // YouTube 720p30 target: 2.5–4 Mbps video + 192 kbps audio (AAC/Opus)
      // YouTube 1080p30 target: 4–9 Mbps video — high mode targets 1080p
      high:   { v: 4_500_000, a: 192_000, fps: 30 },
      medium: { v: 2_500_000, a: 160_000, fps: 30 },
      low:    { v: 1_200_000, a: 96_000,  fps: 30 },
    };

    // WiFi saver: 900 kbps video is suitable for 480p previews on congested networks
    const wifiQuality = { v: 900_000, a: 64_000, fps: 24 };
    const effectiveQuality = wifiMode ? wifiQuality : qualitySettings[chosenQuality];
    const { v: vBits, a: aBits, fps } = effectiveQuality;
    const fallbackStage = Math.max(0, Number(opts?.fallbackStage || 0));
    const forceVideoOnly = !!opts?.videoOnly || fallbackStage >= 2;

    // Wait for canvas to fully render all current layers before capturing.
    // With 2+ video sources the draw loop needs 1-2 frames to settle; skipping
    // this causes zero-size initial chunks and the relay never gets a keyframe.
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    );
    if (!liveIntentRef.current) return; // user cancelled during warmup

    const combinedStream = getMixedStream(fps, !forceVideoOnly);
    if (!combinedStream || combinedStream.getVideoTracks().length === 0) {
      setRelayStatus("No canvas video track available.");
      setStatusMsg({ type: 'error', text: "Initialization Error. Refresh page." });
      return;
    }

    const mimeCandidates =
      fallbackStage <= 0
        ? ['video/webm;codecs=vp8,opus', 'video/webm;codecs=vp9,opus', 'video/webm', '']
        : fallbackStage === 1
          ? ['video/webm', '']
          : [''];
    const selectedMime = mimeCandidates.find((mime) => !mime || MediaRecorder.isTypeSupported(mime)) || '';
    const recorderOptions: MediaRecorderOptions = {
      videoBitsPerSecond: vBits,
    };
    if (!forceVideoOnly) {
      recorderOptions.audioBitsPerSecond = aBits;
    }
    if (selectedMime) {
      recorderOptions.mimeType = selectedMime;
    }

    const sessionId = generateId();
    streamSessionIdRef.current = sessionId;
    encoderStartAtRef.current = Date.now();

    // Log telemetry - deferred to ensure zero impact on initial encoding start
    setTimeout(() => {
      const telemetryExtras = {
        reconnectCount: relayReconnectTotalRef.current,
        uptimeMs: relayUptimeStartRef.current ? Date.now() - relayUptimeStartRef.current : undefined,
        bindError: relayBindErrorRef.current,
      };
      logStreamStart(
        user.uid,
        user.email || 'unknown',
        sessionId,
        destinationsList,
        wifiMode ? 'wifi_low' : chosenQuality,
        telemetryExtras
      )
        .then(id => { if (id) telemetryLogIdRef.current = id; });
    }, 100);

    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(combinedStream, recorderOptions);
    } catch (err: any) {
      const message = err?.message || "Unable to start browser encoder.";
      setStatusMsg({ type: 'error', text: message });
      setRelayStatus(`Browser encoder failed to start: ${message}`);
      return;
    }

    const SOFT_BUFFER_BYTES = 2 * 1024 * 1024;
    const HARD_BUFFER_BYTES = 8 * 1024 * 1024;
    const SUSTAINED_CONGESTION_MS = 5000;
    const STALE_CHUNK_MS = 12000;
    const NO_CHUNK_BOOTSTRAP_MS = 15000;
    const RECORDER_START_DEADLINE_MS = 1200;
    let receivedAnyChunk = false;
    let relayStartSent = false;
    let requestDataTimer: number | null = null;
    let noChunkTimer: number | null = null;
    let staleChunkTimer: number | null = null;
    let recorderStateTimer: number | null = null;

    encoderChunkStateRef.current = { count: 0, lastAt: 0 };
    encoderStartAtRef.current = null;
    encoderRetryInFlightRef.current = false; // always clear on fresh recorder start to prevent stuck "rolling" state
    resetEncoderBootstrap('initializing');

    const clearRecorderTimers = () => {
      if (requestDataTimer) {
        window.clearInterval(requestDataTimer);
        requestDataTimer = null;
      }
      if (noChunkTimer) {
        window.clearTimeout(noChunkTimer);
        noChunkTimer = null;
      }
      if (staleChunkTimer) {
        window.clearInterval(staleChunkTimer);
        staleChunkTimer = null;
      }
      if (recorderStateTimer) {
        window.clearTimeout(recorderStateTimer);
        recorderStateTimer = null;
      }
    };

    const requestAutoQualityStepDown = () => {
      if (wifiMode) return;
      if (qualityDowngradeInFlightRef.current) return;
      const currentQuality = liveQualityRef.current;
      const nextQuality = getNextLowerQuality(currentQuality);
      if (!nextQuality) return;

      qualityDowngradeInFlightRef.current = true;
      liveQualityRef.current = nextQuality;
      applyStreamQuality(nextQuality);
      setStatusMsg({ type: 'warn', text: `Network congestion detected. Switching to ${nextQuality} quality.` });

      void startStreamingSession({
        fromReconnect: true,
        forceRestart: true,
        qualityOverride: nextQuality,
        compatibilityMode: opts?.compatibilityMode,
      }).finally(() => {
        qualityDowngradeInFlightRef.current = false;
        congestionWindowStartRef.current = null;
        congestionWarningShownRef.current = false;
      });
    };

    const stopWithEncoderFatal = (message: string, reason: string = "no_input_data_from_encoder") => {
      liveIntentRef.current = false;
      setRelayStatus(`Relay fatal: ${reason}`);
      setStatusMsg({ type: 'error', text: message, persistent: true });
      encoderRetryInFlightRef.current = false;
      pendingStartRef.current = null;

      if (telemetryLogIdRef.current && encoderStartAtRef.current) {
        const duration = (Date.now() - encoderStartAtRef.current) / 1000;
        const telemetryExtras = {
          reconnectCount: relayReconnectTotalRef.current,
          uptimeMs: relayUptimeStartRef.current ? Date.now() - relayUptimeStartRef.current : undefined,
          bindError: relayBindErrorRef.current,
        };
        void logStreamStop(telemetryLogIdRef.current, duration, telemetryExtras);
      }
      const telemetryExtras = {
        reconnectCount: relayReconnectTotalRef.current,
        uptimeMs: relayUptimeStartRef.current ? Date.now() - relayUptimeStartRef.current : undefined,
        bindError: relayBindErrorRef.current,
      };
      void logStreamError(user.uid, user.email || 'unknown', streamSessionIdRef.current || 'unknown', reason, telemetryExtras);

      telemetryLogIdRef.current = null;
      streamSessionIdRef.current = null;
      encoderStartAtRef.current = null;
      try { recorder.stop(); } catch { }
      sendStopStreamCommand();
      setStreamStatus(StreamStatus.IDLE);
    };

    const restartEncoderWithFallback = (reasonText: string) => {
      if (encoderRetryInFlightRef.current) return true;
      if (fallbackStage >= 2) return false;
      encoderRetryInFlightRef.current = true;
      const nextStage = fallbackStage + 1;
      const nextVideoOnly = nextStage >= 2;
      const modeText = nextVideoOnly ? "video-only mode" : "compatibility mode";
      setStatusMsg({ type: 'warn', text: `${reasonText}. Retrying with ${modeText}...` });
      void startStreamingSession({
        fromReconnect: true,
        forceRestart: true,
        qualityOverride: 'low',
        compatibilityMode: nextStage >= 1,
        videoOnly: nextVideoOnly,
        fallbackStage: nextStage,
      });
      return true;
    };

    recorder.onstart = () => {
      clearRecorderTimers();
      encoderStartAtRef.current = Date.now();
      setEncoderBootstrap({
        recorderState: recorder.state || 'recording',
        firstChunkReceived: false,
        chunksSent: 0,
        zeroSizeChunks: 0,
        firstChunkDelayMs: null,
      });

      requestDataTimer = window.setInterval(() => {
        if (recorder.state === 'recording') {
          try { recorder.requestData(); } catch { }
        }
      }, 1000);

      noChunkTimer = window.setTimeout(() => {
        if (receivedAnyChunk || recorder.state !== 'recording' || !liveIntentRef.current) return;
        if (restartEncoderWithFallback("No encoder chunks yet")) {
          return;
        }
        stopWithEncoderFatal("No media data from browser encoder. Stream stopped.");
      }, NO_CHUNK_BOOTSTRAP_MS);

      staleChunkTimer = window.setInterval(() => {
        if (recorder.state !== 'recording' || !liveIntentRef.current) return;
        const chunkState = encoderChunkStateRef.current;
        if (chunkState.count <= 0) return;
        const msSinceLastChunk = Date.now() - chunkState.lastAt;
        if (msSinceLastChunk < STALE_CHUNK_MS) return;
        if (restartEncoderWithFallback("Encoder stalled")) {
          return;
        }
        stopWithEncoderFatal("Browser encoder stalled. Stream stopped.");
      }, 2000);
    };

    recorder.onerror = (ev: any) => {
      clearRecorderTimers();
      const message = ev?.error?.message || "browser_encoder_error";
      setEncoderBootstrap((prev) => ({ ...prev, recorderState: 'error' }));
      setRelayStatus(`Browser encoder error: ${message}`);
      setStatusMsg({ type: 'error', text: `Browser encoder error: ${message}`, persistent: true });
    };

    recorder.onstop = () => {
      clearRecorderTimers();
      setEncoderBootstrap((prev) => ({ ...prev, recorderState: 'inactive' }));
    };

    recorder.ondataavailable = (e) => {
      if (e.data.size <= 0) {
        setEncoderBootstrap((prev) => ({
          ...prev,
          zeroSizeChunks: prev.zeroSizeChunks + 1,
        }));
        return;
      }

      const isFirstChunk = !receivedAnyChunk;
      receivedAnyChunk = true;
      encoderRetryInFlightRef.current = false;
      encoderChunkStateRef.current = {
        count: encoderChunkStateRef.current.count + 1,
        lastAt: Date.now(),
      };
      if (isFirstChunk) {
        const startedAt = encoderStartAtRef.current;
        setEncoderBootstrap((prev) => ({
          ...prev,
          firstChunkReceived: true,
          firstChunkDelayMs: startedAt ? Math.max(0, Date.now() - startedAt) : null,
        }));
      }

      const socket = streamingSocketRef.current;
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        setRelayStatus("Relay start command pending: socket not open.");
        return;
      }

      if (!relayStartSent) {
        relayStartSent = sendStartStreamCommand();
      }
      if (!relayStartSent) {
        setRelayStatus("Relay start command pending: socket not open.");
        return;
      }

      const buffered = socket.bufferedAmount;
      if (buffered >= HARD_BUFFER_BYTES) {
        streamHealthRef.current.drops += 1;
        if (!wifiMode && liveQualityRef.current !== 'low') {
          requestAutoQualityStepDown();
          return;
        }
        liveIntentRef.current = false;
        setRelayStatus("Browser upload queue exceeded hard limit.");
        setStatusMsg({ type: 'error', text: "Upload congestion too high. Stream stopped to recover." });
        try { recorder.stop(); } catch { }
        sendStopStreamCommand();
        setStreamStatus(StreamStatus.IDLE);
        return;
      }

      if (buffered >= SOFT_BUFFER_BYTES) {
        const now = Date.now();
        if (!congestionWindowStartRef.current) {
          congestionWindowStartRef.current = now;
        }
        if (!congestionWarningShownRef.current) {
          congestionWarningShownRef.current = true;
          setStatusMsg({ type: 'warn', text: "Network congestion detected. Stabilizing..." });
        }
        if (now - congestionWindowStartRef.current >= SUSTAINED_CONGESTION_MS) {
          requestAutoQualityStepDown();
        }
      } else {
        congestionWindowStartRef.current = null;
        congestionWarningShownRef.current = false;
      }

      streamHealthRef.current.bytes += e.data.size;
      try {
        socket.send(e.data);
        setEncoderBootstrap((prev) => ({
          ...prev,
          chunksSent: prev.chunksSent + 1,
        }));
      } catch { }
    };

    // Pre-send start-stream so the relay's FFmpeg is initialised and ready to
    // receive data from the very first chunk. Without this, the first chunk
    // triggers the command, FFmpeg starts late, and that first chunk (which
    // contains the WebM header/keyframe) is discarded — YouTube then never
    // receives a valid stream start signal.
    if (!relayStartSent) {
      relayStartSent = sendStartStreamCommand();
    }

    try {
      recorder.start(500);
    } catch (err: any) {
      clearRecorderTimers();
      pendingStartRef.current = null;
      encoderStartAtRef.current = null;
      const message = err?.message || "Unable to start browser encoder.";
      setRelayStatus(`Browser encoder failed to start: ${message}`);
      setStatusMsg({ type: 'error', text: `Browser encoder failed to start: ${message}`, persistent: true });
      liveIntentRef.current = false;
      setStreamStatus(StreamStatus.IDLE);
      return;
    }

    recorderStateTimer = window.setTimeout(() => {
      if (!liveIntentRef.current) return;
      if (recorder.state === 'recording') return;
      if (restartEncoderWithFallback("Encoder failed to enter recording state")) {
        return;
      }
      stopWithEncoderFatal("Browser encoder failed to start recording.");
    }, RECORDER_START_DEADLINE_MS);

    mediaRecorderRef.current = recorder;
    const encoderMode = forceVideoOnly ? "video-only" : (fallbackStage > 0 ? "compat" : "normal");
    setRelayStatus(`Browser encoder active (${encoderMode}${selectedMime ? `, ${selectedMime}` : ""})`);
    setEncoderBootstrap((prev) => ({ ...prev, recorderState: recorder.state || "starting" }));
    setStreamStatus(StreamStatus.LIVE);
    fatalRecoveryCountRef.current = 0; // reset on successful stream start
  };

  const toggleLive = async () => {
    if (streamStatus === StreamStatus.LIVE) {
      liveIntentRef.current = false;
      qualityDowngradeInFlightRef.current = false;
      congestionWindowStartRef.current = null;
      congestionWarningShownRef.current = false;
      encoderRetryInFlightRef.current = false;
      encoderChunkStateRef.current = { count: 0, lastAt: 0 };
      pendingStartRef.current = null;
      encoderStartAtRef.current = null;
      if (mediaRecorderRef.current) mediaRecorderRef.current.stop();
      sendRelayCommand({ type: 'stop-stream' });
      setStreamStatus(StreamStatus.IDLE);
    } else {
      setStatusMsg(null);
      liveIntentRef.current = true;
      encoderRetryInFlightRef.current = false;
      if (!cloudConnected) {
        const hasPhones = cameraSources.some(s => s.kind === 'phone');
        if (hasPhones) {
          setStatusMsg({ type: 'warn', text: "PeerJS offline — phone cameras may not connect, but you can still stream." });
        }
      }
      setStatusMsg({ type: 'info', text: `Starting RTMP Stream...` });
      await startStreamingSession();
    }
  };

  const openMicPicker = async (trackId: string) => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const mics = devices.filter(d => d.kind === "audioinput");
      setAvailableMics(mics);
      setMicPickerTrackId(trackId);
    } catch {
      setStatusMsg({ type: "error", text: "Could not list microphones. Allow permissions first." });
    }
  };

  const handleSignOut = () => {
    if (auth) {
      signOut(auth).catch(console.error);
    }
    onBack();
  };

  const checkForDesktopUpdates = async () => {
    if (!desktopUpdater?.checkForUpdates) {
      setStatusMsg({ type: 'warn', text: 'Auto-update is available in the installed desktop app only.' });
      return;
    }
    if (isCheckingUpdates) return;
    setIsCheckingUpdates(true);
    setStatusMsg({ type: 'info', text: 'Checking for updates...' });
    try {
      const res = await desktopUpdater.checkForUpdates();
      if (!res?.ok) {
        if (res?.reason === 'not_packaged') {
          setStatusMsg({ type: 'warn', text: 'Update checks are disabled in dev mode.' });
        } else if (res?.reason === 'portable_build') {
          setStatusMsg({ type: 'warn', text: 'Auto-update is disabled for portable builds.' });
        } else if (res?.reason === 'disabled') {
          setStatusMsg({ type: 'warn', text: 'Auto-update is disabled by environment config.' });
        } else {
          setStatusMsg({ type: 'error', text: res?.message || 'Unable to check for updates.' });
        }
        return;
      }
      // Final status comes from updater events; this line confirms request accepted.
      setStatusMsg({ type: 'info', text: 'Update check started.' });
    } catch {
      setStatusMsg({ type: 'error', text: 'Update check failed.' });
    } finally {
      setIsCheckingUpdates(false);
    }
  };

  const canStartLive = (relayConnected === true) && streamKey.trim().length > 0;
  const canToggleLive = streamStatus === StreamStatus.LIVE || canStartLive;
  const phoneSourceCount = cameraSources.filter((s) => s.kind === 'phone').length;
  const phoneSlotsFull = phoneSourceCount >= MAX_PHONE_CAMS;

  const applyPeerSettings = () => {
    const cleanPeerHost = peerHost.trim().replace(/^https?:\/\//i, '');
    localStorage.setItem('aether_peer_ui_mode', peerUiMode);
    localStorage.setItem('aether_peer_mode', peerMode);
    localStorage.setItem('aether_peer_host', cleanPeerHost);
    localStorage.setItem('aether_peer_port', String(Number(peerPort) || 9000));
    localStorage.setItem('aether_peer_path', peerPath.trim() || '/peerjs');
    localStorage.setItem('aether_peer_secure', peerSecure ? 'true' : 'false');
    window.location.reload();
  };

  const fetchWithTimeout = async (input: RequestInfo | URL, init: RequestInit, timeoutMs = 1200) => {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(input, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(id);
    }
  };

  const getRelayWsUrl = () => {
    const wsUrlRaw = (import.meta.env.VITE_SIGNAL_URL as string) || (import.meta.env.VITE_RELAY_WS_URL as string);
    const wsUrlLocal = import.meta.env.VITE_SIGNAL_URL_LOCAL as string;
    const protocol = window.location.protocol;
    const currentHost = window.location.hostname;
    const isLocalHost = currentHost === "localhost" || currentHost === "127.0.0.1";
    const isDesktopFile = protocol === "file:";

    let wsUrl = "";
    if (isDesktopFile) {
      wsUrl = wsUrlLocal || "ws://127.0.0.1:8080";
    } else {
      wsUrl = (isLocalHost ? wsUrlLocal : wsUrlRaw) || wsUrlRaw || "";
    }

    if (!wsUrl) return "";

    // HTTPS Auto-Fallback (e.g. Cloudflare tunnel)
    if (protocol === "https:" && wsUrl.startsWith("ws://")) {
      const prodRelay = (import.meta.env.VITE_SIGNAL_URL_PROD as string) || "";
      if (prodRelay && prodRelay.startsWith("wss://")) {
        return prodRelay.replace(/\/+$/, "");
      }
    }

    return wsUrl.replace(/\/+$/, "");
  };

  const getRelayToken = () => {
    const defaultToken = (import.meta.env.VITE_RELAY_TOKEN as string) || "";
    const prodToken = (import.meta.env.VITE_RELAY_TOKEN_PROD as string) || "";
    const protocol = window.location.protocol;
    const wsUrlRaw = (import.meta.env.VITE_SIGNAL_URL as string) || (import.meta.env.VITE_RELAY_WS_URL as string);
    const wsUrlLocal = import.meta.env.VITE_SIGNAL_URL_LOCAL as string;
    const isLocalHost = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
    const isDesktopFile = protocol === "file:";

    let wsUrl = "";
    if (isDesktopFile) {
      wsUrl = wsUrlLocal || "ws://127.0.0.1:8080";
    } else {
      wsUrl = (isLocalHost ? wsUrlLocal : wsUrlRaw) || wsUrlRaw || "";
    }

    // If we're on an HTTPS page and the default relay url is ws://, we're likely in a tunnel
    // and should use the production token instead.
    if (protocol === "https:" && wsUrl.startsWith("ws://")) {
      const prodRelay = (import.meta.env.VITE_SIGNAL_URL_PROD as string) || "";
      if (prodRelay && prodRelay.startsWith("wss://")) {
        return prodToken;
      }
    }

    return defaultToken;
  };

  const getRelayHttpBase = () => {
    const wsUrl = getRelayWsUrl();
    if (!wsUrl) return "";
    return wsUrl.replace(/^ws(s)?:\/\//i, "http$1://").replace(/\/+$/, "");
  };

  const checkRelayHealth = async () => {
    const base = getRelayHttpBase();
    if (!base) {
      setStatusMsg({ type: 'error', text: "Relay URL not configured." });
      return;
    }
    try {
      const res = await fetchWithTimeout(`${base}/health`, { method: 'GET' }, 1500);
      if (res.ok) {
        setStatusMsg({ type: 'info', text: "Relay OK." });
      } else {
        setStatusMsg({ type: 'warn', text: `Relay responded ${res.status}.` });
      }
    } catch {
      setStatusMsg({ type: 'error', text: "Relay check failed. Is the server running?" });
    }
  };

  const checkFfmpeg = async () => {
    const base = getRelayHttpBase();
    if (!base) {
      setStatusMsg({ type: 'error', text: "Relay URL not configured." });
      return;
    }
    try {
      const res = await fetchWithTimeout(`${base}/ffmpeg`, { method: 'GET' }, 2000);
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        setStatusMsg({ type: 'error', text: text || `FFmpeg check failed (${res.status}).` });
        return;
      }
      const json: any = await res.json().catch(() => ({}));
      setStatusMsg({ type: 'info', text: `FFmpeg OK: ${json?.version || 'available'}` });
    } catch {
      setStatusMsg({ type: 'error', text: "FFmpeg check failed. Is it installed on the relay server?" });
    }
  };

  const getMobileBaseUrl = () => {
    const forced = (import.meta as any).env?.VITE_MOBILE_BASE_URL as string | undefined;
    if (forced && forced.trim()) return forced.trim().replace(/\/$/, '');
    const saved = localStorage.getItem('aether_mobile_base_url');
    if (saved) return saved.replace(/\/$/, '');
    const origin = window.location.origin;
    if (origin && !origin.startsWith('about:') && !origin.startsWith('blob:') && !origin.startsWith('data:')) {
      return origin.replace(/\/$/, '');
    }
    return '';
  };

  const buildMobileUrl = (sourceId: string, sourceLabel?: string) => {
    let url = getMobileBaseUrl();
    if (!url) return '';
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = `https://${url}`;
    }
    try {
      const u = new URL(url);
      url = `${u.protocol}//${u.host}`;
    } catch { }
    const params = new URLSearchParams();
    params.set('mode', 'companion');
    params.set('room', roomId);
    params.set('sourceId', sourceId);
    if (sourceLabel) params.set('sourceLabel', sourceLabel);
    params.set('t', String(Date.now()));
    if (peerMode === 'custom') {
      let host = peerHost.trim();
      if (!host || host === "localhost" || host === "127.0.0.1") {
        try {
          const u = new URL(url);
          host = u.hostname;
        } catch { }
      }
      if (host) {
        params.set('peerMode', 'custom');
        params.set('peerHost', host);
        params.set('peerPort', peerPort);
        params.set('peerPath', peerPath);
        params.set('peerSecure', peerSecure ? 'true' : 'false');
      }
    }
    if (wifiMode) {
      params.set('wifi', '1');
    }
    return `${url}/?${params.toString()}`;
  };

  useEffect(() => {
    if (peerUiMode === 'auto') {
      setPeerMode('cloud');
      // Persist immediately so getPeerEnv() uses cloud on next peer init
      localStorage.setItem('aether_peer_mode', 'cloud');
      localStorage.setItem('aether_peer_ui_mode', 'auto');
      return;
    }
    if (peerUiMode === 'local') {
      setPeerMode('custom');
      setPeerHost('localhost');
      setPeerPort('9000');
      setPeerPath('/peerjs');
      setPeerSecure(false);
      localStorage.setItem('aether_peer_mode', 'custom');
      localStorage.setItem('aether_peer_ui_mode', 'local');
    }
    if (peerUiMode === 'advanced') {
      setPeerMode('custom');
      localStorage.setItem('aether_peer_mode', 'custom');
      localStorage.setItem('aether_peer_ui_mode', 'advanced');
    }
  }, [peerUiMode]);

  const createPhoneSource = () => {
    const currentPhoneCount = cameraSourcesRef.current.filter((s) => s.kind === 'phone').length;
    if (currentPhoneCount >= MAX_PHONE_CAMS) {
      setStatusMsg({ type: 'warn', text: `Phone camera limit reached (${MAX_PHONE_CAMS}). Remove one slot before adding another.` });
      return;
    }
    const id = generateId();
    const label = `Phone Cam ${currentPhoneCount + 1}`;
    const src: CameraSource = { id, kind: 'phone', label, status: 'pending' };
    setCameraSources(prev => {
      const next = [...prev, src];
      cameraSourcesRef.current = next;
      return next;
    });
    setActivePhoneSourceId(id);
    setShowQRModal(true);

    const timer = window.setTimeout(() => {
      setCameraSources(prev => {
        const next = prev.map(s => s.id === id && s.status === 'pending' ? { ...s, status: 'failed' } : s);
        cameraSourcesRef.current = next;
        return next;
      });
    }, 30000);
    phonePendingTimersRef.current.set(id, timer);
  };

  const openPhoneQr = (sourceId: string) => {
    const pendingTimer = phonePendingTimersRef.current.get(sourceId);
    if (pendingTimer) {
      window.clearTimeout(pendingTimer);
      phonePendingTimersRef.current.delete(sourceId);
    }
    setActivePhoneSourceId(sourceId);
    setCameraSources(prev => {
      const next = prev.map(s => s.id === sourceId && s.status !== 'live' ? { ...s, status: 'pending' } : s);
      cameraSourcesRef.current = next;
      return next;
    });
    const timer = window.setTimeout(() => {
      setCameraSources(prev => {
        const next = prev.map(s => s.id === sourceId && s.status === 'pending' ? { ...s, status: 'failed' } : s);
        cameraSourcesRef.current = next;
        return next;
      });
    }, 30000);
    phonePendingTimersRef.current.set(sourceId, timer);
    setShowQRModal(true);
  };

  const updateSourceLabel = (id: string, label: string) => {
    setCameraSources(prev => prev.map(s => s.id === id ? { ...s, label } : s));
  };

  const removeSource = (id: string) => {
    const src = cameraSourcesRef.current.find(s => s.id === id);
    if (src?.stream) {
      try { src.stream.getTracks().forEach(t => t.stop()); } catch { }
    }
    if (src?.audioTrackId) {
      setAudioTracks(prev => prev.filter(t => t.id !== src.audioTrackId));
    }
    if (src?.layerId) {
      setLayers(prev => prev.filter(l => l.id !== src.layerId));
    }
    if (src?.layerId && selectedLayerId === src.layerId) {
      setSelectedLayerId(null);
    }
    if (src?.layerId && composerMainLayerIdRef.current === src.layerId) {
      setComposerMainLayerId(null);
    }
    if (src?.kind === 'phone') {
      const micId = `mobile-mic-${id}`;
      setAudioTracks(prev => prev.filter(t => t.id !== micId));
    }
    const timer = phonePendingTimersRef.current.get(id);
    if (timer) {
      window.clearTimeout(timer);
      phonePendingTimersRef.current.delete(id);
    }
    const activeCall = phoneCallsRef.current.get(id);
    if (activeCall) {
      try { activeCall.close(); } catch { }
      phoneCallsRef.current.delete(id);
    }
    mobileMetaRef.current.forEach((meta, peer) => {
      if (meta.sourceId === id) {
        mobileMetaRef.current.delete(peer);
      }
    });
    setCameraSources(prev => {
      const next = prev.filter(s => s.id !== id);
      cameraSourcesRef.current = next;
      return next;
    });
  };

  const makeMain = (layerId?: string) => {
    if (!layerId) return;
    // Direct camera switch — no transition overlay. Transitions are for scene cuts.
    setLayers(prev => {
      const maxZ = prev.reduce((m, l) => Math.max(m, l.zIndex), 0) + 1;
      return prev.map(l => l.id === layerId
        ? { ...l, x: 0, y: 0, width: 1920, height: 1080, zIndex: maxZ, visible: true }
        : { ...l, visible: l.visible ?? true }
      );
    });
    setComposerMainLayerId(layerId);
    setSelectedLayerId(layerId);
    if (composerMode) {
      applyComposerLayoutState(layerId, undefined, undefined, { persistMainLayerId: true });
    }
  };

  const ensureLowerThirdLayers = () => {
    if (lowerThirdIdsRef.current.nameId && lowerThirdIdsRef.current.titleId) return;
    const nameId = generateId();
    const titleId = generateId();
    lowerThirdIdsRef.current = { nameId, titleId };
    setLayers(prev => ([
      ...prev,
      {
        id: nameId,
        type: SourceType.TEXT,
        label: 'Lower Third Name',
        visible: lowerThirdVisible,
        x: 60,
        y: 880,
        width: 800,
        height: 52,
        content: lowerThirdName,
        zIndex: 900,
        style: {
          fontSize: 36, fontFamily: 'Inter', fontWeight: 'bold', color: '#ffffff',
          bgColor: 'rgba(0,0,0,0.8)', bgPadding: 16, bgRounding: 8,
          accentColor: lowerThirdAccentColor, accentWidth: 5,
          slideIn: true, slideSpeed: 80,
        },
      },
      {
        id: titleId,
        type: SourceType.TEXT,
        label: 'Lower Third Title',
        visible: lowerThirdVisible,
        x: 60,
        y: 948,
        width: 800,
        height: 36,
        content: lowerThirdTitle,
        zIndex: 901,
        style: {
          fontSize: 22, fontFamily: 'Inter', fontWeight: 'normal', color: '#94a3b8',
          bgColor: 'rgba(0,0,0,0.65)', bgPadding: 12, bgRounding: 6,
          slideIn: true, slideSpeed: 70,
        },
      }
    ]));
  };

  const updateLowerThirdContent = () => {
    const { nameId, titleId } = lowerThirdIdsRef.current;
    if (!nameId || !titleId) return;
    setLayers(prev => prev.map(l => {
      if (l.id === nameId) return { ...l, content: lowerThirdName };
      if (l.id === titleId) return { ...l, content: lowerThirdTitle };
      return l;
    }));
  };

  const setLowerThirdVisibility = (visible: boolean) => {
    ensureLowerThirdLayers();
    const { nameId, titleId } = lowerThirdIdsRef.current;
    setLowerThirdVisible(visible);
    setLayers(prev => prev.map(l => {
      if (l.id === nameId || l.id === titleId) return { ...l, visible };
      return l;
    }));
  };

  const showLowerThirdTemporarily = (ms: number) => {
    setLowerThirdVisibility(true);
    window.setTimeout(() => setLowerThirdVisibility(false), ms);
  };

  const ensurePinnedLayer = () => {
    if (pinnedLayerIdRef.current) return;
    const id = generateId();
    pinnedLayerIdRef.current = id;
    setLayers(prev => ([
      ...prev,
      {
        id,
        type: SourceType.TEXT,
        label: 'Pinned Comment',
        visible: pinnedVisible,
        x: 60,
        y: 40,
        width: 900,
        height: 40,
        content: pinnedMessage,
        zIndex: 850,
        style: { fontSize: 24, fontFamily: 'Inter', fontWeight: 'bold', color: '#fbbf24' },
      }
    ]));
  };

  const ensureTickerLayer = () => {
    if (tickerLayerIdRef.current) return;
    const id = generateId();
    tickerLayerIdRef.current = id;
    setLayers(prev => ([
      ...prev,
      {
        id,
        type: SourceType.TEXT,
        label: 'Chat Ticker',
        visible: tickerVisible,
        x: 0,
        y: 680,
        width: 1280,
        height: 30,
        content: tickerMessage,
        zIndex: 840,
        style: { fontSize: 20, fontFamily: 'Inter', fontWeight: 'normal', color: '#a78bfa', scrolling: true, scrollSpeed: 2 },
      }
    ]));
  };

  const setPinnedVisibility = (visible: boolean) => {
    ensurePinnedLayer();
    const id = pinnedLayerIdRef.current;
    setPinnedVisible(visible);
    setLayers(prev => prev.map(l => l.id === id ? { ...l, visible } : l));
  };

  const setTickerVisibility = (visible: boolean) => {
    ensureTickerLayer();
    const id = tickerLayerIdRef.current;
    setTickerVisible(visible);
    setLayers(prev => prev.map(l => l.id === id ? { ...l, visible } : l));
  };

  const addDestination = () => {
    setDestinations(prev => [
      ...prev,
      { id: generateId(), label: 'Extra Stream', url: '', enabled: true }
    ]);
  };

  const updateDestination = (id: string, updates: Partial<StreamDestination>) => {
    setDestinations(prev => prev.map(d => d.id === id ? { ...d, ...updates } : d));
  };

  const removeDestination = (id: string) => {
    setDestinations(prev => prev.filter(d => d.id !== id));
  };

  const resolveOrderedComposerLayerIds = useCallback((overrideOrder?: string[]) => {
    const cameraLayerIds = cameraSourcesRef.current
      .map((source) => source.layerId)
      .filter((layerId): layerId is string => !!layerId);
    const screenLayerIds = layersRef.current
      .filter((layer) => layer.type === SourceType.SCREEN)
      .map((layer) => layer.id);
    const preferredScreenId = composerMainLayerId && screenLayerIds.includes(composerMainLayerId) ? composerMainLayerId : null;
    const luminaPrimaryId = preferredScreenId || (luminaState.hasProjectorContent ? screenLayerIds[0] || null : null);
    const baseOrder = luminaPrimaryId
      ? [luminaPrimaryId, ...cameraLayerIds, ...screenLayerIds.filter((id) => id !== luminaPrimaryId)]
      : [...cameraLayerIds, ...screenLayerIds];
    const uniqueBase = Array.from(new Set(baseOrder.filter(Boolean)));
    if (!Array.isArray(overrideOrder) || overrideOrder.length === 0) return uniqueBase;

    const uniqueOverride = Array.from(new Set(overrideOrder.map((id) => String(id || '').trim()).filter(Boolean)));
    const prioritized = uniqueOverride.filter((id) => uniqueBase.includes(id));
    const remaining = uniqueBase.filter((id) => !prioritized.includes(id));
    return [...prioritized, ...remaining];
  }, [composerMainLayerId, luminaState.hasProjectorContent]);

  const applyComposerLayoutState = useCallback((
    mainOverride?: string | null,
    layoutOverride?: ComposerLayoutTemplate,
    cameraOrderOverride?: string[],
    options?: {
      themeId?: LayoutThemeId | null;
      swappedRoles?: boolean;
      backgroundStyle?: BackgroundStyleId;
      frameStyle?: FrameStyleId;
      motionStyle?: MotionStyleId;
      persistMainLayerId?: boolean;
    }
  ) => {
    const effectiveThemeId = options?.themeId || layoutThemeRef.current;
    const selection = buildLayoutSelection(effectiveThemeId, {
      backgroundStyle: options?.backgroundStyle || backgroundStyleRef.current,
      frameStyle: options?.frameStyle || frameStyleRef.current,
      motionStyle: options?.motionStyle || motionStyleRef.current,
    });
    const effectiveTemplate = layoutOverride || selection.layoutTemplate;
    const mediaLayerIds = resolveOrderedComposerLayerIds(cameraOrderOverride);
    const resolvedMainLayerId = resolveComposerMainLayerId({
      mediaLayerIds,
      composerMainLayerId: mainOverride ?? composerMainLayerIdRef.current,
      selectedLayerId: selectedLayerId,
    });

    if (mediaLayerIds.length === 0) {
      setComposerRenderMeta(
        computeComposerLayout({
          layoutTemplate: effectiveTemplate,
          cameraLayerIds: [],
          canvasWidth: 1920,
          canvasHeight: 1080,
          maxComposedCameras: MAX_COMPOSED_CAMERAS,
          themeId: effectiveThemeId,
          backgroundStyle: selection.backgroundStyle,
          frameStyle: selection.frameStyle,
          motionStyle: selection.motionStyle,
          aspectRatioBehavior: selection.aspectRatioBehavior,
          safeMargins: selection.safeMargins,
          swappedRoles: options?.swappedRoles ?? swapPendingRef.current,
        }).renderMeta
      );
      return;
    }

    const result = computeComposerLayout({
      layoutTemplate: effectiveTemplate,
      cameraLayerIds: mediaLayerIds,
      selectedMainLayerId: resolvedMainLayerId,
      cameraOrderOverride,
      canvasWidth: 1920,
      canvasHeight: 1080,
      maxComposedCameras: MAX_COMPOSED_CAMERAS,
      themeId: effectiveThemeId,
      backgroundStyle: selection.backgroundStyle,
      frameStyle: selection.frameStyle,
      motionStyle: selection.motionStyle,
      aspectRatioBehavior: selection.aspectRatioBehavior,
      safeMargins: selection.safeMargins,
      swappedRoles: options?.swappedRoles ?? swapPendingRef.current,
    });
    setComposerRenderMeta(result.renderMeta);
    setBackgroundSourceLayerId(result.resolvedMainLayerId || mediaLayerIds[0] || null);
    if (options?.persistMainLayerId && result.resolvedMainLayerId && result.resolvedMainLayerId !== composerMainLayerIdRef.current) {
      setComposerMainLayerId(result.resolvedMainLayerId);
    }

    const placementById = result.placements;
    const mediaSet = new Set(mediaLayerIds);
    // Ensure image/text overlay layers always render above camera placements.
    // Composer layout assigns z-indexes starting at 100 (main) and 200+ (thumbs).
    const maxPlacementZIndex = Object.values(placementById).reduce(
      (max, p) => Math.max(max, p.zIndex),
      0
    );
    setLayers((prev) =>
      prev.map((layer) => {
        if (!mediaSet.has(layer.id)) {
          // Boost visible image/text layers above all camera placements so they
          // don't get buried when the main camera expands to fill the canvas.
          if (
            layer.visible &&
            (layer.type === SourceType.IMAGE || layer.type === SourceType.TEXT) &&
            maxPlacementZIndex > 0 &&
            layer.zIndex <= maxPlacementZIndex
          ) {
            return { ...layer, zIndex: maxPlacementZIndex + 10 };
          }
          return layer;
        }
        const placement = placementById[layer.id];
        if (!placement) return { ...layer, visible: false };

        return {
          ...layer,
          x: placement.x,
          y: placement.y,
          width: placement.width,
          height: placement.height,
          zIndex: placement.zIndex,
          visible: placement.visible,
          style: placement.styleAdjustments
            ? { ...layer.style, ...placement.styleAdjustments }
            : layer.style,
        };
      })
    );

    if (result.hiddenLayerIds.length !== hiddenByLayoutRef.current) {
      hiddenByLayoutRef.current = result.hiddenLayerIds.length;
      if (result.hiddenLayerIds.length > 0) {
        const hiddenCount = result.hiddenLayerIds.length;
        setStatusMsg({
          type: 'info',
          text: `${hiddenCount} source${hiddenCount > 1 ? 's are' : ' is'} hidden by layout cap.`,
        });
      }
    }
  }, [resolveOrderedComposerLayerIds, selectedLayerId]);

  const selectLayoutTheme = useCallback((themeId: LayoutThemeId) => {
    const theme = getLayoutThemeDefinition(themeId);
    setPreviewTheme(themeId);
    setPreviewLayoutPack(theme.packId);
    setPreviewLayoutTemplate(theme.layoutTemplate);
    setPreviewBackgroundStyle(theme.backgroundStyle);
    setPreviewFrameStyle(theme.frameStyle);
    setPreviewMotionStyle(theme.motionStyle);
  }, []);

  const openLayoutThemeLibrary = useCallback(() => {
    const themeLibrary = layoutThemeLibraryRef.current;
    if (!themeLibrary) return;
    themeLibrary.open = true;
    themeLibrary.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, []);

  const startOperatorRailResize = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    if (window.innerWidth < 768) return;
    operatorRailResizeRef.current = {
      startX: event.clientX,
      startWidth: operatorRailWidth,
    };
    event.preventDefault();
  }, [operatorRailWidth]);

  const handleInputRailTrackMouseDown = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    const scrollState = inputRailScrollStateRef.current;
    if (!scrollState.overflow) return;
    const trackRect = event.currentTarget.getBoundingClientRect();
    const thumbHeight = Math.max(48, scrollState.thumbHeight);
    const maxThumbTop = Math.max(0, trackRect.height - thumbHeight);
    const nextThumbTop = Math.max(
      0,
      Math.min(maxThumbTop, event.clientY - trackRect.top - (thumbHeight / 2))
    );
    const progress = maxThumbTop <= 0 ? 0 : nextThumbTop / maxThumbTop;
    applyInputRailGlobalProgress(progress);
    event.preventDefault();
  }, [applyInputRailGlobalProgress]);

  const startInputRailThumbDrag = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    const scrollState = inputRailScrollStateRef.current;
    if (!scrollState.overflow) {
      event.preventDefault();
      return;
    }
    const track = event.currentTarget.parentElement;
    if (!track) return;
    const trackRect = track.getBoundingClientRect();
    const thumbHeight = Math.max(48, scrollState.thumbHeight);
    const thumbTop = scrollState.thumbTop;
    inputRailThumbDragRef.current = {
      trackTop: trackRect.top,
      thumbHeight,
      dragOffset: event.clientY - trackRect.top - thumbTop,
    };
    event.preventDefault();
    event.stopPropagation();
  }, []);

  const previewSelectedLayoutTheme = useCallback(() => {
    const nextThemeId = previewThemeRef.current;
    const nextMainLayerId = composerMainLayerIdRef.current || selectedLayerId || null;
    setComposerMode(true);
    setLayoutTheme(nextThemeId);
    setLayoutPack(previewLayoutPackRef.current);
    setLayoutTemplate(previewLayoutTemplateRef.current);
    setBackgroundStyle(previewBackgroundStyleRef.current);
    setFrameStyle(previewFrameStyleRef.current);
    setMotionStyle(previewMotionStyleRef.current);
    applyComposerLayoutState(nextMainLayerId, previewLayoutTemplateRef.current, undefined, {
      themeId: nextThemeId,
      backgroundStyle: previewBackgroundStyleRef.current,
      frameStyle: previewFrameStyleRef.current,
      motionStyle: previewMotionStyleRef.current,
      swappedRoles: swapPendingRef.current,
      persistMainLayerId: true,
    });
  }, [applyComposerLayoutState, selectedLayerId]);

  const applySelectedLayoutTheme = useCallback((themeId?: LayoutThemeId) => {
    const nextMainLayerId = composerMainLayerIdRef.current || selectedLayerId || null;
    if (themeId) {
      const theme = getLayoutThemeDefinition(themeId);
      setComposerMode(true);
      setLayoutTheme(themeId);
      setPreviewTheme(themeId);
      setAppliedTheme(themeId);
      setLayoutPack(theme.packId);
      setPreviewLayoutPack(theme.packId);
      setLayoutTemplate(theme.layoutTemplate);
      setPreviewLayoutTemplate(theme.layoutTemplate);
      setBackgroundStyle(theme.backgroundStyle);
      setPreviewBackgroundStyle(theme.backgroundStyle);
      setFrameStyle(theme.frameStyle);
      setPreviewFrameStyle(theme.frameStyle);
      setMotionStyle(theme.motionStyle);
      setPreviewMotionStyle(theme.motionStyle);
      applyComposerLayoutState(nextMainLayerId, theme.layoutTemplate, undefined, {
        themeId,
        backgroundStyle: theme.backgroundStyle,
        frameStyle: theme.frameStyle,
        motionStyle: theme.motionStyle,
        swappedRoles: swapPendingRef.current,
        persistMainLayerId: true,
      });
      return;
    }

    const nextThemeId = previewThemeRef.current;
    setComposerMode(true);
    setLayoutTheme(nextThemeId);
    setAppliedTheme(nextThemeId);
    setLayoutPack(previewLayoutPackRef.current);
    setLayoutTemplate(previewLayoutTemplateRef.current);
    setBackgroundStyle(previewBackgroundStyleRef.current);
    setFrameStyle(previewFrameStyleRef.current);
    setMotionStyle(previewMotionStyleRef.current);
    applyComposerLayoutState(nextMainLayerId, previewLayoutTemplateRef.current, undefined, {
      themeId: nextThemeId,
      backgroundStyle: previewBackgroundStyleRef.current,
      frameStyle: previewFrameStyleRef.current,
      motionStyle: previewMotionStyleRef.current,
      swappedRoles: swapPendingRef.current,
      persistMainLayerId: true,
    });
  }, [applyComposerLayoutState, selectedLayerId]);

  const applyIntentLayout = useCallback((intent: BroadcastIntent, reason: string) => {
    if (!intentDirectorOnRef.current || !smartLayoutEnabledRef.current) return;
    const now = Date.now();
    const cooldown = Math.max(200, Number(intentCooldownMs || 1200));
    if (now - intentLastSwitchedAtRef.current < cooldown) return;
    if (intentLastAppliedRef.current === intent && now - intentLastSwitchedAtRef.current < cooldown * 2) return;

    const themeByIntent: Record<BroadcastIntent, LayoutThemeId | null> = {
      speakerFocus: 'speaker_focus',
      scriptureFocus: 'scripture_focus',
      broadcastFocus: luminaState.hasProjectorContent ? 'sermon_split' : 'broadcast_studio',
      audienceInteraction: null,
    };

    const targetTheme = themeByIntent[intent];
    intentLastSwitchedAtRef.current = now;
    intentLastAppliedRef.current = intent;
    setIntentDirectorStatus(`${intent} · ${reason}`);

    if (intent === 'audienceInteraction' && pinnedMessage.trim()) {
      setPinnedVisibility(true);
    }

    if (!targetTheme) return;

    runTransition(() => {
      setSwapPending(false);
      applySelectedLayoutTheme(targetTheme);
    });
  }, [applySelectedLayoutTheme, intentCooldownMs, luminaState.hasProjectorContent, pinnedMessage]);

  const routeIntentSignal = useCallback((signalName: string, payload?: any) => {
    const eventName = String(signalName || '').toLowerCase();
    if (!eventName || !intentDirectorOnRef.current) return;

    const nextLuminaState = normalizeLuminaState(signalName, payload);
    setLuminaState(nextLuminaState);

    const inferredIntent = inferIntentFromLuminaState(nextLuminaState);
    const inferredTheme = inferThemeFromLuminaState(nextLuminaState);
    if (inferredTheme) {
      setIntentDirectorStatus(`lumina ${nextLuminaState.contentMode}`);
    }
    if (inferredIntent) {
      applyIntentLayout(inferredIntent, signalName);
      return;
    }

    if (
      eventName.includes('scripture') ||
      eventName.includes('slidechanged') ||
      eventName.includes('slide.change') ||
      payload?.scripture === true
    ) {
      applyIntentLayout('scriptureFocus', signalName);
      return;
    }

    if (
      eventName.includes('sermon') ||
      eventName.includes('presentation') ||
      payload?.projectorActive === true
    ) {
      applyIntentLayout('broadcastFocus', signalName);
      return;
    }

    if (
      eventName.includes('speaker') ||
      eventName.includes('audio') ||
      eventName.includes('camera')
    ) {
      applyIntentLayout('speakerFocus', signalName);
      return;
    }

    if (
      eventName.includes('question') ||
      eventName.includes('message') ||
      eventName.includes('audience')
    ) {
      applyIntentLayout('audienceInteraction', signalName);
    }
  }, [applyIntentLayout]);

  useEffect(() => {
    routeIntentSignalRef.current = routeIntentSignal;
  }, [routeIntentSignal]);

  const saveScenePreset = () => {
    const positions = layers.map(l => ({
      layerId: l.id,
      x: l.x,
      y: l.y,
      width: l.width,
      height: l.height,
      zIndex: l.zIndex,
    }));
    setScenePresets(prev => [
      ...prev,
      {
        id: generateId(),
        name: presetName.trim() || `Preset ${prev.length + 1}`,
        layout: layoutTemplate,
        themeId: appliedTheme,
        backgroundStyle,
        frameStyle,
        motionStyle,
        layoutPack,
        brandColors,
        mainLayerId: composerMainLayerId || selectedLayerId,
        positions,
        version: 2,
        cameraOrder: resolveOrderedComposerLayerIds(),
        swappedRoles: swapPending,
      }
    ]);
    setStatusMsg({ type: 'info', text: 'Scene preset saved.' });
  };

  const loadScenePresetById = (id: string) => {
    const preset = scenePresets.find(p => p.id === id);
    if (!preset) return;

    if (preset.layout === 'freeform') {
      setComposerMode(false);
      setAppliedTheme(preset.themeId);
      setLayoutTheme(preset.themeId);
      setPreviewTheme(preset.themeId);
      setPreviewLayoutTemplate('freeform');
      setBackgroundStyle(preset.backgroundStyle);
      setPreviewBackgroundStyle(preset.backgroundStyle);
      setFrameStyle(preset.frameStyle);
      setPreviewFrameStyle(preset.frameStyle);
      setMotionStyle(preset.motionStyle);
      setPreviewMotionStyle(preset.motionStyle);
      setLayoutPack(preset.layoutPack);
      setPreviewLayoutPack(preset.layoutPack);
      setBrandColors(preset.brandColors);
      setSwapPending(!!preset.swappedRoles);
      setComposerMainLayerId(preset.mainLayerId || null);
      setLayoutTemplate('freeform');
      setLayers(prev => prev.map(l => {
        const pos = preset.positions.find(p => p.layerId === l.id);
        if (!pos) return l;
        return {
          ...l,
          x: pos.x,
          y: pos.y,
          width: pos.width,
          height: pos.height,
          zIndex: pos.zIndex,
          visible: true,
        };
      }));
      hiddenByLayoutRef.current = 0;
    } else {
      const mainLayerId = preset.mainLayerId || composerMainLayerIdRef.current || selectedLayerId || null;
      setComposerMode(true);
      setAppliedTheme(preset.themeId);
      setLayoutTheme(preset.themeId);
      setPreviewTheme(preset.themeId);
      setPreviewLayoutTemplate(preset.layout);
      setBackgroundStyle(preset.backgroundStyle);
      setPreviewBackgroundStyle(preset.backgroundStyle);
      setFrameStyle(preset.frameStyle);
      setPreviewFrameStyle(preset.frameStyle);
      setMotionStyle(preset.motionStyle);
      setPreviewMotionStyle(preset.motionStyle);
      setLayoutPack(preset.layoutPack);
      setPreviewLayoutPack(preset.layoutPack);
      setBrandColors(preset.brandColors);
      setSwapPending(!!preset.swappedRoles);
      setComposerMainLayerId(mainLayerId);
      setLayoutTemplate(preset.layout);
      if (mainLayerId) setSelectedLayerId(mainLayerId);
      applyComposerLayoutState(mainLayerId, preset.layout, preset.cameraOrder, {
        themeId: preset.themeId,
        backgroundStyle: preset.backgroundStyle,
        frameStyle: preset.frameStyle,
        motionStyle: preset.motionStyle,
        swappedRoles: preset.swappedRoles,
        persistMainLayerId: true,
      });
    }

    setStatusMsg({ type: 'info', text: `Loaded preset: ${preset.name}` });
  };

  const deleteScenePreset = (id: string) => {
    setScenePresets(prev => prev.filter(p => p.id !== id));
  };

  const setSourceAudioActive = (sourceId: string) => {
    setCameraSources(prev => prev.map(s => s.id === sourceId ? { ...s } : s));
    setAudioTracks(prev => prev.map(t => {
      const owner = cameraSources.find(s => s.audioTrackId === t.id);
      if (!owner) return t;
      if (owner.id === sourceId) return { ...t, muted: false };
      return { ...t, muted: true };
    }));
  };

  const composerLayerSignature = [
    ...cameraSources.map((source) => source.layerId || '').filter(Boolean),
    ...layers.filter((layer) => layer.type === SourceType.SCREEN).map((layer) => layer.id),
  ].join('|');

  useEffect(() => {
    if (!composerMode || layoutTemplate === 'freeform') {
      hiddenByLayoutRef.current = 0;
      return;
    }
    applyComposerLayoutState();
  }, [composerMode, layoutTemplate, composerLayerSignature, composerMainLayerId, applyComposerLayoutState, layoutTheme, backgroundStyle, frameStyle, motionStyle, swapPending]);

  const cutToNext = () => {
    if (cameraSources.length === 0) return;
    const currentLayerId = resolveProgramLayerId({
      composerMode,
      composerMainLayerId,
      selectedLayerId,
    });
    const idx = cameraSources.findIndex(s => s.layerId === currentLayerId);
    const next = cameraSources[(idx + 1) % cameraSources.length] || cameraSources[0];
    runTransition(() => makeMain(next.layerId));
  };

  const emergencyWide = () => {
    const wide =
      cameraSources.find(s => s.kind === 'local') ||
      cameraSources.find(s => s.kind === 'phone') ||
      null;
    if (wide) makeMain(wide.layerId);
  };

  const runTransition = (action: () => void) => {
    if (transitionMode === 'cut' || transitionMs <= 0) {
      if (transitionRafRef.current) {
        cancelAnimationFrame(transitionRafRef.current);
        transitionRafRef.current = null;
      }
      transitionTokenRef.current += 1;
      setTransitionAlpha(0);
      action();
      return;
    }

    transitionTokenRef.current += 1;
    const token = transitionTokenRef.current;
    setTransitionAlpha(0);

    if (transitionRafRef.current) {
      cancelAnimationFrame(transitionRafRef.current);
      transitionRafRef.current = null;
    }

    const duration = Math.max(120, transitionMs);
    const half = duration / 2;
    const start = performance.now();
    let switched = false;

    const step = (now: number) => {
      if (token !== transitionTokenRef.current) {
        setTransitionAlpha(0);
        return;
      }
      const t = now - start;
      if (t < duration) {
        setTransitionAlpha(computeTransitionAlpha(t, duration));
      }

      if (t >= half && !switched) {
        action();
        switched = true;
      }

      if (t < duration) {
        transitionRafRef.current = requestAnimationFrame(step);
      } else {
        if (token !== transitionTokenRef.current) {
          setTransitionAlpha(0);
          return;
        }
        setTransitionAlpha(0);
        transitionRafRef.current = null;
      }
    };

    transitionRafRef.current = requestAnimationFrame(step);
  };

  useEffect(() => {
    return () => {
      transitionTokenRef.current += 1;
      if (transitionRafRef.current) {
        cancelAnimationFrame(transitionRafRef.current);
        transitionRafRef.current = null;
      }
    };
  }, []);

  // --- Transition overlay color (passed to CanvasStage) ---
  const transitionColor = transitionMode === 'dip_white' ? '#ffffff' : '#000000';

  useEffect(() => {
    if (autoDirectorTimerRef.current) {
      window.clearInterval(autoDirectorTimerRef.current);
      autoDirectorTimerRef.current = null;
    }
    if (!autoDirectorOn || cameraSources.length < 2) { setAutoDirectorCountdown(0); return; }
    const intervalSec = Math.max(3, Number(autoDirectorInterval) || 12);
    const intervalMs = intervalSec * 1000;
    let lastSwitchAt = Date.now();

    // Countdown ticker (updates every second)
    const countdownTimer = window.setInterval(() => {
      const elapsed = (Date.now() - lastSwitchAt) / 1000;
      setAutoDirectorCountdown(Math.max(0, Math.ceil(intervalSec - elapsed)));
    }, 500);

    autoDirectorTimerRef.current = window.setInterval(() => {
      lastSwitchAt = Date.now();
      const currentProgramLayerId = resolveProgramLayerId({
        composerMode,
        composerMainLayerId,
        selectedLayerId,
      });
      if (autoDirectorMode === 'random') {
        // Random: pick a camera that isn't the current one
        const others = cameraSources.filter(s => s.layerId && s.layerId !== currentProgramLayerId);
        if (others.length > 0) {
          const pick = others[Math.floor(Math.random() * others.length)];
          runTransition(() => makeMain(pick.layerId));
        } else {
          cutToNext();
        }
      } else if (autoDirectorMode === 'audio_reactive') {
        // Audio-reactive: pick camera with loudest mic
        let bestDb = -Infinity;
        let bestLayerId: string | undefined;
        cameraSources.forEach(s => {
          if (!s.audioTrackId || !s.layerId) return;
          const hg = hyperGateNodes.current.get(s.audioTrackId);
          if (!hg) return;
          const db = rmsDbFromAnalyser(hg.analyser);
          if (db > bestDb) { bestDb = db; bestLayerId = s.layerId; }
        });
        if (bestLayerId && bestLayerId !== currentProgramLayerId) {
          runTransition(() => makeMain(bestLayerId));
        }
      } else {
        cutToNext();
      }
    }, intervalMs);

    return () => {
      if (autoDirectorTimerRef.current) {
        window.clearInterval(autoDirectorTimerRef.current);
        autoDirectorTimerRef.current = null;
      }
      window.clearInterval(countdownTimer);
      setAutoDirectorCountdown(0);
    };
  }, [autoDirectorOn, autoDirectorInterval, autoDirectorMode, cameraSources.length, composerMode, composerMainLayerId, selectedLayerId]);

  // --- Audience message rotation ---
  useEffect(() => {
    if (!audienceRotateOn || audienceMessages.length === 0) return;
    const intervalMs = Math.max(3, audienceRotateInterval) * 1000;
    const timer = window.setInterval(() => {
      setAudienceCurrentIdx(prev => {
        const next = (prev + 1) % audienceMessages.length;
        setPinnedMessage(audienceMessages[next] || '');
        return next;
      });
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [audienceRotateOn, audienceRotateInterval, audienceMessages]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT") return;
      if (e.key >= "1" && e.key <= "9") {
        const idx = Number(e.key) - 1;
        const src = cameraSources[idx];
        if (src?.layerId) makeMain(src.layerId);
      }
      if (e.key === "0") emergencyWide();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cameraSources, emergencyWide, makeMain]);

  const testPeerServer = async () => {
    const mode = peerMode;
    if (mode === 'cloud') {
      setStatusMsg({ type: 'info', text: 'Cloud mode selected. PeerJS cloud should be reachable.' });
      return;
    }

    const host = (peerHost || 'localhost').trim().replace(/^https?:\/\//i, '');
    const port = Number(peerPort) || 9000;
    const path = (peerPath || '/peerjs').trim();
    const protocol = peerSecure ? 'https' : 'http';
    const base = `${protocol}://${host}:${port}`;
    // PeerJS REST endpoint uses /<path>/peerjs/id
    const cleanPath = path.startsWith('/') ? path : `/${path}`;
    const idUrl = `${base}${cleanPath.replace(/\/$/, '')}/peerjs/id`;

    try {
      const res = await fetch(idUrl, { method: 'GET' });
      if (res.ok) {
        setStatusMsg({ type: 'info', text: `PeerJS OK: ${host}:${port}${path}` });
      } else {
        setStatusMsg({ type: 'warn', text: `PeerJS responded ${res.status}. Check host/port/path.` });
      }
    } catch (err) {
      setStatusMsg({ type: 'error', text: 'PeerJS test failed. Is the server running and reachable?' });
    }
  };

  function applyTrackTone(filter: BiquadFilterNode, compressor: DynamicsCompressorNode, isMic: boolean) {
    if (isMic) {
      // Speech-first profile for better intelligibility.
      filter.type = 'highshelf';
      filter.frequency.value = 4200;
      filter.gain.value = 2.5;
      compressor.threshold.value = -24;
      compressor.knee.value = 20;
      compressor.ratio.value = 3.2;
      compressor.attack.value = 0.004;
      compressor.release.value = 0.16;
      return;
    }

    // Preserve external processed feeds (mixers, virtual cables) with near-neutral shaping.
    filter.type = 'allpass';
    filter.frequency.value = 1000;
    filter.gain.value = 0;
    compressor.threshold.value = -15;
    compressor.knee.value = 24;
    compressor.ratio.value = 2;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.2;
  }

  function createHyperGateChain(ctx: AudioContext) {
    const input = ctx.createGain();
    input.gain.value = 1;
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 70;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.85;
    const gate = ctx.createGain();
    gate.gain.value = 1;
    input.connect(hp);
    hp.connect(analyser);
    hp.connect(gate);
    return { input, hp, analyser, gate };
  }

  function rmsDbFromAnalyser(analyser: AnalyserNode) {
    const buf = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    const rms = Math.sqrt(sum / buf.length) || 1e-8;
    return 20 * Math.log10(rms);
  }

  // --- RENDER ---
  const previewThemeDef = getLayoutThemeDefinition(previewTheme);
  const previewSelection = {
    themeId: previewTheme,
    layoutTemplate: previewLayoutTemplate,
    backgroundStyle: previewBackgroundStyle,
    frameStyle: previewFrameStyle,
    motionStyle: previewMotionStyle,
    safeMargins: previewThemeDef.safeMargins,
    aspectRatioBehavior: previewThemeDef.aspectRatioBehavior,
    packId: previewLayoutPack,
  };
  const activeThemeDef = getLayoutThemeDefinition(layoutTheme);
  const visibleLayoutThemes = LAYOUT_THEMES.filter((theme) => theme.packId === previewLayoutPack);
  const canvasLayoutRevision = buildCanvasLayoutRevision({
    railWidth: operatorRailSize.width,
    viewportWidth: windowViewport.width,
    viewportHeight: windowViewport.height,
    composerMode,
  });
  const aiStatusText = aiHealth ? formatAiHealthMessage(aiHealth) : 'Checking local AI health...';
  const inputSectionHeights = computeInputSectionBodyHeights({ railHeight: operatorRailSize.height });
  const inputSectionBaseClassName = "rounded-2xl border border-[#173046] bg-[#05101b]";
  const inputSectionSummaryClassName = "sticky top-0 z-10 cursor-pointer list-none px-3 py-3 flex items-center justify-between bg-[#05101b]";
  const inputSectionBodyClassName = "min-h-0 overflow-hidden px-3 pb-3 pt-1";
  const inputSectionScrollClassName = "input-section-scroll min-h-0 overflow-x-hidden overflow-y-scroll overscroll-contain pr-1";
  const sectionScrollStyle = {
    inputManager: { maxHeight: inputSectionHeights.medium },
    layoutStudio: { maxHeight: inputSectionHeights.layoutStudio },
    autoDirector: { maxHeight: inputSectionHeights.compact },
    lowerThirds: { maxHeight: inputSectionHeights.standard },
    transitions: { maxHeight: inputSectionHeights.compact },
    scenePresets: { maxHeight: inputSectionHeights.medium },
    audience: { maxHeight: inputSectionHeights.medium },
    phoneSlots: { maxHeight: inputSectionHeights.standard },
  } satisfies Record<string, React.CSSProperties>;
  const manualLayoutOptions = [
    { id: 'main_thumbs' as const, label: 'Main + Thumbs', icon: '▣' },
    { id: 'side_by_side' as const, label: 'Dual Split', icon: '◫' },
    { id: 'pip_corner' as const, label: 'PiP', icon: '△' },
    { id: 'grid_2x2' as const, label: 'Grid', icon: '⊞' },
    { id: 'speaker_focus' as const, label: 'Speaker', icon: '◉' },
    { id: 'scripture_focus' as const, label: 'Scripture', icon: '◧' },
    { id: 'sermon_split_left' as const, label: 'Split Left', icon: '◭' },
    { id: 'sermon_split_right' as const, label: 'Split Right', icon: '◮' },
    { id: 'projector_speaker' as const, label: 'Projector + Spk', icon: '▩' },
  ];
  const layoutPreviewState: CinematicPresetPreview = {
    layoutTheme,
    appliedTheme,
    previewTheme,
    backgroundStyle: previewBackgroundStyle,
    frameStyle: previewFrameStyle,
    motionStyle: previewMotionStyle,
    layoutPack: previewLayoutPack,
    brandColors,
    swappedRoles: swapPending,
  };
  const inputRailThumbHeightPx = inputRailScrollState.overflow
    ? Math.max(48, inputRailScrollState.thumbHeight)
    : INPUT_RAIL_DISABLED_THUMB_HEIGHT;
  // When not overflowing, thumbHeight == trackHeight; center the disabled thumb deterministically.
  const inputRailIdleThumbTop = Math.round(
    Math.max(0, inputRailScrollState.thumbHeight - INPUT_RAIL_DISABLED_THUMB_HEIGHT) / 2
  );
  const inputRailThumbTopPx = inputRailScrollState.overflow
    ? inputRailScrollState.thumbTop
    : inputRailIdleThumbTop;
  const inputRailThumbStyle: React.CSSProperties = {
    top: `${inputRailThumbTopPx}px`,
    height: `${inputRailThumbHeightPx}px`,
  };

  return (
    <div className="fixed inset-0 flex flex-col w-full bg-aether-900/95 text-gray-200 font-sans selection:bg-aether-500 selection:text-white relative overflow-hidden">
      <style>{`
        .prop-scroll-area::-webkit-scrollbar { width: 7px; }
        .prop-scroll-area::-webkit-scrollbar-track { background: #050d18; }
        .prop-scroll-area::-webkit-scrollbar-thumb { background: linear-gradient(180deg,#22d3ee,#7c3aed); border-radius: 999px; }
      `}</style>
      <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleFileUpload} />

      {statusMsg && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 px-6 py-3 rounded-xl text-sm font-bold flex flex-col items-center gap-1 shadow-lg bg-aether-800 border border-aether-700 z-50 min-w-[320px]">
          <div className="w-full flex items-center gap-3">
            <AlertCircle size={20} className={statusMsg.type === 'error' ? 'text-red-400' : 'text-blue-400'} />
            <span className="flex-1">{statusMsg.text}</span>
            <button
              onClick={() => setStatusMsg(null)}
              className="text-gray-400 hover:text-white"
              aria-label="Dismiss status message"
            >
              <X size={16} />
            </button>
          </div>
          {incomingRes && (
            <div className="text-[11px] font-mono opacity-80">
              Incoming: {incomingRes}
            </div>
          )}
        </div>
      )}

      {showDeviceSelector && <DeviceSelectorModal onSelect={addCameraSource} onClose={() => setShowDeviceSelector(false)} />}

      {desktopSources && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-aether-900 border border-aether-700 rounded-xl w-[640px] max-h-[80vh] flex flex-col shadow-2xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-aether-700 shrink-0">
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <Monitor size={18} className="text-aether-400" />
                Select Screen or Window
              </h2>
              <button onClick={() => setDesktopSources(null)} className="text-gray-400 hover:text-white transition-colors">
                <X size={18} />
              </button>
            </div>
            <div className="overflow-y-auto flex-1 p-4">
              {desktopSources.length === 0 ? (
                <div className="text-center text-gray-500 py-10">No screens or windows found.</div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  {desktopSources.map((src) => (
                    <button
                      key={src.id}
                      onClick={() => addDesktopSource(src.id, src.name)}
                      className="group border border-aether-700 rounded-xl overflow-hidden text-left hover:border-aether-400 hover:shadow-[0_0_0_1px_rgba(99,102,241,0.4)] transition-all"
                    >
                      <div className="bg-aether-800 w-full h-36 overflow-hidden">
                        <img src={src.thumbnail} alt={src.name} className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-200" />
                      </div>
                      <div className="px-3 py-2 text-xs font-medium text-gray-300 truncate group-hover:text-white">{src.name}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {showQRModal && activePhoneSourceId && (
        <QRConnectModal
          roomId={roomId}
          sourceId={activePhoneSourceId}
          sourceLabel={cameraSources.find(s => s.id === activePhoneSourceId)?.label || "Phone Cam"}
          relayPort=""
          onClose={() => {
            setShowQRModal(false);
            setActivePhoneSourceId(null);
          }}
        />
      )}
      {showHelpModal && <HelpModal onClose={() => setShowHelpModal(false)} />}

      {micPickerTrackId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-aether-900 border border-aether-700 rounded-xl p-5 w-[520px] shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-white">Select Microphone</h3>
              <button onClick={() => setMicPickerTrackId(null)} className="text-gray-400 hover:text-white">
                <X size={18} />
              </button>
            </div>
            <div className="space-y-2 max-h-72 overflow-y-auto">
              {availableMics.map(m => (
                <button
                  key={m.deviceId}
                  onClick={async () => {
                    try {
                      const candidates: (MediaTrackConstraints | boolean)[] = [
                        buildPreferredAudioConstraints(m.deviceId),
                        { deviceId: { exact: m.deviceId } },
                        true,
                      ];
                      let s: MediaStream | null = null;
                      for (const audioConstraints of candidates) {
                        try {
                          s = await navigator.mediaDevices.getUserMedia({
                            audio: audioConstraints,
                            video: false,
                          });
                          break;
                        } catch { }
                      }
                      if (!s) throw new Error('mic_switch_failed');
                      setAudioTracks(prev => prev.map(t => t.id === micPickerTrackId ? { ...t, stream: s } : t));
                      setMicPickerTrackId(null);
                      setStatusMsg({ type: "info", text: "Microphone switched." });
                    } catch {
                      setStatusMsg({ type: "error", text: "Failed to switch microphone." });
                    }
                  }}
                  className="w-full text-left px-4 py-3 rounded-lg bg-aether-800 hover:bg-aether-700 border border-aether-700 text-gray-200"
                >
                  <div className="text-sm font-semibold">{m.label || "Microphone"}</div>
                  <div className="text-[10px] font-mono text-gray-500">{m.deviceId}</div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <header className="h-12 border-b border-aether-700 bg-aether-900/90 flex items-center justify-between px-4 z-10 backdrop-blur-md">
        <div className="flex items-center gap-2 cursor-pointer" onClick={onBack}>
          <div className="w-8 h-8 bg-gradient-to-br from-aether-500 to-aether-accent rounded-lg flex items-center justify-center shadow-lg">
            <Zap className="text-white fill-current" size={18} />
          </div>
          <h1 className="text-xl font-display font-semibold tracking-tight text-white">
            Aether<span className="text-aether-400 font-normal">Studio</span>
          </h1>
        </div>
        <div className="flex items-center gap-4 bg-aether-800 p-1.5 rounded-full border border-aether-700">
          <div className={`flex items-center gap-2 px-3 py-1 rounded-full text-xs font-bold uppercase ${streamStatus === StreamStatus.LIVE ? 'bg-red-600 text-white animate-pulse' : 'text-gray-500'}`}>
            <Circle size={8} fill={streamStatus !== StreamStatus.IDLE ? "currentColor" : "none"} />
            {streamStatus === StreamStatus.LIVE ? 'ON AIR' : 'Ready'}
          </div>

          <div className={`flex items-center gap-2 px-3 py-1 rounded-full text-xs font-bold uppercase border ${cloudConnected ? 'bg-green-500/10 border-green-500/20 text-green-400' : 'bg-red-500/10 border-red-500/20 text-red-400'}`}>
            <Cloud size={10} /> {cloudConnected ? 'Online' : 'Offline'}
          </div>

          <div className={`flex items-center gap-2 px-3 py-1 rounded-full text-xs font-bold uppercase border ${relayConnected ? 'bg-green-500/10 border-green-500/20 text-green-400' : 'bg-red-500/10 border-red-500/20 text-red-400'}`} title={relayStatus || undefined}>
            <Network size={10} /> {relayConnected ? 'Relay' : 'Relay Offline'}
          </div>
        </div>
        <div className="flex gap-3">
          <button
            onClick={openVirtualCable}
            className="flex items-center gap-2 px-3 py-2 text-aether-400 hover:text-white hover:bg-aether-800 rounded-lg transition-colors text-sm font-medium border border-transparent hover:border-aether-700"
            title="Open Virtual Cable Output Window"
          >
            <Tv size={18} /> Popout Output
          </button>

          <button onClick={() => setShowHelpModal(true)} className="p-2 text-gray-400 hover:text-white hover:bg-aether-800 rounded-lg"><HelpCircle size={20} /></button>
          <button
            onClick={checkForDesktopUpdates}
            disabled={isCheckingUpdates}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${isCheckingUpdates
              ? 'bg-aether-900 border-aether-800 text-gray-500 cursor-not-allowed'
              : 'bg-aether-800 border-aether-700 text-gray-200 hover:bg-aether-700 hover:text-white'
              }`}
            title="Check for app updates"
          >
            <Download size={16} /> {isCheckingUpdates ? 'Checking...' : 'Check Updates'}
          </button>

          <button
            onClick={toggleRecording}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all ${isRecording ? 'bg-white text-red-600' : 'bg-aether-800 border border-aether-700 hover:bg-aether-700'}`}
          >
            {isRecording ? <Square size={18} fill="currentColor" /> : <Disc size={18} />}
            {isRecording ? 'Stop Rec' : 'Record'}
          </button>

          <button
            onClick={toggleLive}
            disabled={!canToggleLive}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-bold transition-all text-sm ${streamStatus === StreamStatus.LIVE
              ? 'bg-red-600 text-white'
              : canToggleLive
                ? 'bg-aether-800 border border-aether-700 hover:bg-aether-700'
                : 'bg-aether-900 border border-aether-800 text-gray-500 cursor-not-allowed opacity-70'
              }`}
            title={!canToggleLive ? "Relay and stream key required" : undefined}
          >
            <Radio size={16} /> {streamStatus === StreamStatus.LIVE ? 'End' : 'Live'}
          </button>
          <button onClick={() => setShowSettings(true)} className="p-2 text-gray-400 hover:text-white hover:bg-aether-800 rounded-lg"><Settings size={20} /></button>
          <button onClick={handleSignOut} className="p-2 text-red-400 hover:text-white hover:bg-red-900/50 rounded-lg" title="Sign Out"><LogOut size={20} /></button>
        </div>
      </header>

      <div
        className="flex flex-1 min-h-0 overflow-hidden flex-col md:grid"
        style={windowViewport.width >= 768 ? { gridTemplateColumns: `56px minmax(0,1fr) ${operatorRailWidth}px` } : undefined}
      >
        <aside className="w-14 hidden md:flex flex-col items-center py-4 gap-4 border-r border-aether-700 bg-aether-800/50">
          <SourceButton icon={<Camera size={20} />} label="Cam" onClick={() => setShowDeviceSelector(true)} />
          <SourceButton icon={<Smartphone size={20} />} label="Mob" onClick={createPhoneSource} disabled={phoneSlotsFull} />
          <SourceButton icon={<Monitor size={20} />} label="Scr" onClick={addScreenSource} />
          <SourceButton icon={<ImageIcon size={20} />} label="Img" onClick={() => fileInputRef.current?.click()} />
          <SourceButton icon={<Type size={20} />} label="Txt" onClick={addTextLayer} />
          <SourceButton icon={<HelpCircle size={20} />} label="Help" onClick={() => setShowHelpModal(true)} />
        </aside>
        <main className="flex-1 min-h-0 flex flex-col relative bg-aether-900/80 overflow-hidden">
          <div className="flex-1 min-h-0 p-1 md:p-2 flex items-center justify-center">
            <CanvasStage
              layers={layers}
              onCanvasReady={handleCanvasReady}
              selectedLayerId={selectedLayerId}
              onSelectLayer={setSelectedLayerId}
              onUpdateLayer={updateLayer}
              isPro={isPro}
              transitionOverlay={{ alpha: transitionAlpha, color: transitionColor, type: transitionMode === 'dip_white' ? 'white' : 'black' }}
              cinematicMeta={composerRenderMeta}
              brandColors={brandColors}
              backgroundSourceLayerId={backgroundSourceLayerId}
              freeformSnapEnabled={composerMode && layoutTemplate === 'freeform'}
              layoutRevision={canvasLayoutRevision}
            />
          </div>
          <AudioMixer
            tracks={audioTracks}
            onUpdateTrack={updateAudioTrack}
            onOpenSettings={openMicPicker}
            audioContext={audioContext.current}
            isLive={streamStatus === StreamStatus.LIVE}
            masterMonitorVolume={masterMonitorVolume}
            onUpdateMasterMonitorVolume={setMasterMonitorVolume}
            onOpenDeviceSettings={() => setShowDeviceSelector(true)}
          />
        </main>
        <div ref={operatorRailRef} className="relative h-full min-h-0 w-full shrink-0 border-t border-aether-700 bg-aether-900 md:border-l md:border-t-0">
          {rightPanelTab === 'inputs' && (
            <button
              type="button"
              onMouseDown={startOperatorRailResize}
              className="absolute bottom-0 left-0 top-0 hidden w-4 -translate-x-1/2 cursor-col-resize items-center justify-center md:flex"
              aria-label="Resize input rail"
              title="Drag to resize input rail"
            >
              <span className="h-28 w-2 rounded-full border border-cyan-400/30 bg-[linear-gradient(180deg,#0b1320,#10253a)] shadow-[0_0_12px_rgba(34,211,238,0.18)]" />
            </button>
          )}
          <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[linear-gradient(180deg,rgba(4,8,18,0.98),rgba(2,6,14,0.98))] shadow-[-18px_0_40px_rgba(0,0,0,0.28)]">
          <div className="flex shrink-0 border-b border-[#163047] bg-[#050d18]">
            <button onClick={() => setRightPanelTab('properties')} className={`flex-1 py-3 text-[10px] font-bold uppercase tracking-[0.18em] flex items-center justify-center gap-1.5 ${rightPanelTab === 'properties' ? 'bg-[#091525] text-white' : 'text-gray-500 hover:text-gray-300'}`}><Sliders size={12} /> Prop</button>
            <button onClick={() => setRightPanelTab('inputs')} className={`flex-1 py-3 text-[10px] font-bold uppercase tracking-[0.18em] flex items-center justify-center gap-1.5 ${rightPanelTab === 'inputs' ? 'bg-[#091525] text-aether-300' : 'text-gray-500 hover:text-gray-300'}`}><Camera size={12} /> In</button>
            <button onClick={() => setRightPanelTab('ai')} className={`flex-1 py-3 text-[10px] font-bold uppercase tracking-[0.18em] flex items-center justify-center gap-1.5 ${rightPanelTab === 'ai' ? 'bg-[#091525] text-aether-300' : 'text-gray-500 hover:text-gray-300'}`}><Sparkles size={12} /> AI</button>
            <button onClick={() => setRightPanelTab('ops')} className={`flex-1 py-3 text-[10px] font-bold uppercase tracking-[0.18em] flex items-center justify-center gap-1.5 ${rightPanelTab === 'ops' ? 'bg-[#091525] text-aether-300' : 'text-gray-500 hover:text-gray-300'}`}><Shield size={12} /> Ops</button>
          </div>
          <div className="flex-1 min-h-0 overflow-hidden">
            {rightPanelTab === 'properties' && (
              <LayerProperties layer={layers.find(l => l.id === selectedLayerId) || null} onUpdate={updateLayer} onDelete={deleteLayer} isPro={isPro} />
            )}
            {rightPanelTab === 'ai' && (
              <AIPanel onAddLayer={(src) => addImageLayer(src, 'AI Background')} />
            )}
            {rightPanelTab === 'ops' && (
              <OpsAgentPanel
                snapshot={{
                  relayConnected,
                  relayStatus,
                  streamHealth,
                  streamStatus: streamStatus === StreamStatus.LIVE ? 'live' : streamStatus === StreamStatus.RECORDING ? 'starting' : 'idle',
                  streamKey,
                  cameraSources: cameraSources.map(c => ({ id: c.id, status: c.status, kind: c.kind, label: c.label })),
                  peerConnected: cloudConnected,
                  wsUrl: getRelayWsUrl(),
                  lastRelayFatal: relayStatus && /fatal|max_restart/i.test(relayStatus) ? relayStatus : null,
                } as SystemSnapshot}
                onReconnectRelay={() => {
                  // Close current WS to trigger its onclose reconnect logic
                  const ws = streamingSocketRef.current;
                  if (ws && ws.readyState === WebSocket.OPEN) {
                    ws.close();
                  }
                }}
                onRestartStream={() => { startStreamingSession({ fromReconnect: true, forceRestart: false }); }}
                onOpenSettings={() => { setShowSettings(true); }}
              />
            )}
            {rightPanelTab === 'inputs' && (
              <div className="relative h-full w-full min-w-0 overflow-hidden p-2">

                {/* ── Toggle Switch Helper ── */}
                {/* Inline CSS for custom toggle switches */}
                <style>{`
                  .aether-toggle { position: relative; display: inline-flex; width: 44px; height: 24px; cursor: pointer; }
                  .aether-toggle input { opacity: 0; width: 0; height: 0; }
                  .aether-toggle .slider { position: absolute; inset: 0; background: #1e1b2e; border: 1px solid #3b3660; border-radius: 999px; transition: all .25s ease; }
                  .aether-toggle .slider::before { content: ''; position: absolute; left: 2px; top: 2px; width: 18px; height: 18px; border-radius: 50%; background: #6b7280; transition: all .25s ease; }
                  .aether-toggle input:checked + .slider { background: #7c3aed; border-color: #8b5cf6; }
                  .aether-toggle input:checked + .slider::before { transform: translateX(20px); background: #ffffff; }
                  .section-btn { padding: 6px 14px; font-size: 12px; border-radius: 6px; font-weight: 600; transition: all .15s ease; }
                  .section-btn:active { transform: scale(0.95); }
                  .section-btn-primary { background: linear-gradient(135deg, #7c3aed, #6d28d9); color: white; }
                  .section-btn-primary:hover { background: linear-gradient(135deg, #8b5cf6, #7c3aed); }
                  .section-btn-danger { background: rgba(239,68,68,0.15); color: #fca5a5; border: 1px solid rgba(239,68,68,0.25); }
                  .section-btn-danger:hover { background: rgba(239,68,68,0.25); }
                  .section-btn-ghost { background: rgba(139,92,246,0.1); color: #c4b5fd; border: 1px solid rgba(139,92,246,0.25); }
                  .section-btn-ghost:hover { background: rgba(139,92,246,0.2); }
                  .section-input { width: 100%; background: #110b20; border: 1px solid #2e2650; border-radius: 6px; padding: 7px 12px; font-size: 13px; color: #e2e8f0; outline: none; transition: border .15s; }
                  .section-input:focus { border-color: #7c3aed; }
                  .status-badge { display: inline-flex; align-items: center; gap: 4px; padding: 3px 10px; border-radius: 999px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; }
                  .status-live { background: rgba(34,197,94,0.15); color: #4ade80; border: 1px solid rgba(34,197,94,0.3); }
                  .status-pending { background: rgba(234,179,8,0.12); color: #fbbf24; border: 1px solid rgba(234,179,8,0.25); }
                  .status-error { background: rgba(239,68,68,0.12); color: #f87171; border: 1px solid rgba(239,68,68,0.25); }
                  .input-rail-scroll { scrollbar-gutter: stable both-edges; scrollbar-width: none; -ms-overflow-style: none; }
                  .input-rail-scroll::-webkit-scrollbar { width: 0; height: 0; }
                  .input-rail-scroll::-webkit-scrollbar-track { background: transparent; border: 0; }
                  .input-rail-scroll::-webkit-scrollbar-thumb { background: transparent; border: 0; }
                  .input-section-scroll { scrollbar-gutter: stable both-edges; scrollbar-width: thin; scrollbar-color: #22d3ee #050d18; }
                  .input-section-scroll::-webkit-scrollbar { width: 12px; }
                  .input-section-scroll::-webkit-scrollbar-track { background: #050d18; border-left: 1px solid rgba(23, 48, 70, 0.7); border-radius: 999px; }
                  .input-section-scroll::-webkit-scrollbar-thumb { background: linear-gradient(180deg, #22d3ee, #7c3aed); border-radius: 999px; border: 2px solid #050d18; }
                  @keyframes pulse-glow { 0%,100% { box-shadow: 0 0 0 0 rgba(239,68,68,0.4); } 50% { box-shadow: 0 0 12px 4px rgba(239,68,68,0.2); } }
                  .emergency-pulse { animation: pulse-glow 1.5s ease-in-out infinite; }
                `}</style>
                <div
                  className="mx-auto flex h-full min-h-0 w-full flex-col overflow-hidden rounded-[22px] border border-[#173046] bg-[#020813] shadow-[0_18px_50px_rgba(0,0,0,0.34)]"
                  style={{ maxWidth: Math.max(372, operatorRailWidth - 12) }}
                >
                  <div className="shrink-0 border-b border-[#173046] bg-[linear-gradient(180deg,rgba(7,16,28,0.96),rgba(3,8,18,0.96))] px-3 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-[11px] font-bold uppercase tracking-[0.28em] text-cyan-300">Input Control Deck</div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] text-slate-400">{cameraSources.length} src</span>
                        <span className={`text-[10px] font-semibold ${aiHealth?.ok ? 'text-emerald-400' : 'text-amber-400'}`}>
                          {aiHealth?.ok ? '● AI' : '○ AI'}
                        </span>
                        <span className="rounded-full border border-[#26445c] bg-[#08101c] px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.15em] text-slate-300">
                          {composerMode ? 'Armed' : 'Standby'}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="relative flex-1 min-h-0 overflow-hidden">
                    <div
                      ref={inputRailScrollRef}
                      className="input-rail-scroll h-full min-h-0 overflow-x-hidden overflow-y-scroll overscroll-contain px-2 py-2 pb-4 pr-6 space-y-2"
                    >

                {/* ─── INPUT MANAGER ─── */}
                <CollapsibleSection
                  title="📹 Input Manager"
                  subtitle={`${cameraSources.length} source${cameraSources.length !== 1 ? 's' : ''} active`}
                  open={inputsSection === 'input-manager'}
                  onToggle={(open) => setInputsSection(open ? 'input-manager' : '')}
                  className={inputSectionBaseClassName}
                  summaryClassName={inputSectionSummaryClassName}
                  bodyClassName={inputSectionBodyClassName}
                  scrollBodyClassName={`${inputSectionScrollClassName} space-y-2`}
                  bodyStyle={sectionScrollStyle.inputManager}
                >
                  <div className="mb-2 space-y-2">
                    <div className="text-xs text-gray-400">Add sources, manage live cuts, and keep controls inside the safe rail.</div>
                    <div className="flex flex-wrap gap-1.5">
                      <button onClick={() => setShowDeviceSelector(true)} className="section-btn section-btn-ghost flex items-center gap-1"><Camera size={12} /> Local</button>
                      <button onClick={createPhoneSource} disabled={phoneSlotsFull} className="section-btn section-btn-ghost flex items-center gap-1"><Smartphone size={12} /> Phone</button>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 gap-2 mb-3">
                    <button onClick={cutToNext} className="section-btn section-btn-primary flex items-center gap-1 w-full justify-center"><ChevronRight size={14} /> Cut To Next</button>
                    <button onClick={emergencyWide} className="section-btn section-btn-danger flex items-center gap-1 w-full justify-center emergency-pulse"><AlertTriangle size={14} /> Emergency Wide</button>
                  </div>

                  {cameraSources.length === 0 && (
                    <div className="text-xs text-gray-400 border border-dashed border-aether-700 rounded-lg p-3 text-center">No camera inputs yet. Add a local or phone camera.</div>
                  )}

                  {cameraSources.map((src, idx) => (
                    <div key={src.id} className="bg-gradient-to-r from-aether-800/60 to-aether-800/30 border border-aether-700/60 rounded-lg p-2 mb-1.5 hover:border-aether-600 transition-colors">
                      <div className="flex items-start gap-2.5">
                        <div className="w-6 h-6 rounded-full bg-aether-700 flex items-center justify-center text-xs font-bold text-aether-300 shrink-0">#{idx + 1}</div>
                        <SourcePreview stream={src.stream} />
                        <div className="flex-1 min-w-0">
                        <input value={src.label} onChange={(e) => updateSourceLabel(src.id, e.target.value)} className="w-full bg-transparent text-sm text-white outline-none border-b border-transparent focus:border-aether-500 truncate" />
                        <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                          <span className={`status-badge ${src.status === 'live' ? 'status-live' : src.status === 'pending' ? 'status-pending' : 'status-error'}`}>
                            <span className="w-1.5 h-1.5 rounded-full" style={{ background: src.status === 'live' ? '#4ade80' : src.status === 'pending' ? '#fbbf24' : '#f87171' }} />
                            {src.status}
                          </span>
                          <span className="text-xs text-gray-400">Press {idx + 1}</span>
                        </div>
                      </div>
                      <div className="flex flex-col gap-1 shrink-0 min-w-[78px]">
                        <button onClick={() => makeMain(src.layerId)} className="section-btn section-btn-primary w-full">Main</button>
                        {src.audioTrackId && <button onClick={() => setSourceAudioActive(src.id)} className="section-btn section-btn-ghost w-full">Audio</button>}
                        <button onClick={() => removeSource(src.id)} className="section-btn section-btn-danger">✕</button>
                      </div>
                    </div>
                    </div>
                  ))}
                </CollapsibleSection>

                <CollapsibleSection
                  title="🎬 Layout Studio"
                  subtitle={composerMode ? `Composer Mode · ${activeThemeDef.name}` : 'Composer Mode Off'}
                  open={inputsSection === 'layout-studio'}
                  onToggle={(open) => setInputsSection(open ? 'layout-studio' : '')}
                  className={inputSectionBaseClassName}
                  summaryClassName={inputSectionSummaryClassName}
                  bodyClassName={inputSectionBodyClassName}
                  scrollBodyClassName={`${inputSectionScrollClassName} space-y-3`}
                  bodyStyle={sectionScrollStyle.layoutStudio}
                  footerClassName="relative z-20 shrink-0 border-t border-[#173046] pointer-events-auto"
                  footer={
                    <div className="bg-[linear-gradient(180deg,rgba(2,8,19,0.18),rgba(2,8,19,0.96))] px-3 pb-3 pt-3 backdrop-blur">
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          onClick={() => runTransition(() => previewSelectedLayoutTheme())}
                          className="section-btn section-btn-ghost"
                        >
                          Preview Layout
                        </button>
                        <button
                          onClick={() => runTransition(() => applySelectedLayoutTheme())}
                          className="section-btn section-btn-primary"
                        >
                          Apply Layout
                        </button>
                        <button
                          onClick={() => {
                            const nextSwap = !swapPending;
                            setSwapPending(nextSwap);
                            if (composerMode) {
                              runTransition(() => applyComposerLayoutState(composerMainLayerIdRef.current || null, layoutTemplateRef.current, undefined, {
                                themeId: layoutThemeRef.current,
                                backgroundStyle: backgroundStyleRef.current,
                                frameStyle: frameStyleRef.current,
                                motionStyle: motionStyleRef.current,
                                swappedRoles: nextSwap,
                                persistMainLayerId: true,
                              }));
                            }
                          }}
                          className="section-btn section-btn-ghost"
                        >
                          Swap Layout
                        </button>
                        <button onClick={saveScenePreset} className="section-btn section-btn-primary">Save Preset</button>
                      </div>
                    </div>
                  }
                >
                  <div className="mb-3 space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-xs font-semibold text-white">Composer Mode</div>
                        <div className="text-[10px] text-gray-400">Broadcast canvas control with cinematic layouts and Lumina-aware intelligence.</div>
                      </div>
                      <label className="aether-toggle">
                        <input type="checkbox" checked={composerMode} onChange={(e) => setComposerMode(e.target.checked)} />
                        <span className="slider" />
                      </label>
                    </div>
                    <div className="grid grid-cols-1 gap-2 text-[10px]">
                      <button
                        type="button"
                        onClick={() => setComposerMode((prev) => !prev)}
                        className="rounded-xl border border-[#1d3346] bg-[#07111d] px-3 py-3 text-left transition-colors hover:border-cyan-400/70 hover:bg-[#0a1624]"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="uppercase tracking-[0.2em] text-slate-500">Canvas Mode</div>
                            <div className="mt-1 text-white">{composerMode ? 'Armed for broadcast composition' : 'Standby until enabled'}</div>
                            <div className="mt-1 text-[10px] text-cyan-300">{composerMode ? 'Click to park the composer' : 'Click to arm the composer'}</div>
                          </div>
                          <div className="rounded-full border border-cyan-400/20 bg-cyan-400/10 px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.2em] text-cyan-200">
                            {composerMode ? 'Armed' : 'Standby'}
                          </div>
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={openLayoutThemeLibrary}
                        className="rounded-xl border border-[#1d3346] bg-[#07111d] px-3 py-3 text-left transition-colors hover:border-cyan-400/70 hover:bg-[#0a1624]"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="uppercase tracking-[0.2em] text-slate-500">Live Theme</div>
                            <div className="mt-1 text-white">{activeThemeDef.name}</div>
                            <div className="mt-1 text-[10px] text-cyan-300">Open the theme library</div>
                          </div>
                          <Sparkles size={14} className="mt-0.5 text-cyan-300" />
                        </div>
                      </button>
                    </div>
                  </div>
                  {/* Quick Layout Buttons — one-click layout switching */}
                  <div className="mb-3">
                    <div className="text-[10px] uppercase tracking-[0.24em] text-gray-500 mb-2">Quick Layouts</div>
                    <div className="grid grid-cols-3 gap-1.5">
                      {manualLayoutOptions.map((opt) => (
                        <button
                          key={opt.id}
                          onClick={() => runTransition(() => applyComposerLayoutState(undefined, opt.id as ComposerLayoutTemplate))}
                          className={`flex flex-col items-center gap-1 rounded-xl border py-2 px-1 text-[10px] transition-all ${layoutTemplate === opt.id ? 'border-cyan-400 bg-cyan-400/10 text-cyan-200' : 'border-aether-700 bg-aether-900/60 text-gray-300 hover:border-aether-500 hover:text-white'}`}
                        >
                          <span className="text-base leading-none">{opt.icon}</span>
                          <span className="leading-tight text-center">{opt.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                  <details ref={layoutThemeLibraryRef} className="mb-4 rounded-2xl border border-aether-700/70 bg-aether-950/40 px-3 py-2">
                    <summary className="cursor-pointer list-none text-[10px] font-bold uppercase tracking-[0.24em] text-gray-400">
                      Theme Library
                    </summary>
                    <div className="mt-3">
                      <div className="text-[10px] uppercase tracking-[0.24em] text-gray-500 mb-2">Layout Packs</div>
                      <div className="flex flex-wrap gap-1.5">
                        {LAYOUT_PACKS.map((pack) => (
                          <button
                            key={pack.id}
                            onClick={() => {
                              setPreviewLayoutPack(pack.id);
                              if (previewLayoutPack !== pack.id) {
                                const fallbackTheme = LAYOUT_THEMES.find((theme) => theme.packId === pack.id);
                                if (fallbackTheme) selectLayoutTheme(fallbackTheme.id);
                              }
                            }}
                            className={`px-2.5 py-1.5 rounded-full text-[10px] border transition-all ${previewLayoutPack === pack.id ? 'border-cyan-400 bg-cyan-400/10 text-cyan-200' : 'border-aether-700 text-gray-400 hover:border-aether-500 hover:text-white'}`}
                          >
                            {pack.name}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="mt-3 text-[10px] uppercase tracking-[0.24em] text-gray-500 mb-2">Layout Themes</div>
                    <div className="grid grid-cols-1 gap-2.5">
                      {(visibleLayoutThemes.length ? visibleLayoutThemes : LAYOUT_THEMES).map((theme) => (
                        <button
                          key={theme.id}
                          onClick={() => selectLayoutTheme(theme.id)}
                          className={`group rounded-2xl border p-2 text-left transition-all ${previewTheme === theme.id ? 'border-cyan-400 bg-cyan-400/10 shadow-[0_0_0_1px_rgba(34,211,238,0.15)]' : 'border-aether-700 bg-aether-900/60 hover:border-aether-500 hover:bg-aether-800/70'}`}
                        >
                          <div className="text-xs font-semibold text-white flex items-center justify-between">
                            <span>{theme.name}</span>
                            {appliedTheme === theme.id && <span className="text-[9px] uppercase tracking-[0.2em] text-cyan-300">Live</span>}
                          </div>
                          <div className="mt-2 h-20 rounded-xl border border-white/10 overflow-hidden relative bg-gradient-to-br from-[#08111f] via-[#111827] to-[#060913]">
                            {theme.preview.map((tile) => (
                              <div
                                key={tile.id}
                                className={`absolute rounded-[14px] transition-transform duration-200 group-hover:scale-[1.03] ${tile.primary ? 'bg-white/12 border border-white/20 shadow-[0_10px_30px_rgba(0,0,0,0.28)]' : 'bg-cyan-300/10 border border-cyan-200/20'}`}
                                style={{
                                  left: `${tile.x * 100}%`,
                                  top: `${tile.y * 100}%`,
                                  width: `${tile.width * 100}%`,
                                  height: `${tile.height * 100}%`,
                                }}
                              >
                                <div className={`absolute inset-x-0 top-0 h-4 ${tile.primary ? 'bg-white/10' : 'bg-cyan-300/12'}`} />
                              </div>
                            ))}
                          </div>
                          <div className="mt-2 text-[10px] text-gray-400 leading-relaxed">{theme.description}</div>
                        </button>
                      ))}
                    </div>
                  </details>
                  <div className="rounded-2xl border border-aether-700 bg-gradient-to-br from-aether-900/85 to-[#050b17] p-3 mb-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-xs font-semibold text-white">Preview Layout</div>
                        <div className="text-[10px] text-gray-400">{getLayoutThemeDefinition(previewTheme).name} · {previewSelection.layoutTemplate.replaceAll('_', ' ')}</div>
                      </div>
                      <div className="text-[10px] text-cyan-300 uppercase tracking-[0.22em]">{layoutPreviewState.swappedRoles ? 'Swapped' : 'Standard'}</div>
                    </div>
                    <div className="grid grid-cols-1 gap-2 text-[10px]">
                      <div className="rounded-xl border border-aether-700 bg-aether-950/60 p-2">
                        <div className="text-gray-500 uppercase tracking-[0.2em] mb-1">Background</div>
                        <div className="text-white">{previewBackgroundStyle.replaceAll('_', ' ')}</div>
                      </div>
                      <div className="rounded-xl border border-aether-700 bg-aether-950/60 p-2">
                        <div className="text-gray-500 uppercase tracking-[0.2em] mb-1">Frame</div>
                        <div className="text-white">{previewFrameStyle}</div>
                      </div>
                      <div className="rounded-xl border border-aether-700 bg-aether-950/60 p-2">
                        <div className="text-gray-500 uppercase tracking-[0.2em] mb-1">Motion</div>
                        <div className="text-white">{previewMotionStyle}</div>
                      </div>
                    </div>
                  </div>
                  <details className="mb-4 rounded-2xl border border-aether-700/70 bg-aether-950/40 px-3 py-2">
                    <summary className="cursor-pointer list-none text-[10px] font-bold uppercase tracking-[0.24em] text-gray-400">
                      Visual Style
                    </summary>
                    <div className="mt-3 space-y-3">
                    <div>
                      <div className="text-[10px] uppercase tracking-[0.24em] text-gray-500 mb-2">Background</div>
                      <div className="grid grid-cols-1 gap-2">
                        {[
                          ['blurred_camera', 'Blur Camera'],
                          ['gradient_motion', 'Gradient Motion'],
                          ['brand_wave', 'Brand Theme'],
                          ['light_studio', 'Light Studio'],
                        ].map(([id, label]) => (
                          <button
                            key={id}
                            onClick={() => setPreviewBackgroundStyle(id as BackgroundStyleId)}
                            className={`rounded-xl border px-3 py-2 text-xs transition-all ${previewBackgroundStyle === id ? 'border-cyan-400 bg-cyan-400/10 text-white' : 'border-aether-700 text-gray-400 hover:border-aether-500 hover:text-white'}`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase tracking-[0.24em] text-gray-500 mb-2">Frame Style</div>
                      <div className="grid grid-cols-1 gap-2">
                        {(['floating', 'flat', 'glass'] as FrameStyleId[]).map((id) => (
                          <button
                            key={id}
                            onClick={() => setPreviewFrameStyle(id)}
                            className={`rounded-xl border px-3 py-2 text-xs capitalize transition-all ${previewFrameStyle === id ? 'border-cyan-400 bg-cyan-400/10 text-white' : 'border-aether-700 text-gray-400 hover:border-aether-500 hover:text-white'}`}
                          >
                            {id}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase tracking-[0.24em] text-gray-500 mb-2">Motion Style</div>
                      <div className="grid grid-cols-1 gap-2">
                        {(['smooth', 'gentle', 'snappy'] as MotionStyleId[]).map((id) => (
                          <button
                            key={id}
                            onClick={() => setPreviewMotionStyle(id)}
                            className={`rounded-xl border px-3 py-2 text-xs capitalize transition-all ${previewMotionStyle === id ? 'border-cyan-400 bg-cyan-400/10 text-white' : 'border-aether-700 text-gray-400 hover:border-aether-500 hover:text-white'}`}
                          >
                            {id}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase tracking-[0.24em] text-gray-500 mb-2">Brand Theme</div>
                      <div className="grid grid-cols-1 gap-2">
                        {brandColors.map((color, idx) => (
                          <label key={`${color}-${idx}`} className="rounded-xl border border-aether-700 bg-aether-950/60 px-2 py-2 flex items-center gap-2">
                            <input
                              type="color"
                              value={color}
                              onChange={(e) => setBrandColors((prev) => prev.map((entry, entryIdx) => entryIdx === idx ? e.target.value : entry))}
                              className="w-7 h-7 rounded-md bg-transparent"
                            />
                            <span className="text-[10px] text-gray-300 font-mono truncate">{color}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                    </div>
                  </details>
                  <details className="mb-4 rounded-2xl border border-aether-700/70 bg-aether-950/40 px-3 py-2">
                    <summary className="cursor-pointer list-none text-[10px] font-bold uppercase tracking-[0.24em] text-gray-400">
                      Automation And Advanced
                    </summary>
                    <div className="mt-3 space-y-4">
                  <div className="rounded-2xl border border-aether-700 bg-aether-900/35 p-3 space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-xs font-semibold text-white">Advanced Manual Layout</div>
                        <div className="text-[10px] text-gray-400">Manual template staging without leaving Layout Studio.</div>
                      </div>
                      <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500">{previewLayoutTemplate.replaceAll('_', ' ')}</div>
                    </div>
                    <div className="grid grid-cols-2 gap-1.5">
                      {[
                        { id: 'main_thumbs' as const, label: 'Main+Th', icon: '▣' },
                        { id: 'side_by_side' as const, label: 'Split', icon: '◫' },
                        { id: 'pip_corner' as const, label: 'PiP', icon: '△' },
                        { id: 'grid_2x2' as const, label: 'Grid', icon: '⊞' },
                        { id: 'speaker_focus' as const, label: 'Speaker', icon: '◉' },
                        { id: 'scripture_focus' as const, label: 'Scripture', icon: '◧' },
                        { id: 'sermon_split_left' as const, label: 'Split L', icon: '◭' },
                        { id: 'sermon_split_right' as const, label: 'Split R', icon: '◮' },
                      ].map((lt) => (
                        <button
                          key={lt.id}
                          onClick={() => setPreviewLayoutTemplate(lt.id)}
                          className={`flex flex-col items-center gap-0.5 p-2 rounded-lg border text-xs transition-all ${previewLayoutTemplate === lt.id ? 'border-aether-500 bg-aether-700/40 text-white' : 'border-aether-700 bg-aether-800/30 text-gray-400 hover:border-aether-600'}`}
                        >
                          <span className="text-lg">{lt.icon}</span>
                          <span>{lt.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="mt-3 p-3 rounded-2xl border border-aether-700 bg-aether-900/35 space-y-2">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-xs font-semibold text-white">Scene Intelligence</div>
                        <div className="text-[10px] text-gray-400">Lumina + Director Mode can auto-pivot between speaker, scripture, and broadcast emphasis.</div>
                      </div>
                      <label className="aether-toggle">
                        <input type="checkbox" checked={smartLayoutEnabled} onChange={(e) => setSmartLayoutEnabled(e.target.checked)} />
                        <span className="slider" />
                      </label>
                    </div>
                    <div className="space-y-1">
                      <div className="text-[10px] text-gray-400">Lumina state: <span className="text-cyan-300">{(luminaState.contentMode as LuminaContentMode).replace('_', ' ')}</span></div>
                      <div className="text-[10px] text-gray-500 truncate">{luminaState.sceneName || luminaState.title || 'No presenter sync yet'}</div>
                    </div>
                    <div className="space-y-2">
                      <div>
                        <div className="text-xs font-semibold text-white">Intent Director</div>
                        <div className="text-[10px] text-gray-400">Context-aware layout switching across Lumina, audience, and Aether cues.</div>
                      </div>
                      <label className="aether-toggle">
                        <input type="checkbox" checked={intentDirectorOn} onChange={(e) => setIntentDirectorOn(e.target.checked)} />
                        <span className="slider" />
                      </label>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[10px] text-gray-400">Cooldown</span>
                      <input
                        type="number"
                        min={200}
                        max={5000}
                        step={100}
                        value={intentCooldownMs}
                        onChange={(e) => setIntentCooldownMs(Number(e.target.value) || 1200)}
                        className="w-20 bg-[#110b20] border border-[#2e2650] rounded-md px-2 py-1 text-[10px] text-white text-center outline-none"
                      />
                      <span className="text-[10px] text-gray-400">ms</span>
                      <div className="ml-auto text-[10px] text-aether-300 truncate max-w-[170px]">{intentDirectorStatus}</div>
                    </div>
                  </div>
                    </div>
                  </details>
                </CollapsibleSection>

                {/* ─── COMPOSER MODE ─── */}
                {/* legacy composer removed
                <CollapsibleSection
                  title="🖼️ Composer Mode"
                  subtitle={previewLayoutTemplate.replace('_', ' ')}
                  open={inputsSection === 'composer'}
                  onToggle={(open) => setInputsSection(open ? 'composer' : '')}
                  className="rounded-2xl border border-[#173046] bg-[#05101b]"
                  summaryClassName="cursor-pointer list-none px-3 py-3 flex items-center justify-between"
                  bodyClassName="px-3 pb-3 pt-1 space-y-3"
                >
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs text-gray-300">Manual template staging</span>
                    <label className="aether-toggle">
                      <input type="checkbox" checked={composerMode} onChange={(e) => setComposerMode(e.target.checked)} />
                      <span className="slider" />
                    </label>
                  </div>
                  <div className="grid grid-cols-4 gap-1.5 mb-3">
                    {[
                      { id: 'main_thumbs' as const, label: 'Main+Th', icon: '▣' },
                      { id: 'side_by_side' as const, label: 'Split', icon: '◫' },
                      { id: 'pip_corner' as const, label: 'PiP', icon: '◲' },
                      { id: 'grid_2x2' as const, label: 'Grid', icon: '⊞' },
                      { id: 'speaker_focus' as const, label: 'Speaker', icon: '◉' },
                      { id: 'scripture_focus' as const, label: 'Scripture', icon: '◧' },
                      { id: 'sermon_split_left' as const, label: 'Split L', icon: '◭' },
                      { id: 'sermon_split_right' as const, label: 'Split R', icon: '◮' },
                    ].map(lt => (
                      <button
                        key={lt.id}
                        onClick={() => {
                          setPreviewLayoutTemplate(lt.id);
                        }}
                        className={`flex flex-col items-center gap-0.5 p-2 rounded-lg border text-xs transition-all ${previewLayoutTemplate === lt.id ? 'border-aether-500 bg-aether-700/40 text-white' : 'border-aether-700 bg-aether-800/30 text-gray-400 hover:border-aether-600'
                          }`}
                      >
                        <span className="text-lg">{lt.icon}</span>
                        <span>{lt.label}</span>
                      </button>
                    ))}
                  </div>
                  <button
                    onClick={() => runTransition(() => previewSelectedLayoutTheme())}
                    className="section-btn section-btn-primary w-full"
                  >
                    Apply Layout
                  </button>
                  <div className="mt-3 p-2 rounded-lg border border-aether-700 bg-aether-900/35 space-y-2">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-xs font-semibold text-white">Intent Director</div>
                        <div className="text-[10px] text-gray-400">Context-aware auto layouts from Lumina/Audience/Aether signals</div>
                      </div>
                      <label className="aether-toggle">
                        <input type="checkbox" checked={intentDirectorOn} onChange={(e) => setIntentDirectorOn(e.target.checked)} />
                        <span className="slider" />
                      </label>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-gray-400">Cooldown</span>
                      <input
                        type="number"
                        min={200}
                        max={5000}
                        step={100}
                        value={intentCooldownMs}
                        onChange={(e) => setIntentCooldownMs(Number(e.target.value) || 1200)}
                        className="w-20 bg-[#110b20] border border-[#2e2650] rounded-md px-2 py-1 text-[10px] text-white text-center outline-none"
                      />
                      <span className="text-[10px] text-gray-400">ms</span>
                      <div className="ml-auto text-[10px] text-aether-300 truncate max-w-[190px]">{intentDirectorStatus}</div>
                    </div>
                  </div>
                </CollapsibleSection>
                */}

                {/* ─── AUTO-DIRECTOR ─── */}
                <CollapsibleSection
                  title="🤖 Auto-Director"
                  subtitle={autoDirectorOn ? `${autoDirectorMode} · ${autoDirectorCountdown}s` : 'Off'}
                  open={inputsSection === 'auto-director'}
                  onToggle={(open) => setInputsSection(open ? 'auto-director' : '')}
                  className={inputSectionBaseClassName}
                  summaryClassName={inputSectionSummaryClassName}
                  bodyClassName={inputSectionBodyClassName}
                  scrollBodyClassName={`${inputSectionScrollClassName} space-y-2`}
                  bodyStyle={sectionScrollStyle.autoDirector}
                >
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs text-gray-300">Auto-switch cameras</span>
                    <div className="flex items-center gap-2">
                      {autoDirectorOn && (
                        <span className="status-badge status-live">{autoDirectorCountdown}s</span>
                      )}
                      <label className="aether-toggle">
                        <input type="checkbox" checked={autoDirectorOn} onChange={(e) => setAutoDirectorOn(e.target.checked)} />
                        <span className="slider" />
                      </label>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs text-gray-300 shrink-0">Mode</span>
                    <select value={autoDirectorMode} onChange={(e) => setAutoDirectorMode(e.target.value as any)}
                      className="flex-1 bg-[#110b20] border border-[#2e2650] rounded-md px-2 py-1.5 text-xs text-white outline-none focus:border-aether-500">
                      <option value="sequential">Sequential</option>
                      <option value="random">Random</option>
                      <option value="audio_reactive">Audio Reactive</option>
                    </select>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-300 shrink-0">Interval</span>
                    <input type="number" value={autoDirectorInterval} onChange={(e) => setAutoDirectorInterval(Number(e.target.value) || 12)} min={3}
                      className="w-16 bg-[#110b20] border border-[#2e2650] rounded-md px-2 py-1.5 text-xs text-white outline-none focus:border-aether-500" />
                    <span className="text-xs text-gray-400">sec</span>
                  </div>
                </CollapsibleSection>

                {/* ─── LOWER THIRDS ─── */}
                <CollapsibleSection
                  title="📛 Lower Thirds"
                  subtitle={lowerThirdVisible ? 'Showing' : 'Hidden'}
                  open={inputsSection === 'lower-thirds'}
                  onToggle={(open) => setInputsSection(open ? 'lower-thirds' : '')}
                  className={inputSectionBaseClassName}
                  summaryClassName={inputSectionSummaryClassName}
                  bodyClassName={inputSectionBodyClassName}
                  scrollBodyClassName={`${inputSectionScrollClassName} space-y-2`}
                  bodyStyle={sectionScrollStyle.lowerThirds}
                >
                  <div className="space-y-2 mb-3">
                    <input value={lowerThirdName} onChange={(e) => setLowerThirdName(e.target.value)} className="section-input" placeholder="Speaker Name" />
                    <input value={lowerThirdTitle} onChange={(e) => setLowerThirdTitle(e.target.value)} className="section-input" placeholder="Title / Role" />
                  </div>
                  <div className="flex items-center gap-2 mb-3">
                    <label className="aether-toggle">
                      <input type="checkbox" checked={lowerThirdVisible} onChange={(e) => setLowerThirdVisibility(e.target.checked)} />
                      <span className="slider" />
                    </label>
                    <span className="text-xs text-gray-300">{lowerThirdVisible ? 'Visible' : 'Hidden'}</span>
                    <div className="flex-1" />
                    <button onClick={() => showLowerThirdTemporarily(lowerThirdDuration * 1000)} className="section-btn section-btn-ghost">Show {lowerThirdDuration}s</button>
                  </div>
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-xs text-gray-300">Duration</span>
                    <div className="flex gap-1.5">
                      {[5, 8, 10, 15].map(d => (
                        <button key={d} onClick={() => setLowerThirdDuration(d)} className={`px-2.5 py-1 text-xs rounded-full border transition-all ${lowerThirdDuration === d ? 'border-aether-500 bg-aether-700 text-white' : 'border-aether-700 text-gray-400 hover:text-gray-200'}`}>{d}s</button>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-xs text-gray-300">Accent</span>
                    <input type="color" value={lowerThirdAccentColor} onChange={(e) => setLowerThirdAccentColor(e.target.value)}
                      className="w-6 h-6 rounded-md border border-aether-700 cursor-pointer bg-transparent" />
                    <span className="text-xs text-gray-400 font-mono">{lowerThirdAccentColor}</span>
                  </div>
                  {/* Presets */}
                  <div className="border-t border-aether-700/50 pt-2">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-xs text-gray-300 font-medium">Presets</span>
                      <button onClick={() => {
                        setLowerThirdPresets(prev => [...prev, { id: Date.now().toString(), name: lowerThirdName, title: lowerThirdTitle }]);
                      }} className="section-btn section-btn-ghost text-xs">+ Save Current</button>
                    </div>
                    {lowerThirdPresets.length === 0 && <div className="text-xs text-gray-500">No presets saved</div>}
                    {lowerThirdPresets.map(p => (
                      <div key={p.id} className="flex items-center gap-1.5 py-1.5 group">
                        <div className="flex-1 min-w-0">
                          <div className="text-xs text-gray-200 truncate">{p.name}</div>
                          <div className="text-xs text-gray-400 truncate">{p.title}</div>
                        </div>
                        <button onClick={() => { setLowerThirdName(p.name); setLowerThirdTitle(p.title); }} className="section-btn section-btn-ghost text-xs opacity-60 group-hover:opacity-100">Load</button>
                        <button onClick={() => setLowerThirdPresets(prev => prev.filter(x => x.id !== p.id))} className="section-btn section-btn-danger text-xs opacity-60 group-hover:opacity-100">✕</button>
                      </div>
                    ))}
                  </div>
                </CollapsibleSection>

                {/* ─── TRANSITIONS ─── */}
                <CollapsibleSection
                  title="✂️ Transitions"
                  subtitle={`${transitionMode === 'cut' ? 'Cut' : transitionMode === 'fade' ? 'Fade' : 'Dip White'} · ${transitionMs}ms`}
                  open={inputsSection === 'transitions'}
                  onToggle={(open) => setInputsSection(open ? 'transitions' : '')}
                  className={inputSectionBaseClassName}
                  summaryClassName={inputSectionSummaryClassName}
                  bodyClassName={inputSectionBodyClassName}
                  scrollBodyClassName={`${inputSectionScrollClassName} space-y-2`}
                  bodyStyle={sectionScrollStyle.transitions}
                >
                  <div className="flex items-center gap-2 mb-3">
                    <select value={transitionMode} onChange={(e) => setTransitionMode(e.target.value as any)}
                      className="flex-1 bg-[#110b20] border border-[#2e2650] rounded-md px-2 py-1.5 text-xs text-white outline-none focus:border-aether-500">
                      <option value="cut">Cut (Instant)</option>
                      <option value="fade">Fade to Black</option>
                      <option value="dip_white">Dip to White</option>
                    </select>
                  </div>
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-xs text-gray-300">Speed</span>
                    <div className="flex gap-1.5">
                      {[{ label: 'Fast', ms: 150 }, { label: 'Medium', ms: 300 }, { label: 'Slow', ms: 600 }].map(d => (
                        <button key={d.ms} onClick={() => setTransitionMs(d.ms)} className={`px-2.5 py-1 text-xs rounded-full border transition-all ${transitionMs === d.ms ? 'border-aether-500 bg-aether-700 text-white' : 'border-aether-700 text-gray-400 hover:text-gray-200'}`}>{d.label}</button>
                      ))}
                    </div>
                    <input type="number" value={transitionMs} onChange={(e) => setTransitionMs(Number(e.target.value) || 300)}
                      className="w-14 bg-[#110b20] border border-[#2e2650] rounded-md px-2 py-1 text-xs text-white text-center outline-none" />
                    <span className="text-xs text-gray-400">ms</span>
                  </div>
                  <button onClick={() => runTransition(() => { })} className="section-btn section-btn-ghost w-full">Preview Transition</button>
                </CollapsibleSection>

                {/* ─── SCENE PRESETS ─── */}
                <CollapsibleSection
                  title="💾 Scene Presets"
                  subtitle={`${scenePresets.length} saved`}
                  open={inputsSection === 'scene-presets'}
                  onToggle={(open) => setInputsSection(open ? 'scene-presets' : '')}
                  className={inputSectionBaseClassName}
                  summaryClassName={inputSectionSummaryClassName}
                  bodyClassName={inputSectionBodyClassName}
                  scrollBodyClassName={`${inputSectionScrollClassName} space-y-2`}
                  bodyStyle={sectionScrollStyle.scenePresets}
                >
                  <div className="space-y-2 mb-3">
                    <input value={presetName} onChange={(e) => setPresetName(e.target.value)} className="section-input" placeholder="Preset name" />
                    <div className="flex gap-2">
                      <select value={layoutTemplate} onChange={(e) => setLayoutTemplate(e.target.value as any)}
                        className="flex-1 bg-[#110b20] border border-[#2e2650] rounded-md px-2 py-1.5 text-[10px] text-white outline-none">
                        <option value="main_thumbs">▣ Main + Thumbs</option>
                        <option value="side_by_side">◫ Side by Side</option>
                        <option value="pip_corner">◲ PiP Corner</option>
                        <option value="grid_2x2">⊞ 2x2 Grid</option>
                        <option value="speaker_focus">◉ Speaker Focus</option>
                        <option value="scripture_focus">◧ Scripture Focus</option>
                        <option value="sermon_split_left">◭ Sermon Split Left</option>
                        <option value="sermon_split_right">◮ Sermon Split Right</option>
                        <option value="projector_speaker">▩ Projector + Speaker</option>
                        <option value="freeform">◇ Freeform</option>
                      </select>
                      <button onClick={saveScenePreset} className="section-btn section-btn-primary">Save</button>
                    </div>
                  </div>
                  {scenePresets.length === 0 && <div className="text-xs text-gray-500">No presets saved yet.</div>}
                  {scenePresets.map(p => (
                    <div key={p.id} className="flex items-center gap-2 py-1.5 group border-b border-aether-700/30 last:border-0">
                      <span className="text-base">{p.layout === 'main_thumbs' ? '▣' : p.layout === 'side_by_side' ? '◫' : p.layout === 'pip_corner' ? '◲' : p.layout === 'grid_2x2' ? '⊞' : p.layout === 'speaker_focus' ? '◉' : p.layout === 'scripture_focus' ? '◧' : p.layout === 'sermon_split_left' ? '◭' : p.layout === 'sermon_split_right' ? '◮' : '◇'}</span>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs text-gray-200 truncate">{p.name}</div>
                        <div className="text-xs text-gray-400">{p.layout.replace('_', ' ')}</div>
                      </div>
                      <button onClick={() => runTransition(() => loadScenePresetById(p.id))} className="section-btn section-btn-ghost text-xs opacity-60 group-hover:opacity-100">Load</button>
                      <button onClick={() => {
                        const dup = { ...p, id: Date.now().toString(), name: p.name + ' Copy' };
                        setScenePresets(prev => [...prev, dup]);
                      }} className="section-btn section-btn-ghost text-xs opacity-60 group-hover:opacity-100">Dup</button>
                      <button onClick={() => deleteScenePreset(p.id)} className="section-btn section-btn-danger text-xs opacity-60 group-hover:opacity-100">✕</button>
                    </div>
                  ))}
                </CollapsibleSection>

                {/* ─── AUDIENCE STUDIO ─── */}
                <CollapsibleSection
                  title="👥 Audience Studio"
                  subtitle={`${audienceMessages.length} messages queued`}
                  open={inputsSection === 'audience'}
                  onToggle={(open) => setInputsSection(open ? 'audience' : '')}
                  className={inputSectionBaseClassName}
                  summaryClassName={inputSectionSummaryClassName}
                  bodyClassName={inputSectionBodyClassName}
                  scrollBodyClassName={`${inputSectionScrollClassName} space-y-2`}
                  bodyStyle={sectionScrollStyle.audience}
                >
                  {/* Pinned message */}
                  <input value={pinnedMessage} onChange={(e) => setPinnedMessage(e.target.value)} className="section-input mb-2" placeholder="Pinned message" />
                  <div className="flex gap-1.5 mb-3">
                    <label className="aether-toggle">
                      <input type="checkbox" checked={pinnedVisible} onChange={(e) => setPinnedVisibility(e.target.checked)} />
                      <span className="slider" />
                    </label>
                    <span className="text-xs text-gray-300">{pinnedVisible ? 'Pin Visible' : 'Pin Hidden'}</span>
                  </div>
                  {/* Ticker */}
                  <input value={tickerMessage} onChange={(e) => setTickerMessage(e.target.value)} className="section-input mb-2" placeholder="Ticker message" />
                  <div className="flex gap-1.5 mb-3">
                    <label className="aether-toggle">
                      <input type="checkbox" checked={tickerVisible} onChange={(e) => setTickerVisibility(e.target.checked)} />
                      <span className="slider" />
                    </label>
                    <span className="text-xs text-gray-300">{tickerVisible ? 'Ticker Running' : 'Ticker Off'}</span>
                  </div>
                  {/* Message Queue */}
                  <div className="border-t border-aether-700/50 pt-2">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-xs text-gray-300 font-medium">Message Queue</span>
                      <div className="flex items-center gap-1.5">
                        <label className="aether-toggle" style={{ width: '32px', height: '18px' }}>
                          <input type="checkbox" checked={audienceRotateOn} onChange={(e) => setAudienceRotateOn(e.target.checked)} />
                          <span className="slider" />
                        </label>
                        <span className="text-xs text-gray-400">Auto-rotate</span>
                        {audienceRotateOn && (
                          <input type="number" value={audienceRotateInterval} onChange={(e) => setAudienceRotateInterval(Number(e.target.value) || 8)} min={3}
                            className="w-10 bg-[#110b20] border border-[#2e2650] rounded px-1 py-0.5 text-xs text-white text-center" />
                        )}
                      </div>
                    </div>
                    <div className="flex gap-1.5 mb-2">
                      <input value={audienceNewMsg} onChange={(e) => setAudienceNewMsg(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter' && audienceNewMsg.trim()) { setAudienceMessages(prev => [...prev, audienceNewMsg.trim()]); setAudienceNewMsg(''); } }}
                        className="flex-1 bg-[#110b20] border border-[#2e2650] rounded-md px-2 py-1 text-[10px] text-white outline-none" placeholder="Add message..." />
                      <button onClick={() => { if (audienceNewMsg.trim()) { setAudienceMessages(prev => [...prev, audienceNewMsg.trim()]); setAudienceNewMsg(''); } }} className="section-btn section-btn-ghost">+</button>
                    </div>
                    {audienceMessages.map((msg, i) => (
                      <div key={i} className={`flex items-center gap-1.5 py-1 group ${i === audienceCurrentIdx && audienceRotateOn ? 'bg-aether-700/20 rounded px-1' : ''}`}>
                        <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: i === audienceCurrentIdx && audienceRotateOn ? '#4ade80' : '#3b3660' }} />
                        <span className="flex-1 text-[10px] text-gray-300 truncate">{msg}</span>
                        <button onClick={() => { setPinnedMessage(msg); setPinnedVisibility(true); }} className="text-[9px] text-gray-500 hover:text-gray-300 opacity-0 group-hover:opacity-100">Pin</button>
                        <button onClick={() => setAudienceMessages(prev => prev.filter((_, j) => j !== i))} className="text-[9px] text-red-400 opacity-0 group-hover:opacity-100">✕</button>
                      </div>
                    ))}
                  </div>
                </CollapsibleSection>

                {/* ─── PHONE SLOTS ─── */}
                <CollapsibleSection
                  title="Phone Slots"
                  subtitle={`${phoneSourceCount}/${MAX_PHONE_CAMS} connected`}
                  open={inputsSection === 'phone-slots'}
                  onToggle={(open) => setInputsSection(open ? 'phone-slots' : '')}
                  className={inputSectionBaseClassName}
                  summaryClassName={inputSectionSummaryClassName}
                  bodyClassName={inputSectionBodyClassName}
                  scrollBodyClassName={`${inputSectionScrollClassName} space-y-2`}
                  bodyStyle={sectionScrollStyle.phoneSlots}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-xs text-gray-400">Manage linked phone cameras without stretching the rail.</div>
                    <span className={`status-badge text-[11px] ${phoneSlotsFull ? 'status-error' : 'status-pending'}`}>{phoneSourceCount}/{MAX_PHONE_CAMS}</span>
                  </div>
                  {phoneSourceCount === 0 && (
                    <div className="text-[10px] text-gray-500 border border-dashed border-aether-700 rounded-lg p-3 text-center">No phone slots. Click <strong>+ Phone</strong> above.</div>
                  )}
                  {phoneSlotsFull && (
                    <div className="text-[10px] text-amber-300 border border-amber-500/40 rounded-lg p-2 bg-amber-500/10 mb-2 flex items-center gap-1"><AlertTriangle size={10} /> Limit reached</div>
                  )}
                  {cameraSources.filter(s => s.kind === 'phone').map((src) => {
                    // Track connection time
                    if (src.status === 'live' && !phoneConnectedAtRef.current.has(src.id)) {
                      phoneConnectedAtRef.current.set(src.id, Date.now());
                    } else if (src.status !== 'live') {
                      phoneConnectedAtRef.current.delete(src.id);
                    }
                    const connectedAt = phoneConnectedAtRef.current.get(src.id);
                    const connSec = connectedAt ? Math.floor((Date.now() - connectedAt) / 1000) : 0;
                    const connMin = Math.floor(connSec / 60);
                    return (
                      <div key={`phone-${src.id}`} className="flex items-center gap-2 border border-aether-700/60 rounded-lg p-2.5 bg-gradient-to-r from-aether-800/40 to-transparent mb-2 hover:border-aether-600 transition-colors">
                        <div className="flex-1 min-w-0">
                          <div className="text-xs text-white truncate">{src.label}</div>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <span className={`status-badge ${src.status === 'live' ? 'status-live' : src.status === 'pending' ? 'status-pending' : 'status-error'}`}>
                              <span className="w-1.5 h-1.5 rounded-full" style={{ background: src.status === 'live' ? '#4ade80' : src.status === 'pending' ? '#fbbf24' : '#f87171' }} />
                              {src.status}
                            </span>
                            {connectedAt && <span className="text-[9px] text-gray-500">{connMin > 0 ? `${connMin}m ${connSec % 60}s` : `${connSec}s`}</span>}
                          </div>
                        </div>
                        <div className="flex gap-1 shrink-0">
                          {src.status !== 'live' && <button onClick={() => openPhoneQr(src.id)} className="section-btn section-btn-ghost">QR</button>}
                          <button onClick={() => { const link = buildMobileUrl(src.id, src.label); if (link) navigator.clipboard?.writeText(link).catch(() => { }); }} className="section-btn section-btn-ghost">Link</button>
                          <button onClick={() => makeMain(src.layerId)} className="section-btn section-btn-primary">Main</button>
                          <button onClick={() => removeSource(src.id)} className="section-btn section-btn-danger">✕</button>
                        </div>
                      </div>
                    );
                  })}
                </CollapsibleSection>
                {/* Spacer: keeps the outer rail overflowing so the scroll thumb always has travel range */}
                <div aria-hidden="true" className="shrink-0" style={{ height: '400px' }} />
                    </div>
                  </div>
                </div>
                <div className="absolute inset-y-3 right-0 z-20 flex w-5 justify-center">
                  <div
                    ref={inputRailTrackRef}
                    onMouseDown={handleInputRailTrackMouseDown}
                    className={`relative h-full w-[8px] rounded-full border shadow-[inset_0_0_0_1px_rgba(3,8,18,0.35)] ${inputRailScrollState.overflow ? 'cursor-pointer border-[#173046] bg-[#07111d]' : 'cursor-default border-[#1b2a3a] bg-[#0a1320]'}`}
                    role="presentation"
                  >
                    <button
                      type="button"
                      onMouseDown={startInputRailThumbDrag}
                      className={`absolute left-[-2px] right-[-2px] rounded-full border transition-colors ${inputRailScrollState.overflow ? 'border-cyan-300/70 bg-[linear-gradient(180deg,#22d3ee,#7c3aed)] shadow-[0_0_14px_rgba(34,211,238,0.45)] cursor-grab active:cursor-grabbing' : 'border-cyan-200/70 bg-[linear-gradient(180deg,#93c5fd,#64748b)] shadow-[0_0_10px_rgba(147,197,253,0.35)] cursor-default'}`}
                      style={inputRailThumbStyle}
                      aria-label="Scroll input controls"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      </div>

      {showSettings && (
        <div className="fixed inset-0 z-50 pointer-events-none">
          <div
            ref={settingsPanelRef}
            style={{ left: settingsPos.x, top: settingsPos.y }}
            className="pointer-events-auto absolute w-[520px] max-w-[92vw] bg-aether-900 border border-aether-700 rounded-xl shadow-2xl"
          >
            <div
              onMouseDown={startSettingsDrag}
              className="flex justify-between items-center px-4 py-3 border-b border-aether-800 cursor-move select-none"
            >
              <h2 className="text-lg font-bold flex gap-2 items-center text-white">
                <Settings className="text-aether-500" /> Settings
              </h2>
              <button data-no-drag onClick={() => setShowSettings(false)} className="text-gray-400 hover:text-white">
                <X />
              </button>
            </div>
            <div className="px-4 py-4 space-y-4 max-h-[75vh] overflow-y-auto">
              <SettingsSection title="Signaling Diagnostic" subtitle="Connection status + health" defaultOpen>
                <div className="space-y-1 text-xs text-gray-300">
                  <p>PeerID: <span className="font-mono text-gray-500">{peerId || 'Generating...'}</span></p>
                  <p>Room: <span className="font-mono text-gray-500">{roomId}</span></p>
                  <p>Mode: <span className="font-mono text-gray-500">{peerMode === 'custom' ? 'Custom' : 'Cloud'}</span></p>
                  <p>Status: <span className={cloudConnected ? "text-green-400" : "text-red-400"}>{cloudConnected ? "Active" : "Disconnected"}</span></p>
                  <p>Relay: <span className={relayConnected ? "text-green-400" : "text-red-400"}>{relayConnected ? "Online" : "Offline"}</span></p>
                  {relayStatus && <p>Relay Status: <span className="text-gray-400">{relayStatus}</span></p>}
                </div>
                <div className="flex gap-2 mt-2">
                  <button
                    onClick={checkRelayHealth}
                    className="px-2 py-1 text-[10px] rounded bg-aether-800 border border-aether-700 text-gray-200"
                  >
                    Relay Check
                  </button>
                  <button
                    onClick={checkFfmpeg}
                    className="px-2 py-1 text-[10px] rounded bg-aether-800 border border-aether-700 text-gray-200"
                  >
                    FFmpeg Check
                  </button>
                </div>
                <div className="mt-3 bg-aether-800/40 border border-aether-700 rounded p-2 text-[10px] text-gray-300">
                  <div className="font-semibold text-white mb-1">Stream Health</div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1">
                    <span>Bitrate: <span className="text-gray-400">{streamHealth.kbps} kbps</span></span>
                    <span>Queue: <span className="text-gray-400">{streamHealth.queueKb} KB</span></span>
                    <span>Drops: <span className="text-gray-400">{streamHealth.drops}</span></span>
                    <span>RTT: <span className="text-gray-400">{streamHealth.rttMs !== null ? `${streamHealth.rttMs} ms` : "--"}</span></span>
                  </div>
                  <div className="mt-2 font-semibold text-white">Encoder Bootstrap</div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1">
                    <span>Recorder: <span className="text-gray-400">{encoderBootstrap.recorderState}</span></span>
                    <span>First chunk: <span className="text-gray-400">{encoderBootstrap.firstChunkReceived ? "yes" : "no"}</span></span>
                    <span>Chunks sent: <span className="text-gray-400">{encoderBootstrap.chunksSent}</span></span>
                    <span>Zero chunks: <span className="text-gray-400">{encoderBootstrap.zeroSizeChunks}</span></span>
                    <span>First chunk delay: <span className="text-gray-400">{encoderBootstrap.firstChunkDelayMs !== null ? `${encoderBootstrap.firstChunkDelayMs} ms` : "--"}</span></span>
                  </div>
                  <div className="text-[9px] text-gray-500 mt-1">Updates while Live. Drops indicate network backpressure.</div>
                </div>
              </SettingsSection>

              <SettingsSection title="Room Management" subtitle="Force new room if stuck">
                <div className="flex justify-between items-center">
                  <div className="text-xs text-gray-400">Reset the room if devices get stuck</div>
                  <button
                    onClick={regenerateRoomId}
                    className="p-2 bg-red-500/10 text-red-400 hover:bg-red-500/20 rounded-lg text-xs flex items-center gap-1 border border-red-500/20"
                  >
                    <RefreshCw size={12} /> Reset Room
                  </button>
                </div>
              </SettingsSection>

              <SettingsSection title="Connection Mode" subtitle="Local, cloud, or custom server" defaultOpen>
                <div className="text-[10px] text-gray-500 bg-aether-800/40 border border-aether-700 rounded p-2">
                  <strong>Auto:</strong> Easiest. Uses PeerJS cloud.
                  <br />
                  <strong>Local:</strong> Uses your computer at <span className="font-mono">localhost:9000</span>.
                  <br />
                  <strong>Advanced:</strong> Use a custom server or VPS.
                </div>
                <select
                  value={peerUiMode}
                  onChange={(e) => setPeerUiMode(e.target.value as any)}
                  className="w-full bg-aether-800 border border-aether-700 rounded p-2 text-sm text-white focus:border-aether-500 outline-none"
                >
                  <option value="auto">Auto (Recommended)</option>
                  <option value="local">Local (This Computer)</option>
                  <option value="advanced">Advanced (Custom Server)</option>
                </select>
                <p className="text-[10px] text-gray-500">
                  Local uses this computer (localhost:9000) and requires a PeerJS server running on that machine. Advanced is for remote or VPS servers.
                </p>

                {peerUiMode === 'advanced' && (
                  <div className="space-y-2">
                    <div>
                      <label className="text-gray-400 text-sm">Host</label>
                      <input
                        type="text"
                        value={peerHost}
                        onChange={(e) => setPeerHost(e.target.value)}
                        placeholder="localhost"
                        className="w-full bg-aether-800 border border-aether-700 rounded p-2 text-sm text-white focus:border-aether-500 outline-none"
                      />
                      <p className="text-[10px] text-gray-500 mt-1">Example: <span className="font-mono">yourdomain.com</span></p>
                    </div>
                    <div>
                      <label className="text-gray-400 text-sm">Port</label>
                      <input
                        type="number"
                        value={peerPort}
                        onChange={(e) => setPeerPort(e.target.value)}
                        placeholder="9000"
                        className="w-full bg-aether-800 border border-aether-700 rounded p-2 text-sm text-white focus:border-aether-500 outline-none"
                      />
                      <p className="text-[10px] text-gray-500 mt-1">Common: 443 (secure), 9000 (local)</p>
                    </div>
                    <div>
                      <label className="text-gray-400 text-sm">Path</label>
                      <input
                        type="text"
                        value={peerPath}
                        onChange={(e) => setPeerPath(e.target.value)}
                        placeholder="/peerjs"
                        className="w-full bg-aether-800 border border-aether-700 rounded p-2 text-sm text-white focus:border-aether-500 outline-none"
                      />
                      <p className="text-[10px] text-gray-500 mt-1">Default path is <span className="font-mono">/peerjs</span></p>
                    </div>
                    <label className="flex items-center gap-2 text-xs text-gray-300">
                      <input
                        type="checkbox"
                        checked={peerSecure}
                        onChange={(e) => setPeerSecure(e.target.checked)}
                      />
                      Use TLS (wss/https)
                    </label>
                    <p className="text-[10px] text-gray-500">
                      After applying, the app reloads and uses your custom PeerJS server.
                    </p>
                  </div>
                )}

                <div className="flex justify-between items-center">
                  <button
                    onClick={testPeerServer}
                    className="px-3 py-2 rounded text-xs bg-aether-800 border border-aether-700 hover:bg-aether-700 text-white"
                  >
                    Test Connection
                  </button>
                  <button
                    onClick={applyPeerSettings}
                    className="px-3 py-2 rounded text-xs bg-aether-700 hover:bg-aether-600 text-white"
                  >
                    Apply & Reload
                  </button>
                </div>
              </SettingsSection>

              <SettingsSection title="Pro License" subtitle="Unlock advanced features">
                <label className="text-gray-400 text-sm">Pro License Key</label>
                <input
                  type="text"
                  value={licenseKey}
                  onChange={e => setLicenseKey(e.target.value.toUpperCase())}
                  placeholder="PRO_XXXX-XXXX..."
                  className="w-full bg-aether-800 border border-aether-700 rounded p-2 text-sm text-white focus:border-aether-500 outline-none"
                />
                <p className="text-[10px] text-gray-500 mt-1">
                  {isPro ? <span className="text-green-400">Pro Features Active</span> : "Enter key to remove watermark & unlock AI."}
                </p>
                {!isPro && licenseKey.trim() && (
                  <p className="text-[10px] text-yellow-300">Key format: PRO_XXXX-XXXX or an issued key.</p>
                )}
                {licenseStatus.state === 'checking' && (
                  <p className="text-[10px] text-gray-400">Verifying license…</p>
                )}
                {licenseStatus.state === 'valid' && (
                  <p className="text-[10px] text-green-400">
                    License verified{licenseStatus.source === 'server' ? ' (server)' : ' (offline)'}.
                  </p>
                )}
                {licenseStatus.state === 'invalid' && (
                  <p className="text-[10px] text-red-300">
                    {licenseStatus.message || 'License is not valid.'}
                  </p>
                )}
                {licenseStatus.state === 'error' && (
                  <p className="text-[10px] text-yellow-300">
                    {licenseStatus.message || 'License server unreachable.'}
                  </p>
                )}
              </SettingsSection>

              {!adminUnlocked && (
                <SettingsSection title="Admin Access" subtitle="Unlock license tools">
                  <p className="text-[10px] text-gray-400">Enter admin token to issue licenses.</p>
                  <input
                    type="password"
                    value={adminToken}
                    onChange={(e) => setAdminToken(e.target.value)}
                    placeholder="ADMIN_TOKEN"
                    className="w-full bg-aether-800 border border-aether-700 rounded p-2 text-sm text-white focus:border-aether-500 outline-none"
                  />
                  <div className="text-[10px] text-gray-500">Stored in session only.</div>
                </SettingsSection>
              )}

              {adminUnlocked && (
                <SettingsSection title="Admin: Issue License" subtitle="Generate Pro keys">
                  {!isAdminByEmail && (
                    <div className="text-[10px] text-gray-400">Admin token active for this session.</div>
                  )}
                  <div className="text-[10px] text-gray-500">
                    Requires <span className="font-mono">LICENSE_SECRET</span> and <span className="font-mono">LICENSE_ADMIN_TOKEN</span> on the relay.
                  </div>
                  <div className="space-y-2">
                    <div>
                      <label className="text-gray-400 text-sm">Customer Email (optional)</label>
                      <input
                        value={issueEmail}
                        onChange={(e) => setIssueEmail(e.target.value)}
                        placeholder="user@example.com"
                        className="w-full bg-aether-800 border border-aether-700 rounded p-2 text-sm text-white focus:border-aether-500 outline-none"
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <label className="text-gray-400 text-sm">Duration (days)</label>
                      <input
                        type="number"
                        value={issueDays}
                        onChange={(e) => setIssueDays(Number(e.target.value) || 0)}
                        className="w-24 bg-aether-800 border border-aether-700 rounded px-2 py-1 text-sm text-white"
                      />
                      <span className="text-[10px] text-gray-500">0 = no expiry</span>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={handleIssueLicense}
                        className="px-3 py-2 rounded text-xs bg-aether-700 hover:bg-aether-600 text-white"
                        disabled={issueStatus.state === 'issuing'}
                      >
                        {issueStatus.state === 'issuing' ? 'Issuing…' : 'Issue License'}
                      </button>
                      <button
                        onClick={() => {
                          setAdminToken('');
                          setIssueStatus({ state: 'idle' });
                        }}
                        className="px-3 py-2 rounded text-xs bg-aether-800 border border-aether-700 text-gray-200"
                      >
                        Lock Admin
                      </button>
                    </div>
                    {issueStatus.state === 'ok' && issueStatus.key && (
                      <div className="text-[10px] text-green-400 break-all">
                        {issueStatus.message} Key copied: {issueStatus.key}
                      </div>
                    )}
                    {issueStatus.state === 'error' && (
                      <div className="text-[10px] text-red-300">
                        {issueStatus.message || 'Failed to issue license.'}
                      </div>
                    )}
                  </div>
                </SettingsSection>
              )}

              <SettingsSection title="Streaming" subtitle="RTMP + quality controls" defaultOpen>
                <div>
                  <label className="text-gray-400 text-sm">Stream Key (YouTube/Twitch)</label>
                  <input
                    type="password"
                    value={streamKey}
                    onChange={e => setStreamKey(e.target.value)}
                    placeholder="rtmp_key_12345..."
                    className="w-full bg-aether-800 border border-aether-700 rounded p-2 text-sm text-white focus:border-aether-500 outline-none"
                  />
                  <p className="text-[10px] text-gray-500 mt-1">Saved locally. Requires local backend running.</p>
                </div>

                <div className="bg-aether-800/50 p-3 rounded-lg space-y-2">
                  <h4 className="text-sm font-bold text-white mb-1">Multi-Stream Destinations</h4>
                  <p className="text-[10px] text-gray-500">Add extra RTMP targets (Twitch, Facebook, etc.)</p>
                  {destinations.length === 0 && (
                    <div className="text-[10px] text-gray-500">No extra destinations yet.</div>
                  )}
                  {destinations.map(d => (
                    <div key={d.id} className="space-y-1 border border-aether-700 rounded p-2">
                      <div className="flex items-center gap-2">
                        <input
                          value={d.label}
                          onChange={(e) => updateDestination(d.id, { label: e.target.value })}
                          className="flex-1 bg-aether-800 border border-aether-700 rounded px-2 py-1 text-[10px] text-white"
                          placeholder="Label"
                        />
                        <label className="text-[10px] text-gray-300 flex items-center gap-1">
                          <input
                            type="checkbox"
                            checked={d.enabled}
                            onChange={(e) => updateDestination(d.id, { enabled: e.target.checked })}
                          />
                          On
                        </label>
                        <button
                          onClick={() => removeDestination(d.id)}
                          className="px-2 py-1 text-[10px] rounded bg-red-500/20 text-red-300"
                        >
                          Remove
                        </button>
                      </div>
                      <input
                        value={d.url}
                        onChange={(e) => updateDestination(d.id, { url: e.target.value })}
                        className="w-full bg-aether-800 border border-aether-700 rounded px-2 py-1 text-[10px] text-white"
                        placeholder="rtmp://.../your-stream-key"
                      />
                    </div>
                  ))}
                  <button
                    onClick={addDestination}
                    className="px-2 py-1 text-[10px] rounded bg-aether-800 border border-aether-700 text-gray-200"
                  >
                    Add Destination
                  </button>
                </div>

                <div>
                  <label className="text-gray-400 text-sm">Stream Quality (Target Bitrate)</label>
                  <select
                    value={streamQuality}
                    onChange={(e) => {
                      const val = e.target.value as StreamQualityPreset;
                      applyStreamQuality(val);
                    }}
                    disabled={wifiMode}
                    className={`w-full bg-aether-800 border border-aether-700 rounded p-2 text-sm text-white focus:border-aether-500 outline-none ${wifiMode ? 'opacity-60 cursor-not-allowed' : ''}`}
                  >
                    <option value="high">High (3.0 Mbps - 720p30)</option>
                    <option value="medium">Medium (2.2 Mbps - 720p30)</option>
                    <option value="low">Low (1.2 Mbps - 720p30)</option>
                  </select>
                  <div className="mt-2 flex items-center justify-between text-[10px] text-gray-400">
                    <span>Lower this if YouTube complains about "Low Signal" or buffering.</span>
                    <label className="flex items-center gap-2 text-[10px] text-gray-300">
                      <input
                        type="checkbox"
                        checked={wifiMode}
                        onChange={(e) => setWifiMode(e.target.checked)}
                      />
                      Wi-Fi Friendly Mode
                    </label>
                  </div>
                  {wifiMode && (
                    <p className="text-[10px] text-yellow-300 mt-1">Wi-Fi Mode forces 720p/24fps and lower bitrate for stability.</p>
                  )}
                </div>
              </SettingsSection>
            </div>
            <div className="flex justify-end gap-3 px-4 py-3 border-t border-aether-800 bg-aether-900/80">
              <button onClick={() => setShowSettings(false)} className="px-4 py-2 rounded text-sm bg-aether-500 text-white">Done</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
