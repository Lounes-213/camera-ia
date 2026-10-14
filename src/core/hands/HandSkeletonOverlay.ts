/**
 * HandSkeletonOverlay — high-tech neon visualizer for 21 MediaPipe hand landmarks.
 *
 * Renders glowing cyber-joints, futuristic connecting bones, targeting reticles
 * on fingertips, pinch energy arcs, and a sleek HUD badge directly over the camera stage.
 */
import type { HandPose } from './GestureRecognizer';
import type { GestureType } from '../../app/state';

const CONNECTIONS: readonly [number, number][] = [
  // Thumb
  [0, 1], [1, 2], [2, 3], [3, 4],
  // Index
  [0, 5], [5, 6], [6, 7], [7, 8],
  // Middle
  [0, 9], [9, 10], [10, 11], [11, 12],
  // Ring
  [0, 13], [13, 14], [14, 15], [15, 16],
  // Pinky
  [0, 17], [17, 18], [18, 19], [19, 20],
  // Palm connections
  [5, 9], [9, 13], [13, 17], [0, 17], [0, 5],
];

export interface HandSkeletonOverlayOptions {
  container: HTMLElement;
  enabled?: boolean;
}

export class HandSkeletonOverlay {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private enabled = true;
  private width = 0;
  private height = 0;
  private dpr = 1;
  private pulse = 0;

  constructor(options: HandSkeletonOverlayOptions) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'hand-skeleton-overlay';
    this.canvas.setAttribute('aria-hidden', 'true');
    Object.assign(this.canvas.style, {
      position: 'fixed',
      inset: '0',
      width: '100vw',
      height: '100vh',
      pointerEvents: 'none',
      zIndex: '35',
    });

    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('2D context unavailable for hand skeleton');
    this.ctx = ctx;

    if (options.enabled !== undefined) this.enabled = options.enabled;

    document.body.appendChild(this.canvas);
    this.resize();
    window.addEventListener('resize', this.onResize);
  }

  private readonly onResize = (): void => {
    this.resize();
  };

  resize(): void {
    const w = window.innerWidth || document.documentElement.clientWidth || 360;
    const h = window.innerHeight || document.documentElement.clientHeight || 640;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.width = w;
    this.height = h;
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.clear();
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  private activeStroke2D: { x: number; y: number }[] = [];
  private allStrokes2D: { points: { x: number; y: number }[]; color: string; size: number }[] = [];
  private currentDrawColor = '#00f0ff';
  private currentDrawSize = 4.5;

  startStroke2D(normX: number, normY: number, color?: string, size?: number): void {
    if (color) this.currentDrawColor = color;
    if (size) this.currentDrawSize = size;
    this.activeStroke2D = [{ x: normX, y: normY }];
  }

  addPoint2D(normX: number, normY: number): void {
    if (this.activeStroke2D.length === 0) {
      this.activeStroke2D = [{ x: normX, y: normY }];
      return;
    }
    const last = this.activeStroke2D[this.activeStroke2D.length - 1]!;
    const dist = Math.hypot(last.x - normX, last.y - normY);
    if (dist > 0.003) {
      this.activeStroke2D.push({ x: normX, y: normY });
    }
  }

  endStroke2D(): void {
    if (this.activeStroke2D.length > 1) {
      this.allStrokes2D.push({
        points: [...this.activeStroke2D],
        color: this.currentDrawColor,
        size: this.currentDrawSize,
      });
    }
    this.activeStroke2D = [];
  }

  undoStroke2D(): void {
    this.endStroke2D();
    this.allStrokes2D.pop();
  }

  clearStrokes2D(): void {
    this.activeStroke2D = [];
    this.allStrokes2D = [];
  }

  eraseNear2D(normX: number, normY: number, normRadius = 0.055): void {
    const nextStrokes: { points: { x: number; y: number }[]; color: string; size: number }[] = [];
    for (const stroke of this.allStrokes2D) {
      let segment: { x: number; y: number }[] = [];
      for (const p of stroke.points) {
        if (Math.hypot(p.x - normX, p.y - normY) >= normRadius) {
          segment.push(p);
        } else {
          if (segment.length > 0) {
            nextStrokes.push({ points: segment, color: stroke.color, size: stroke.size });
            segment = [];
          }
        }
      }
      if (segment.length > 0) {
        nextStrokes.push({ points: segment, color: stroke.color, size: stroke.size });
      }
    }
    this.allStrokes2D = nextStrokes;
  }

  private eraserCursorPos: { x: number; y: number } | null = null;
  setEraserCursor(pos: { x: number; y: number } | null): void {
    this.eraserCursorPos = pos;
  }

  setDrawColor(color: string): void {
    this.currentDrawColor = color;
  }

  setDrawSize(size: number): void {
    this.currentDrawSize = size;
  }

  clear(): void {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  /**
   * Renders the detected hands on the current frame.
   * @param poses Hand poses from GestureRecognizer.
   * @param gesture Current global gesture.
   */
  render(poses: readonly HandPose[], gesture: GestureType): void {
    if (!this.enabled) return;

    if (this.width <= 1 || this.height <= 1 || this.canvas.width <= 1) {
      this.resize();
    }

    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    this.pulse = (this.pulse + 0.08) % (Math.PI * 2);
    const pulseFactor = 0.85 + Math.sin(this.pulse) * 0.15;

    ctx.save();
    ctx.scale(this.dpr, this.dpr);

    // 0. Render 2D screen ink strokes (writing directly on screen)
    this.renderInkStrokes(ctx);

    if (poses.length === 0) {
      ctx.restore();
      return;
    }

    for (let pIdx = 0; pIdx < poses.length; pIdx++) {
      const pose = poses[pIdx]!;
      const landmarks = pose.landmarks;
      if (!landmarks || landmarks.length < 21) continue;

      const isPinch = pose.pinching || gesture === 'pinch' || gesture === 'two-hands';
      const isPoint = gesture === 'point';

      // Pick vibrant thematic cyber colors
      const boneColor = isPinch ? '#ff8800' : isPoint ? '#a855f7' : '#00f0ff';
      const nodeColor = isPinch ? '#ffaa00' : isPoint ? '#c084fc' : '#38bdf8';
      const tipColor = isPinch ? '#ff3366' : isPoint ? '#ec4899' : '#06b6d4';

      // 1. Draw glowing bones (connections)
      ctx.lineWidth = 3.5;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.shadowColor = boneColor;
      ctx.shadowBlur = 12;

      for (const [i, j] of CONNECTIONS) {
        const p1 = landmarks[i]!;
        const p2 = landmarks[j]!;

        const x1 = p1.x * this.width;
        const y1 = p1.y * this.height;
        const x2 = p2.x * this.width;
        const y2 = p2.y * this.height;

        ctx.strokeStyle = boneColor;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      }

      // 2. Draw joints (nodes)
      for (let i = 0; i < landmarks.length; i++) {
        const pt = landmarks[i]!;
        const x = pt.x * this.width;
        const y = pt.y * this.height;

        const isTip = i === 4 || i === 8 || i === 12 || i === 16 || i === 20;
        const isIndexTip = i === 8;

        ctx.shadowColor = isTip ? tipColor : nodeColor;
        ctx.shadowBlur = isTip ? 16 : 8;

        // Outer glow dot
        ctx.fillStyle = isTip ? tipColor : nodeColor;
        ctx.beginPath();
        const baseRadius = isIndexTip ? 7.0 : isTip ? 5.5 : 3.5;
        ctx.arc(x, y, baseRadius * (isIndexTip ? pulseFactor : 1), 0, Math.PI * 2);
        ctx.fill();

        // Inner solid white core for intense neon look
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(x, y, isIndexTip ? 2.8 : isTip ? 2.5 : 1.6, 0, Math.PI * 2);
        ctx.fill();

        // Pinpoint Cursor on index fingertip apex (shifted higher up as requested)
        if (isIndexTip && isPoint && !isPinch) {
          const dip = landmarks[7] ?? pt;
          const dirX = pt.x - dip.x;
          const dirY = pt.y - dip.y;
          const dirLen = Math.hypot(dirX, dirY) || 1;
          // Offset closer to the index apex and shifted slightly upwards ("zidlu lfuq chwiya")
          const apexX = (pt.x + (dirX / dirLen) * 0.022) * this.width;
          const apexY = (pt.y + (dirY / dirLen) * 0.022 - 0.022) * this.height;

          ctx.strokeStyle = tipColor;
          ctx.lineWidth = 2.2;
          ctx.beginPath();
          ctx.moveTo(apexX - 12, apexY);
          ctx.lineTo(apexX - 4, apexY);
          ctx.moveTo(apexX + 4, apexY);
          ctx.lineTo(apexX + 12, apexY);
          ctx.moveTo(apexX, apexY - 12);
          ctx.lineTo(apexX, apexY - 4);
          ctx.moveTo(apexX, apexY + 4);
          ctx.lineTo(apexX, apexY + 12);
          ctx.stroke();

          // Small targeting reticle circle
          ctx.beginPath();
          ctx.arc(apexX, apexY, 4, 0, Math.PI * 2);
          ctx.stroke();
        }
      }

      // 3. Pinch Energy Arc & Pen hold indicator (thumb + index touching in sign 👌)
      if (isPinch) {
        const thumb = landmarks[4]!;
        const index = landmarks[8]!;
        const tx = thumb.x * this.width;
        const ty = thumb.y * this.height;
        const ix = index.x * this.width;
        const iy = index.y * this.height;

        ctx.strokeStyle = '#ff0055';
        ctx.shadowColor = '#ff0055';
        ctx.shadowBlur = 18;
        ctx.lineWidth = 4.5;
        ctx.beginPath();
        ctx.moveTo(tx, ty);
        ctx.lineTo(ix, iy);
        ctx.stroke();

        // Contact stylus / pen tip point — raised higher up so it's clearly visible above fingers
        const cx = (tx + ix) / 2;
        const cy = (ty + iy) / 2 - 0.038 * this.height;
        ctx.fillStyle = '#ffffff';
        ctx.shadowColor = '#00f0ff';
        ctx.shadowBlur = 14;
        ctx.beginPath();
        ctx.arc(cx, cy, 6 * pulseFactor, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Visual Eraser Feedback Ring (when Gomme is active)
    if (this.eraserCursorPos) {
      const ex = this.eraserCursorPos.x * this.width;
      const ey = this.eraserCursorPos.y * this.height;
      ctx.strokeStyle = 'rgba(255, 60, 90, 0.9)';
      ctx.fillStyle = 'rgba(255, 60, 90, 0.22)';
      ctx.shadowColor = '#ff3366';
      ctx.shadowBlur = 18;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(ex, ey, 26, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    ctx.restore();
  }

  private renderInkStrokes(ctx: CanvasRenderingContext2D): void {
    if (this.allStrokes2D.length === 0 && this.activeStroke2D.length === 0) return;

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const drawList = [
      ...this.allStrokes2D,
      ...(this.activeStroke2D.length > 0
        ? [{ points: this.activeStroke2D, color: this.currentDrawColor, size: this.currentDrawSize }]
        : []),
    ];

    for (const stroke of drawList) {
      if (stroke.points.length === 0) continue;

      // Single point / dot tap
      if (stroke.points.length === 1) {
        const pt = stroke.points[0]!;
        const px = pt.x * this.width;
        const py = pt.y * this.height;
        ctx.fillStyle = stroke.color;
        ctx.shadowColor = stroke.color;
        ctx.shadowBlur = 18;
        ctx.beginPath();
        ctx.arc(px, py, stroke.size * 0.9, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(px, py, stroke.size * 0.4, 0, Math.PI * 2);
        ctx.fill();
        continue;
      }

      // PASS 1: Broad ultra-vibrant neon glow aura
      ctx.strokeStyle = stroke.color;
      ctx.shadowColor = stroke.color;
      ctx.shadowBlur = 22;
      ctx.lineWidth = stroke.size + 3.5;
      ctx.beginPath();
      const first = stroke.points[0]!;
      ctx.moveTo(first.x * this.width, first.y * this.height);
      for (let k = 1; k < stroke.points.length; k++) {
        const pt = stroke.points[k]!;
        ctx.lineTo(pt.x * this.width, pt.y * this.height);
      }
      ctx.stroke();

      // PASS 2: Saturated color stroke
      ctx.shadowBlur = 6;
      ctx.lineWidth = stroke.size;
      ctx.stroke();

      // PASS 3: Crisp high-contrast white core (so it's extremely visible on camera)
      ctx.strokeStyle = '#ffffff';
      ctx.shadowBlur = 0;
      ctx.lineWidth = Math.max(1.8, stroke.size * 0.35);
      ctx.stroke();
    }
    ctx.restore();
  }

  dispose(): void {
    window.removeEventListener('resize', this.onResize);
    this.canvas.remove();
  }
}
