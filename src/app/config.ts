/**
 * Central, typed application configuration.
 *
 * Every optional/V2 module sits behind a feature flag here and is loaded with a
 * dynamic `import()` so it never inflates the base bundle. Flags can be
 * overridden at build time with `VITE_*` environment variables.
 */

/** Reads a boolean env flag, falling back to the default. */
function flag(name: string, fallback: boolean): boolean {
  const raw = import.meta.env[name as keyof ImportMetaEnv] as string | undefined;
  if (raw === undefined || raw === '') return fallback;
  return raw === '1' || raw.toLowerCase() === 'true';
}

function str(name: string, fallback: string): string {
  const raw = import.meta.env[name as keyof ImportMetaEnv] as string | undefined;
  return raw === undefined || raw === '' ? fallback : raw;
}

function num(name: string, fallback: number): number {
  const raw = import.meta.env[name as keyof ImportMetaEnv] as string | undefined;
  const parsed = raw === undefined || raw === '' ? NaN : Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export interface FeatureFlags {
  /** MediaPipe hand tracking / markerless mode. */
  readonly hands: boolean;
  /** PeerJS multi-user rooms. */
  readonly rooms: boolean;
  /** "Ask for an object" model search. */
  readonly search: boolean;
  /** Optional ~30 MB multilingual MiniLM semantic re-ranking (off by default). */
  readonly semanticSearch: boolean;
  /** Web Speech API voice input inside the search sheet. */
  readonly voice: boolean;
  /** PWA service worker registration. */
  readonly pwa: boolean;
}

export const CONFIG = {
  brand: {
    name: 'WebAR Spatial Anchor',
    short: 'WebAR',
    repo: 'https://github.com/',
  },

  features: {
    hands: flag('VITE_FEATURE_HANDS', true),
    rooms: flag('VITE_FEATURE_ROOMS', true),
    search: flag('VITE_FEATURE_SEARCH', true),
    semanticSearch: flag('VITE_FEATURE_SEMANTIC', false),
    voice: flag('VITE_FEATURE_VOICE', true),
    pwa: flag('VITE_FEATURE_PWA', true),
  } satisfies FeatureFlags,

  /** Image-tracking (MindAR) tuning. */
  ar: {
    /** Compiled target, produced by `npm run gen:target`. */
    targetSrc: str('VITE_TARGET_SRC', 'targets.mind'),
    maxTrack: 1,
    /**
     * One-Euro pose filter. Lower minCutOff = smoother/steadier but laggier;
     * higher beta = reacts faster to fast motion.
     */
    filterMinCF: num('VITE_FILTER_MIN_CF', 0.001),
    filterBeta: num('VITE_FILTER_BETA', 0.01),
    warmupTolerance: 5,
    missTolerance: 8,
    /** Seconds to keep rendering after the target is lost before idling. */
    lostIdleAfter: 6,
  },

  /** MediaPipe HandLandmarker (self-hosted in /public/mediapipe). */
  hands: {
    wasmRoot: 'mediapipe/wasm',
    modelPath: 'mediapipe/hand_landmarker.task',
    /**
     * CDN runtime used only when the self-hosted files are absent.
     *
     * The wasm + model weigh ~40 MB, which does not fit every deploy budget
     * (Sites caps uploads at 10 MiB). Marker mode never reads these; hands mode
     * probes the local folder first and only falls back if that fails.
     */
    cdn: {
      wasmRoot: str(
        'VITE_MEDIAPIPE_CDN',
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm',
      ),
      modelPath: str(
        'VITE_MEDIAPIPE_MODEL_CDN',
        'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
      ),
    },
    maxHands: 2,
    /** Detect every Nth render frame; adaptive downgrade if slow. */
    detectEvery: 2,
    detectEverySlow: 3,
    /** Poll rate once no hand has been seen for a while. */
    idleIntervalMs: 250,
    /** ms without a hand before dropping to idle polling. */
    idleAfterMs: 5000,
    pinchOn: 0.52,
    pinchOff: 0.65,
    /** 1-unit reference: hand "size" (wrist->index MCP distance) for depth. */
    refHandSize: 0.17,
    cursorHoldMs: 2000,
    fistHoldMs: 1000,
    smoothing: { minCutOff: 1.2, beta: 0.02 },
  },

  /** PeerJS rooms. Empty host = PeerJS public cloud signalling. */
  room: {
    peerHost: str('VITE_PEER_HOST', ''),
    peerPort: num('VITE_PEER_PORT', 443),
    peerPath: str('VITE_PEER_PATH', '/'),
    peerSecure: flag('VITE_PEER_SECURE', true),
    peerKey: str('VITE_PEER_KEY', 'peerjs'),
    maxPeers: 4,
    syncHz: 18,
    /** Optional free TURN credentials (Open Relay / Metered). */
    turnUrl: str('VITE_TURN_URL', ''),
    turnUser: str('VITE_TURN_USER', ''),
    turnCredential: str('VITE_TURN_CREDENTIAL', ''),
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:global.stun.twilio.com:3478' },
    ] as RTCIceServer[],
    /** Cap for chunked GLB transfer over the data channel (bytes). */
    maxTransferBytes: 5 * 1024 * 1024,
  },

  /** Model search + import budgets. */
  search: {
    /** Serverless proxy base (Cloudflare Pages Functions). */
    proxyBase: str('VITE_SEARCH_PROXY', '/api'),
    debounceMs: 400,
    maxTriangleCount: 150_000,
    maxDownloadBytes: 10 * 1024 * 1024,
    cacheName: 'webar-models-v1',
    creditsPath: 'model-credits.json',
  },

  perf: {
    /** Hard cap on devicePixelRatio to protect 60 FPS on mid-range phones. */
    maxPixelRatio: 2,
    /** Downgrade quality if the average frame time exceeds this (ms). */
    slowFrameMs: 22,
    /** Number of consecutive slow samples before downgrading. */
    slowSamples: 60,
  },

  storage: {
    key: 'webar.spatial.v2',
  },

  urls: {
    markerPng: 'marker.png',
    markerA4: 'marker-a4.png',
    mindCompiler: 'https://hiukim.github.io/mind-ar-js-doc/tools/compile',
  },
} as const;

export type AppConfig = typeof CONFIG;
export const FEATURES = CONFIG.features;
