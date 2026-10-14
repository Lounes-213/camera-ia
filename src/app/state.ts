/**
 * The complete application state shape plus its initial value.
 *
 * Rules:
 *  - never mutate state outside the store;
 *  - UI reads state, actions write it;
 *  - transient/derived values (fps, progress) also live here so tests and the
 *    debug overlay can observe everything from one place.
 */
import type { Lang } from '../ui/i18n';
import { isLowPowerDevice, prefersReducedMotion } from '../utils/device';
import { storage } from '../utils/storage';

export type AppMode = 'marker' | 'hands';

export type ArPhase = 'boot' | 'loading' | 'ready' | 'running' | 'paused' | 'error';

export type ErrorCode =
  | 'camera-denied'
  | 'camera-busy'
  | 'no-camera'
  | 'unsupported'
  | 'insecure'
  | 'webgl'
  | 'target-missing'
  | 'context-lost'
  | 'generic';

export type TabId = 'objects' | 'search' | 'style' | 'transform' | 'room' | 'export';

export type ModalId =
  | 'none'
  | 'onboarding'
  | 'snapshot'
  | 'marker'
  | 'credits'
  | 'shortcuts'
  | 'privacy'
  | 'hands-tutorial';

export type Quality = 'high' | 'medium' | 'low';

export type HandsStatus = 'off' | 'loading' | 'searching' | 'found' | 'lost' | 'error';

export type GestureType = 'none' | 'pinch' | 'palm' | 'two-hands' | 'fist' | 'point';

export type PeerStatus = 'idle' | 'creating' | 'joining' | 'connected' | 'reconnecting' | 'failed';

export type SearchStatus = 'idle' | 'searching' | 'done' | 'error';

export type ToastKind = 'info' | 'success' | 'warn' | 'error';

export interface ModelMeta {
  /** Stable id, e.g. `builtin:torusKnot` or `polypizza:abc123`. */
  id: string;
  title: string;
  author?: string;
  license?: string;
  sourceUrl?: string;
  provider?: string;
  triangles?: number;
  bytes?: number;
  thumbnail?: string;
  /** True for the bundled procedural objects (no attribution needed). */
  builtin?: boolean;
}

export interface MaterialState {
  color: string;
  metalness: number;
  roughness: number;
  glow: boolean;
  glowStrength: number;
  emissiveIntensity: number;
  lightIntensity: number;
  contactShadow: boolean;
  animation: boolean;
  wireframe: boolean;
}

export interface TransformState {
  autoRotate: boolean;
  spinSpeed: number;
  scale: number;
  height: number;
  rotation: { x: number; y: number; z: number };
}

export interface UiState {
  tab: TabId;
  sheetOpen: boolean;
  /** 0 = peek, 1 = half, 2 = full. */
  sheetSnap: number;
  sheetHeight: number;
  sidebarCollapsed: boolean;
  modal: ModalId;
  debug: boolean;
  onboardingSeen: boolean;
  searchQuery: string;
  /** Progress 0..1 when a custom model is loading. */
  loading: number | null;
}

export interface PeerInfo {
  id: string;
  name: string;
  latency: number;
  isHost: boolean;
}

export interface RoomState {
  status: PeerStatus;
  code: string | null;
  isHost: boolean;
  peers: PeerInfo[];
  error: string | null;
  /** Peer id currently allowed to transform the shared object. */
  controlHolder: string | null;
  controlRequested: boolean;
}

export interface HandsState {
  available: boolean;
  status: HandsStatus;
  gesture: GestureType;
  showSkeleton: boolean;
  /** True when running in battery-saving reduced mode. */
  reduced: boolean;
}

export interface SearchResult {
  id: string;
  title: string;
  author: string;
  license: string;
  sourceUrl: string;
  provider: string;
  thumbnail?: string;
  /** Direct downloadable GLB URL (proxy or local asset). */
  downloadUrl: string;
  triangles?: number;
  bytes?: number;
  format?: string;
}

export interface SearchState {
  query: string;
  status: SearchStatus;
  results: SearchResult[];
  errorKind: 'offline' | 'quota' | 'error' | 'none';
  semantic: boolean;
  semanticProgress: number;
  voiceAvailable: boolean;
}

export interface PerfState {
  fps: number;
  quality: Quality;
}

export interface AppState {
  mode: AppMode;
  phase: ArPhase;
  arError: ErrorCode | null;
  targetFound: boolean;
  /** 0..1 fade of the anchored object (smooth found/lost transitions). */
  objectOpacity: number;
  objectId: string;
  modelMeta: ModelMeta | null;
  material: MaterialState;
  transform: TransformState;
  ui: UiState;
  room: RoomState;
  hands: HandsState;
  search: SearchState;
  perf: PerfState;
  lang: Lang;
}

export const ORANGE_PRESETS: readonly string[] = [
  '#FF7A00',
  '#FF8F26',
  '#E56A00',
  '#FFB347',
  '#FFD166',
  '#FFFFFF',
  '#1A1410',
  '#14B86B',
  '#2F7CF6',
  '#E5484D',
  '#B14EFF',
  '#00D4C7',
] as const;

export const OBJECT_IDS: readonly string[] = [
  'torusKnot',
  'icosahedron',
  'crystal',
  'cubeGrid',
  'orbitSphere',
  'rocket',
  'robot',
] as const;

/** Default (and persisted) material. */
function initialMaterial(): MaterialState {
  return {
    color: '#FF7A00',
    metalness: 0.45,
    roughness: 0.28,
    glow: true,
    glowStrength: 1.1,
    emissiveIntensity: 0.9,
    lightIntensity: 1.0,
    contactShadow: true,
    animation: true,
    wireframe: false,
    ...storage.load<Partial<MaterialState>>('material', {}),
  };
}

function initialTransform(): TransformState {
  return {
    autoRotate: true,
    spinSpeed: 1,
    scale: 1,
    height: 0.28,
    rotation: { x: 0, y: 0, z: 0 },
    ...storage.load<Partial<TransformState>>('transform', {}),
  };
}

/** Builds the initial state, restoring user preferences from localStorage. */
export function createInitialState(): AppState {
  const lowPower = isLowPowerDevice();
  const storedTab = storage.load<TabId>('tab', 'objects');
  const storedObject = storage.load<string>('objectId', 'torusKnot');
  return {
    mode: storage.load<AppMode>('mode', 'hands'),
    phase: 'boot',
    arError: null,
    targetFound: false,
    objectOpacity: 0,
    objectId: OBJECT_IDS.includes(storedObject) ? storedObject : 'torusKnot',
    modelMeta: null,
    material: initialMaterial(),
    transform: initialTransform(),
    ui: {
      tab: storedTab,
      sheetOpen: false,
      sheetSnap: 1,
      sheetHeight: 0,
      sidebarCollapsed: false,
      modal: 'none',
      debug: false,
      onboardingSeen: storage.load<boolean>('onboardingSeen', false),
      searchQuery: '',
      loading: null,
    },
    room: {
      status: 'idle',
      code: null,
      isHost: false,
      peers: [],
      error: null,
      controlHolder: null,
      controlRequested: false,
    },
    hands: {
      available: false,
      status: 'off',
      gesture: 'none',
      showSkeleton: true,
      reduced: lowPower,
    },
    search: {
      query: '',
      status: 'idle',
      results: [],
      errorKind: 'none',
      semantic: false,
      semanticProgress: 0,
      voiceAvailable: false,
    },
    perf: {
      fps: 60,
      quality: lowPower || prefersReducedMotion() ? 'medium' : 'high',
    },
    lang: 'en',
  };
}
