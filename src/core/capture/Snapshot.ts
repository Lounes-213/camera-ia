/**
 * Snapshot — composites the live camera frame with the 3D overlay.
 *
 * A canvas screenshot alone would lose the video (it lives in a separate
 * <video> element outside WebGL), so we re-render the scene at a higher
 * resolution and draw both layers into an offscreen canvas using exactly the
 * same "cover" fit the CSS applies — including the horizontal mirror the user
 * already sees when the front camera is active.
 */
import * as THREE from 'three';

export interface SnapshotOptions {
  video: HTMLVideoElement;
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  /** True when the front camera is active (the preview is mirrored). */
  mirrored?: boolean;
  /** Optional credit line burned into the bottom of the image. */
  caption?: string;
  /** Output height in pixels (width follows the stage aspect). */
  targetHeight?: number;
  /** 0..1 JPEG quality. */
  quality?: number;
}

export interface SnapshotResult {
  blob: Blob;
  dataUrl: string;
  width: number;
  height: number;
}

const MAX_HEIGHT = 1600;

/** Returns the output size that matches the stage aspect ratio. */
export function snapshotSize(
  stageWidth: number,
  stageHeight: number,
  videoWidth: number,
  videoHeight: number,
  targetHeight = 1280,
): { width: number; height: number } {
  // Prefer the stage aspect; fall back to the camera stream when the stage has
  // not been laid out yet (e.g. a snapshot taken during a rotation).
  const aspect =
    stageWidth > 0 && stageHeight > 0
      ? stageWidth / stageHeight
      : videoWidth > 0 && videoHeight > 0
        ? videoWidth / videoHeight
        : 1;
  const cap = Math.min(MAX_HEIGHT, Math.max(videoHeight || targetHeight, targetHeight));
  const height = Math.max(480, Math.round(cap));
  const width = Math.max(480, Math.round(height * aspect));
  return { width, height };
}

/** Computes the source rectangle for a "cover" crop of the video. */
export function coverCrop(
  videoWidth: number,
  videoHeight: number,
  targetAspect: number,
): { x: number; y: number; width: number; height: number } {
  if (videoWidth <= 0 || videoHeight <= 0) {
    return { x: 0, y: 0, width: videoWidth, height: videoHeight };
  }
  const videoAspect = videoWidth / videoHeight;
  if (videoAspect > targetAspect) {
    const width = videoHeight * targetAspect;
    return { x: (videoWidth - width) / 2, y: 0, width, height: videoHeight };
  }
  const height = videoWidth / targetAspect;
  return { x: 0, y: (videoHeight - height) / 2, width: videoWidth, height };
}

/** Captures the composited snapshot. */
export async function captureSnapshot(options: SnapshotOptions): Promise<SnapshotResult> {
  const { video, renderer, scene, camera, mirrored = false, caption, quality = 0.92 } = options;
  const stage = renderer.domElement;
  const stageWidth = stage.clientWidth || stage.width;
  const stageHeight = stage.clientHeight || stage.height;

  const { width, height } = snapshotSize(
    stageWidth,
    stageHeight,
    video.videoWidth,
    video.videoHeight,
    options.targetHeight ?? 1280,
  );

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas-2d-unavailable');

  // ---- 1. Camera frame ----------------------------------------------------
  const crop = coverCrop(video.videoWidth, video.videoHeight, width / height);
  ctx.save();
  if (mirrored) {
    ctx.translate(width, 0);
    ctx.scale(-1, 1);
  }
  try {
    ctx.drawImage(video, crop.x, crop.y, crop.width, crop.height, 0, 0, width, height);
  } catch {
    // A not-yet-ready video throws; fall back to a neutral background.
    ctx.fillStyle = '#0e0b09';
    ctx.fillRect(0, 0, width, height);
  }
  ctx.restore();

  // ---- 2. 3D layer, re-rendered at the output resolution -------------------
  const previousSize = renderer.getSize(new THREE.Vector2());
  const previousPixelRatio = renderer.getPixelRatio();
  const previousAspect = camera.aspect;

  try {
    renderer.setPixelRatio(1);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);

    if (mirrored) {
      ctx.save();
      ctx.translate(width, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(renderer.domElement, 0, 0, width, height);
      ctx.restore();
    } else {
      ctx.drawImage(renderer.domElement, 0, 0, width, height);
    }
  } finally {
    // Restore synchronously so the user never sees a stretched frame.
    renderer.setPixelRatio(previousPixelRatio);
    renderer.setSize(previousSize.x, previousSize.y, false);
    camera.aspect = previousAspect;
    camera.updateProjectionMatrix();
  }

  // ---- 3. Credit caption (CC-BY compliance) -------------------------------
  if (caption) {
    drawCaption(ctx, caption, width, height);
  }

  const blob = await canvasToBlob(canvas, quality);
  return { blob, dataUrl: canvas.toDataURL('image/jpeg', quality), width, height };
}

/** Draws a legible caption bar at the bottom of the image. */
function drawCaption(
  ctx: CanvasRenderingContext2D,
  caption: string,
  width: number,
  height: number,
): void {
  const fontSize = Math.max(14, Math.round(width * 0.022));
  ctx.font = `600 ${fontSize}px system-ui, -apple-system, sans-serif`;
  const padding = Math.round(fontSize * 0.8);
  const metrics = ctx.measureText(caption);
  const boxHeight = fontSize + padding * 2;
  const boxWidth = Math.min(width - padding * 2, metrics.width + padding * 2);
  const x = padding;
  const y = height - boxHeight - padding;

  ctx.fillStyle = 'rgba(14, 11, 9, 0.62)';
  roundRect(ctx, x, y, boxWidth, boxHeight, boxHeight / 2);
  ctx.fill();

  ctx.fillStyle = '#ffffff';
  ctx.textBaseline = 'middle';
  ctx.fillText(caption, x + padding, y + boxHeight / 2 + 1);
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('snapshot-encode-failed'))),
      'image/jpeg',
      quality,
    );
  });
}

/** Triggers a browser download for a blob. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Give the browser a moment to start the download before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** Shares a file via the Web Share API, returning false when unsupported. */
export async function shareFile(
  blob: Blob,
  filename: string,
  title: string,
  text?: string,
): Promise<boolean> {
  const file = new File([blob], filename, { type: blob.type });
  const navigatorWithShare = navigator as Navigator & {
    canShare?: (data: { files: File[] }) => boolean;
    share?: (data: { files?: File[]; title?: string; text?: string }) => Promise<void>;
  };
  if (!navigatorWithShare.share || !navigatorWithShare.canShare?.({ files: [file] })) {
    return false;
  }
  try {
    await navigatorWithShare.share({ files: [file], title, text });
    return true;
  } catch (err) {
    // A user-cancelled share is not an error worth surfacing.
    if ((err as { name?: string })?.name === 'AbortError') return true;
    return false;
  }
}
