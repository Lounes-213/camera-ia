/**
 * HandTracker — MediaPipe HandLandmarker, throttled and offline-first.
 *
 * Design notes:
 *  - the landmarker prefers the runtime self-hosted in /public/mediapipe, so
 *    hands mode works offline and inside the PWA with zero third-party calls;
 *  - when those files are absent (a host with a small deploy budget cannot fit
 *    the ~40 MB of wasm) it falls back to a CDN, so hands mode still works as
 *    long as the device is online — see `resolveSources`;
 *  - detection runs every 2nd frame (3rd when frames are slow) so it can never
 *    block the render loop; the last known pose is reused in between;
 *  - all 21 landmarks pass through a One-Euro filter, which removes the
 *    jitter that makes hand-driven objects feel "shaky";
 *  - after 5 s without a hand we drop to 4 FPS polling to save battery;
 *  - the SAME <video> element MindAR uses is reused — the camera never opens
 *    twice and switching modes never re-prompts for permission.
 */
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';
import type { HandsStatus } from '../../app/state';
import { CONFIG } from '../../app/config';
import { assetUrl } from '../../utils/assets';
import { OneEuroVec3 } from '../../utils/math';
import { handToWorld, type CameraProjection, type HandWorldPose } from './projection';
import {
  GestureRecognizer,
  type GestureState,
  type Landmark,
  type RawHand,
} from './GestureRecognizer';

type Fileset = Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>;

/** Which runtime is backing the landmarker. */
export type HandsAssetOrigin = 'local' | 'cdn';

/** A candidate wasm-runtime + model pair. */
interface HandsAssets {
  /** Folder containing `vision_wasm[_nosimd]_internal.js/.wasm`. */
  readonly wasmRoot: string;
  /** Absolute URL of the `.task` model. */
  readonly modelPath: string;
  readonly origin: HandsAssetOrigin;
}

export interface HandTrackerOptions {
  /** Resolves the shared camera video element (may change after camera switch). */
  getVideo: () => HTMLVideoElement | null;
  /** True when the front camera is active (mirror x). */
  isMirrored: () => boolean;
  onStatus?: (status: HandsStatus) => void;
  onAvailable?: (available: boolean) => void;
}

export type { CameraProjection, HandWorldPose };
export { handToWorld };

export class HandTracker {
  private landmarker: HandLandmarker | null = null;
  private readonly recognizer = new GestureRecognizer();
  private readonly filters = new Map<string, OneEuroVec3[]>();
  private lastState: GestureState | null = null;
  private frame = 0;
  private detectEvery: number = CONFIG.hands.detectEvery;
  private lastDetectionMs = 0;
  private lastHandSeenMs = 0;
  private lastTimestamp = 0;
  private running = false;
  private delegate: 'GPU' | 'CPU' = 'GPU';

  constructor(private readonly options: HandTrackerOptions) {}

  /** Loads the wasm runtime + model. Returns false when unavailable. */
  async init(): Promise<boolean> {
    if (this.landmarker) return true;

    const loaded = await this.loadFileset();
    if (loaded) {
      const { fileset, assets } = loaded;
      for (const delegate of ['GPU', 'CPU'] as const) {
        try {
          this.landmarker = await this.createLandmarker(fileset, assets.modelPath, delegate);
          this.delegate = delegate;
          break;
        } catch (err) {
          console.warn(`[hands] ${delegate} delegate failed`, err);
        }
      }
    }

    const available = this.landmarker !== null;
    if (!available) console.warn('[hands] hand tracking runtime unavailable');
    this.options.onAvailable?.(available);
    return available;
  }

  /**
   * Picks where the wasm runtime + model are fetched from.
   *
   * Self-hosted always wins so the PWA keeps working offline. The SIMD and
   * non-SIMD runtimes ship together, so probing a single loader tells us
   * whether the whole folder is present. The response is content-type checked
   * because an SPA fallback answers `200 text/html` for missing files, which
   * would otherwise look like a valid runtime.
   */
  private async resolveSources(): Promise<HandsAssets[]> {
    const local: HandsAssets = {
      wasmRoot: assetUrl(CONFIG.hands.wasmRoot),
      modelPath: assetUrl(CONFIG.hands.modelPath),
      origin: 'local',
    };
    const remote: HandsAssets = {
      wasmRoot: CONFIG.hands.cdn.wasmRoot,
      modelPath: CONFIG.hands.cdn.modelPath,
      origin: 'cdn',
    };

    if (await this.probeLoader(local.wasmRoot)) return [local, remote];
    console.info('[hands] self-hosted runtime missing, using the CDN fallback');
    return [remote];
  }

  private async probeLoader(wasmRoot: string): Promise<boolean> {
    const url = `${wasmRoot.replace(/\/+$/, '')}/vision_wasm_internal.js`;
    try {
      const res = await fetch(url, { method: 'HEAD' });
      if (!res.ok) return false;
      const type = res.headers.get('content-type')?.toLowerCase() ?? '';
      return !type.includes('text/html');
    } catch {
      return false;
    }
  }

  /** Loads the fileset from the first source that works. */
  private async loadFileset(): Promise<{ fileset: Fileset; assets: HandsAssets } | null> {
    for (const assets of await this.resolveSources()) {
      try {
        const fileset = await FilesetResolver.forVisionTasks(assets.wasmRoot);
        return { fileset, assets };
      } catch (err) {
        console.warn(`[hands] wasm runtime failed to load from ${assets.origin}`, err);
      }
    }
    return null;
  }

  private async createLandmarker(
    fileset: Fileset,
    modelPath: string,
    delegate: 'GPU' | 'CPU',
  ): Promise<HandLandmarker> {
    return HandLandmarker.createFromOptions(fileset, {
      baseOptions: {
        modelAssetPath: modelPath,
        delegate,
      },
      runningMode: 'VIDEO',
      numHands: CONFIG.hands.maxHands,
      minHandDetectionConfidence: 0.55,
      minHandPresenceConfidence: 0.55,
      minTrackingConfidence: 0.5,
    });
  }

  get isReady(): boolean {
    return this.landmarker !== null;
  }

  get activeDelegate(): 'GPU' | 'CPU' {
    return this.delegate;
  }

  /** Enables/disables sampling. Disabling keeps the model warm. */
  setRunning(running: boolean): void {
    this.running = running;
    if (!running) {
      this.recognizer.reset();
      this.filters.clear();
      this.lastState = null;
      this.options.onStatus?.('off');
    } else {
      this.options.onStatus?.('searching');
    }
  }

  /**
   * Samples the camera once per call and returns the latest gesture state.
   * Returns the previous state on frames where detection is skipped so callers
   * always have something to render.
   */
  sample(nowMs: number, camera: CameraProjection): GestureState | null {
    if (!this.running || !this.landmarker) return this.lastState;

    const idle = this.lastHandSeenMs > 0 && nowMs - this.lastHandSeenMs > CONFIG.hands.idleAfterMs;

    if (idle) {
      // Battery saving: poll at ~4 FPS.
      if (nowMs - this.lastDetectionMs < CONFIG.hands.idleIntervalMs) return this.lastState;
    } else {
      this.frame += 1;
      if (this.frame % this.detectEvery !== 0) return this.lastState;
    }

    const video = this.options.getVideo();
    if (!video || video.readyState < 2 || video.videoWidth === 0) return this.lastState;

    // MediaPipe requires strictly increasing timestamps.
    const timestamp = Math.max(nowMs, this.lastTimestamp + 1);
    this.lastTimestamp = timestamp;

    const startedAt = performance.now();
    let result;
    try {
      result = this.landmarker.detectForVideo(video, timestamp);
    } catch (err) {
      console.warn('[hands] detection failed', err);
      return this.lastState;
    }
    const cost = performance.now() - startedAt;

    // Adaptive throttle: if detection itself is slow, sample less often.
    this.detectEvery = cost > 10 ? CONFIG.hands.detectEverySlow : CONFIG.hands.detectEvery;

    const rawHands = this.toRawHands(result.landmarks ?? [], result.handedness ?? []);
    const mirrored = this.options.isMirrored();

    const filtered = rawHands.map((hand, index) =>
      this.applyFilters(hand, index, nowMs, mirrored),
    );

    const state = this.recognizer.update(filtered, nowMs);

    if (state.poses.length > 0) {
      this.lastHandSeenMs = nowMs;
      this.options.onStatus?.('found');
    } else if (nowMs - this.lastHandSeenMs > 700) {
      this.options.onStatus?.('lost');
    }

    this.lastState = state;
    // The camera projection is part of the contract even if unused here: the
    // caller converts poses with `handToWorld` using the same projection.
    void camera;
    return state;
  }

  /** The most recent gesture state without running detection. */
  getLatest(): GestureState | null {
    return this.lastState;
  }

  private toRawHands(
    landmarks: Landmark[][],
    handedness: { categoryName: string; score: number }[][],
  ): RawHand[] {
    return landmarks.map((points, index) => {
      const label = handedness[index]?.[0];
      return {
        landmarks: points.map((point) => ({ x: point.x, y: point.y, z: point.z })),
        handedness: label?.categoryName === 'Left' ? 'Left' : 'Right',
        score: label?.score ?? 0,
      };
    });
  }

  /**
   * One-Euro filters every landmark of a hand. Mirroring is applied after
   * filtering so the filter state stays continuous when the camera flips.
   */
  private applyFilters(hand: RawHand, index: number, nowMs: number, mirrored: boolean): RawHand {
    const key = `${index}-${hand.handedness}`;
    let filters = this.filters.get(key);
    if (!filters || filters.length !== hand.landmarks.length) {
      filters = hand.landmarks.map(
        () => new OneEuroVec3(CONFIG.hands.smoothing.minCutOff, CONFIG.hands.smoothing.beta),
      );
      this.filters.set(key, filters);
    }

    const landmarks = hand.landmarks.map((point, i) => {
      const filter = filters[i]!;
      const [x, y, z] = filter.filter(point.x, point.y, point.z, nowMs);
      return {
        x: mirrored ? 1 - x : x,
        y,
        z,
      };
    });

    return { ...hand, landmarks };
  }

  dispose(): void {
    this.setRunning(false);
    this.landmarker?.close();
    this.landmarker = null;
  }
}
