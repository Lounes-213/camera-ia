/**
 * ARManager — owns the MindAR image-tracking lifecycle.
 *
 * Responsibilities:
 *  - create/destroy the MindARThree instance and its anchor;
 *  - start / pause / resume / stop without ever leaking the camera;
 *  - keep the underlying MediaStream alive when switching to hands mode so the
 *    browser never re-prompts for permission;
 *  - classify camera failures into friendly, translated error codes;
 *  - recover from a lost WebGL context.
 *
 * The render loop itself lives elsewhere (utils/raf.ts) — MindAR only tracks.
 */
import * as THREE from 'three';
import { MindARAnchor, MindARThree } from 'mind-ar/dist/mindar-image-three.prod.js';
import { CONFIG } from '../../app/config';
import type { ArPhase, ErrorCode } from '../../app/state';
import { assetExists, assetUrl } from '../../utils/assets';

export interface ARManagerOptions {
  container: HTMLElement;
  onPhase: (phase: ArPhase, error?: ErrorCode | null) => void;
  onTarget: (found: boolean) => void;
  onVideoChange?: (video: HTMLVideoElement) => void;
}

/** Maps a getUserMedia DOMException to our friendly error codes. */
export function classifyCameraError(err: unknown): ErrorCode {
  const name = (err as { name?: string } | null)?.name ?? '';
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'camera-denied';
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError':
      return 'camera-busy';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
    case 'OverconstrainedError':
      return 'no-camera';
    case 'NotSupportedError':
      return 'unsupported';
    default:
      return 'generic';
  }
}

export class ARManager {
  private mindar: MindARThree | null = null;
  private anchor: MindARAnchor | null = null;
  private running = false;
  private detectionPaused = false;
  private disposed = false;

  constructor(private readonly options: ARManagerOptions) {}

  /** True once MindAR is initialised (independent of the running state). */
  get isReady(): boolean {
    return this.mindar !== null && !this.disposed;
  }

  get anchorGroup(): THREE.Group | null {
    return this.anchor?.group ?? null;
  }

  get scene(): THREE.Scene | null {
    return this.mindar?.scene ?? null;
  }

  get camera(): THREE.PerspectiveCamera | null {
    return this.mindar?.camera ?? null;
  }

  get renderer(): THREE.WebGLRenderer | null {
    return this.mindar?.renderer ?? null;
  }

  /** The live <video> element that MindAR renders behind the canvas. */
  get video(): HTMLVideoElement | null {
    return this.mindar?.video ?? null;
  }

  get isTracking(): boolean {
    return this.running && !this.detectionPaused;
  }

  /** True when the user-facing camera is active (the preview is mirrored). */
  isFrontCamera(): boolean {
    return this.mindar?.shouldFaceUser ?? false;
  }

  /**
   * Verifies the compiled target exists, then constructs MindAR.
   * @returns false when `targets.mind` is missing (caller shows an error screen).
   */
  async init(): Promise<boolean> {
    const hasTarget = await assetExists(CONFIG.ar.targetSrc);
    if (!hasTarget) {
      this.options.onPhase('error', 'target-missing');
      return false;
    }

    const container = this.options.container;
    const mindar = new MindARThree({
      container,
      imageTargetSrc: assetUrl(CONFIG.ar.targetSrc),
      maxTrack: CONFIG.ar.maxTrack,
      uiLoading: 'no',
      uiScanning: 'no',
      uiError: 'no',
      filterMinCF: CONFIG.ar.filterMinCF,
      filterBeta: CONFIG.ar.filterBeta,
      warmupTolerance: CONFIG.ar.warmupTolerance,
      missTolerance: CONFIG.ar.missTolerance,
    });

    this.mindar = mindar;
    this.anchor = mindar.addAnchor(0);
    this.anchor.onTargetFound = () => this.options.onTarget(true);
    this.anchor.onTargetLost = () => this.options.onTarget(false);

    // Modern color management + tone mapping on the shared renderer.
    const renderer = mindar.renderer;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.setClearAlpha(0); // transparent so the <video> shows through
    renderer.domElement.setAttribute('aria-hidden', 'true');
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));

    // Recover from GPU context loss instead of freezing on a blank canvas.
    renderer.domElement.addEventListener('webglcontextlost', this.onContextLost, false);
    renderer.domElement.addEventListener('webglcontextrestored', this.onContextRestored, false);

    window.addEventListener('resize', this.onResize);
    window.addEventListener('orientationchange', this.onResize);

    this.options.onPhase('ready');
    return true;
  }

  /** Starts the camera + tracking. Never throws: failures become error phases. */
  async start(): Promise<boolean> {
    if (!this.mindar || this.disposed) return false;
    this.options.onPhase('loading');
    try {
      await this.mindar.start();
      this.running = true;
      this.detectionPaused = false;
      this.mindar.resize();
      this.options.onVideoChange?.(this.mindar.video);
      this.options.onPhase('running');
      return true;
    } catch {
      const code = await this.probeCameraError();
      this.running = false;
      this.options.onPhase('error', code);
      return false;
    }
  }

  /** Stops MindAR's detection loop but keeps the video element + stream alive. */
  pauseDetection(): void {
    if (!this.mindar || this.detectionPaused) return;
    this.mindar.controller.stopProcessVideo();
    this.detectionPaused = true;
  }

  /** Resumes detection on the existing stream (no new permission prompt). */
  resumeDetection(): void {
    if (!this.mindar || !this.running || !this.detectionPaused) return;
    this.detectionPaused = false;
    this.mindar.controller.processVideo(this.mindar.video);
  }

  /** Renders one frame of the AR scene. */
  render(): void {
    if (!this.mindar) return;
    this.mindar.renderer.render(this.mindar.scene, this.mindar.camera);
  }

  /** Recomputes the video/projection layout (call on resize/orientation). */
  resize(): void {
    if (!this.mindar || !this.running) return;
    this.mindar.resize();
  }

  /** Toggles front/back camera. MindAR rebuilds the stream (no new prompt). */
  async switchCamera(): Promise<void> {
    if (!this.mindar || !this.running) return;
    const wasPaused = this.detectionPaused;
    this.mindar.switchCamera();
    this.running = true;
    this.detectionPaused = false;

    // Allow the new video stream to attach and initialize
    await new Promise((resolve) => setTimeout(resolve, 200));

    if (this.mindar.video) {
      this.mindar.video.style.maxWidth = 'none';
      this.mindar.video.style.maxHeight = 'none';
      if (this.mindar.video.readyState >= 2) {
        this.mindar.resize();
      } else {
        this.mindar.video.addEventListener(
          'loadedmetadata',
          () => {
            this.mindar?.resize();
          },
          { once: true },
        );
      }
      this.options.onVideoChange?.(this.mindar.video);
    }
    if (wasPaused) this.pauseDetection();
  }

  /** Enumerates video inputs (labels only available after permission). */
  async listCameras(): Promise<{ id: string; label: string }[]> {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices
        .filter((d) => d.kind === 'videoinput')
        .map((d, i) => ({ id: d.deviceId, label: d.label || `Camera ${i + 1}` }));
    } catch {
      return [];
    }
  }

  /** Fully tears down: stops tracks, removes listeners and DOM nodes. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('orientationchange', this.onResize);
    if (this.mindar) {
      const canvas = this.mindar.renderer.domElement;
      canvas.removeEventListener('webglcontextlost', this.onContextLost);
      canvas.removeEventListener('webglcontextrestored', this.onContextRestored);
      try {
        this.mindar.stop();
      } catch {
        /* already stopped */
      }
      this.mindar.renderer.dispose();
      this.mindar = null;
    }
    this.anchor = null;
    this.running = false;
  }

  /**
   * On start failure MindAR swallows the DOMException, so we make one short
   * getUserMedia call to read the real error name, then release it immediately.
   */
  private async probeCameraError(): Promise<ErrorCode> {
    if (!navigator.mediaDevices?.getUserMedia) return 'unsupported';
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      stream.getTracks().forEach((t) => t.stop());
      return 'generic';
    } catch (err) {
      return classifyCameraError(err);
    }
  }

  private readonly onResize = (): void => {
    this.resize();
  };

  private readonly onContextLost = (event: Event): void => {
    // Prevent the default so the browser can restore the context.
    event.preventDefault();
    this.options.onPhase('error', 'context-lost');
  };

  private readonly onContextRestored = (): void => {
    if (this.running) this.options.onPhase('running');
    else if (this.isReady) this.options.onPhase('ready');
  };
}
