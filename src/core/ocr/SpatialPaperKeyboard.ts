/**
 * SpatialPaperKeyboard — AR Touch-to-Type & Paper Character Recognition engine.
 *
 * Allows the user to point the camera at a physical sheet of paper with written letters,
 * calibrate the paper zone, and touch letters with their index finger to "seize" them into
 * a live glowing text field (champs txt).
 *
 * Includes:
 *  - Interactive paper calibration boundary
 *  - Multi-alphabet support (Latin A-Z, Arabic أ-ي, Numbers 0-9, Custom Paper Words)
 *  - Letter touch detection with particle energy feedback and synth audio chimes
 *  - Floating glassmorphism text HUD with Speech Synthesis (TTS), Clipboard copy,
 *    and 3D Holographic Text generation!
 */
import { el } from '../../ui/dom';
import { iconElement } from '../../ui/icon';
import { haptic } from '../../utils/device';

export type AlphabetType = 'latin' | 'arabic' | 'numbers' | 'custom';

export interface LetterCell {
  char: string;
  x: number; // 0..1 in screen space
  y: number; // 0..1 in screen space
  w: number;
  h: number;
}

export interface HandFingerData {
  indexX: number; // 0..1 in screen space
  indexY: number; // 0..1 in screen space
  pinchX: number; // 0..1 in screen space
  pinchY: number; // 0..1 in screen space
  isPinching: boolean;
  handedness?: 'Left' | 'Right';
}

export interface SpatialPaperKeyboardOptions {
  container: HTMLElement;
  onTextUpdated?: (text: string) => void;
  onSpawn3DText?: (text: string) => void;
  onStatusChange?: (action: 'pointing' | 'typed' | 'miss' | 'erase', char: string) => void;
  onClose?: () => void;
}

export class SpatialPaperKeyboard {
  readonly overlayCanvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  readonly textHudElement: HTMLElement;
  private readonly textInput: HTMLInputElement;

  private active = false;
  private currentAlphabet: AlphabetType = 'latin';
  private customWords = 'HELLO BIEN AR';
  private typedText = '';

  // Normalized paper calibration frame on screen
  private paperFrame = {
    x: 0.12,
    y: 0.28,
    w: 0.76,
    h: 0.46,
  };

  private cells: LetterCell[] = [];
  private hoveredChar: string | null = null;
  private audioCtx: AudioContext | null = null;
  private lastHandsPinching: boolean[] = [false, false];
  private lastHandsSeizedTime: number[] = [0, 0];
  private clickPointPulse = 0;

  // Visual particles for seized letters
  private particles: { x: number; y: number; targetX: number; targetY: number; progress: number; char: string; color: string }[] = [];

  // Lightning energy beams connecting click hand to targeted letter
  private lightningBeams: {
    fromX: number;
    fromY: number;
    toX: number;
    toY: number;
    startTime: number;
    duration: number;
    color: string;
    char: string;
  }[] = [];

  // Shockwave ripples expanding from the click point
  private shockwaves: {
    x: number;
    y: number;
    startTime: number;
    duration: number;
    color: string;
  }[] = [];

  constructor(private readonly options: SpatialPaperKeyboardOptions) {
    // 1. Overlay canvas for paper calibration frame and letter hitboxes
    this.overlayCanvas = document.createElement('canvas');
    this.overlayCanvas.className = 'spatial-paper-canvas';
    Object.assign(this.overlayCanvas.style, {
      position: 'fixed',
      inset: '0',
      width: '100vw',
      height: '100vh',
      pointerEvents: 'none',
      zIndex: '36',
    });
    const ctx = this.overlayCanvas.getContext('2d');
    if (!ctx) throw new Error('2D context unavailable for paper keyboard');
    this.ctx = ctx;

    // 2. Glowing Text HUD (champs txt)
    this.textHudElement = el('div', {
      class: 'spatial-text-hud glass animate-slide-up',
      style: {
        position: 'fixed',
        insetBlockEnd: '24px',
        insetInlineStart: '50%',
        transform: 'translateX(-50%)',
        zIndex: '45',
        display: 'none',
      },
    });

    this.textInput = el('input', {
      class: 'spatial-text-hud__input',
      attrs: {
        type: 'text',
        placeholder: 'أشر بالسبابة على الحرف ☝️ ثم انقر بيدك الثانية 👌 للكتابة...',
        readonly: 'true',
      },
    }) as HTMLInputElement;

    this.buildHud();
    this.recomputeCells();

    options.container.appendChild(this.overlayCanvas);
    options.container.appendChild(this.textHudElement);

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  private buildHud(): void {
    const header = el(
      'div',
      { class: 'spatial-text-hud__header' },
      el('div', { class: 'spatial-text-hud__title' },
        iconElement('ScanLine', { size: 17 }),
        el('span', { text: '🔤 حروف الورقة (Touch-to-Type OCR)' }),
      ),
      el('div', { class: 'spatial-text-hud__tabs' },
        this.createTabBtn('latin', 'ABC'),
        this.createTabBtn('arabic', 'أبجد'),
        this.createTabBtn('numbers', '123'),
        this.createTabBtn('custom', '✏️ تخصيص'),
      ),
    );

    const inputRow = el(
      'div',
      { class: 'spatial-text-hud__input-row' },
      this.textInput,
      el('button', {
        class: 'btn btn--ghost btn--icon',
        title: 'مسح حرف (Backspace)',
        on: { click: () => this.backspace() },
      }, iconElement('Undo2', { size: 18 })),
      el('button', {
        class: 'btn btn--ghost btn--icon',
        title: 'مسح الكل (Clear)',
        on: { click: () => this.clearText() },
      }, iconElement('RotateCcw', { size: 18 })),
    );

    const actionsRow = el(
      'div',
      { class: 'spatial-text-hud__actions' },
      el('button', {
        class: 'btn btn--ghost',
        on: { click: () => this.speakText() },
      }, iconElement('Volume2', { size: 16 }), el('span', { text: 'نطق (Écouter)' })),
      el('button', {
        class: 'btn btn--ghost',
        on: { click: () => this.copyText() },
      }, iconElement('Copy', { size: 16 }), el('span', { text: 'نسخ (Copier)' })),
      el('button', {
        class: 'btn btn--primary',
        style: { background: 'linear-gradient(135deg, #00f0ff, #7928ca)', border: 'none' },
        on: { click: () => this.spawn3D() },
      }, iconElement('Boxes', { size: 16 }), el('span', { text: '🧊 تجسيم 3D' })),
      el('button', {
        class: 'btn btn--ghost btn--icon',
        style: { marginInlineStart: 'auto' },
        title: 'إغلاق',
        on: { click: () => this.close() },
      }, iconElement('X', { size: 18 })),
    );

    this.textHudElement.append(header, inputRow, actionsRow);
  }

  private createTabBtn(type: AlphabetType, label: string): HTMLElement {
    return el('button', {
      class: `spatial-tab-btn ${this.currentAlphabet === type ? 'is-active' : ''}`,
      type: 'button',
      on: {
        click: () => {
          this.currentAlphabet = type;
          if (type === 'custom') {
            const promptVal = window.prompt('اكتب الحروف أو الكلمات الموجودة على ورقتك (مثال: BIEN ARABE SALAM):', this.customWords);
            if (promptVal) this.customWords = promptVal.toUpperCase();
          }
          this.recomputeCells();
          this.updateTabStyles();
        },
      },
    }, el('span', { text: label }));
  }

  private updateTabStyles(): void {
    const btns = this.textHudElement.querySelectorAll<HTMLElement>('.spatial-tab-btn');
    const tabs: AlphabetType[] = ['latin', 'arabic', 'numbers', 'custom'];
    btns.forEach((btn, idx) => {
      btn.classList.toggle('is-active', tabs[idx] === this.currentAlphabet);
    });
  }

  setActive(active: boolean): void {
    this.active = active;
    this.textHudElement.style.display = active ? 'flex' : 'none';
    if (!active) {
      this.ctx.clearRect(0, 0, this.overlayCanvas.width, this.overlayCanvas.height);
      this.particles = [];
      this.hoveredChar = null;
    }
  }

  get isActive(): boolean {
    return this.active;
  }

  close(): void {
    this.setActive(false);
    this.options.onClose?.();
  }

  resize(): void {
    const w = window.innerWidth || 360;
    const h = window.innerHeight || 640;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.overlayCanvas.width = Math.round(w * dpr);
    this.overlayCanvas.height = Math.round(h * dpr);
  }

  private recomputeCells(): void {
    let charList: string[] = [];
    if (this.currentAlphabet === 'latin') {
      charList = 'A B C D E F G H I J K L M N O P Q R S T U V W X Y Z . ␣ ⌫'.split(' ');
    } else if (this.currentAlphabet === 'arabic') {
      charList = 'ا ب ت ث ج ح خ د ذ ر ز س ش ص ض ط ظ ع غ ف ق ك ل م ن هـ و ي . ␣ ⌫'.split(' ');
    } else if (this.currentAlphabet === 'numbers') {
      charList = '1 2 3 4 5 6 7 8 9 0 + - * / = . ␣ ⌫'.split(' ');
    } else {
      const base = Array.from(new Set(this.customWords.replace(/\s+/g, '').split('')));
      charList = [...(base.length ? base : ['A', 'B', 'C']), '␣', '⌫'];
    }

    const cols = charList.length > 20 ? 7 : charList.length > 10 ? 5 : 4;
    const rows = Math.ceil(charList.length / cols);
    const cellW = this.paperFrame.w / cols;
    const cellH = this.paperFrame.h / rows;

    this.cells = charList.map((char, index) => {
      const col = index % cols;
      const row = Math.floor(index / cols);
      return {
        char,
        x: this.paperFrame.x + col * cellW,
        y: this.paperFrame.y + row * cellH,
        w: cellW,
        h: cellH,
      };
    });
  }

  /**
   * Two-hand typing update:
   *  - Both hands can type independently whenever two fingers touch (pinch) on either hand!
   *  - Also supports cross-hand trigger: one hand points, the other clicks outside!
   */
  updateDualHands(hands: HandFingerData[], now: number): void {
    if (!this.active) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth;
    const h = window.innerHeight;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.overlayCanvas.width, this.overlayCanvas.height);

    ctx.save();
    ctx.scale(dpr, dpr);

    this.clickPointPulse = (this.clickPointPulse + 0.08) % (Math.PI * 2);

    // 1. Draw Holographic Paper Calibration Frame
    this.renderPaperFrame(ctx, w, h);

    if (hands.length === 0) {
      this.hoveredChar = null;
      this.lastHandsPinching = [false, false];
      this.renderCells(ctx, w, h);
      this.renderParticles(ctx, w, h);
      this.renderBeams(ctx, w, h, now);
      this.renderShockwaves(ctx, w, h, now);
      ctx.restore();
      return;
    }

    // Hit-test for every hand in view
    const handHits: (LetterCell | null)[] = hands.map((h) => this.hitTestCell(h.indexX, h.indexY));

    // Active hovered cell from any hand
    const activeHoverCell = handHits.find((cell) => cell !== null) || null;
    this.hoveredChar = activeHoverCell ? activeHoverCell.char : null;

    if (activeHoverCell) {
      this.renderCellHover(ctx, activeHoverCell, w, h);
      this.options.onStatusChange?.('pointing', activeHoverCell.char);
    }

    // Process each hand: allows both hands to type independently,
    // OR cross-hand triggers when clicking outside!
    for (let i = 0; i < hands.length; i++) {
      const hand = hands[i]!;
      const hit = handHits[i];
      const otherIdx = 1 - i;
      const otherHit = hands.length > 1 ? handHits[otherIdx] : null;

      const clickPxX = hand.pinchX * w;
      const clickPxY = hand.pinchY * h;

      if (hit) {
        // Pointing directly at a letter cell
        this.renderPointerReticle(ctx, hand.indexX * w, hand.indexY * h, i === 0 ? '#00f0ff' : '#a855f7');
      } else {
        // Outside the keyboard: render Click Trigger Reticle
        this.renderClickTriggerReticle(
          ctx,
          clickPxX,
          clickPxY,
          hand.isPinching,
          otherHit || activeHoverCell,
          w,
          h,
        );
      }

      // Rising-edge pinch trigger detection on hand i
      const lastPinching = this.lastHandsPinching[i] ?? false;
      const lastSeized = this.lastHandsSeizedTime[i] ?? 0;
      const isPinchTrigger = hand.isPinching && !lastPinching && now - lastSeized > 220;

      if (isPinchTrigger) {
        if (hit) {
          // Hand i directly clicked a letter!
          this.seizeLetter(hit, hand.pinchX, hand.pinchY, w, h);
          this.lastHandsSeizedTime[i] = now;
          this.shockwaves.push({
            x: clickPxX,
            y: clickPxY,
            startTime: now,
            duration: 350,
            color: '#00f0ff',
          });
          this.options.onStatusChange?.(hit.char === '⌫' ? 'erase' : 'typed', hit.char);
        } else if (otherHit) {
          // Hand i clicked outside while the other hand is pointing at otherHit!
          this.seizeLetter(otherHit, hand.pinchX, hand.pinchY, w, h);
          this.lastHandsSeizedTime[i] = now;

          const targetPxX = (otherHit.x + otherHit.w / 2) * w;
          const targetPxY = (otherHit.y + otherHit.h / 2) * h;

          this.lightningBeams.push({
            fromX: clickPxX,
            fromY: clickPxY,
            toX: targetPxX,
            toY: targetPxY,
            startTime: now,
            duration: 220,
            color: '#00f0ff',
            char: otherHit.char,
          });

          this.shockwaves.push({
            x: clickPxX,
            y: clickPxY,
            startTime: now,
            duration: 350,
            color: '#ffaa00',
          });

          this.options.onStatusChange?.(otherHit.char === '⌫' ? 'erase' : 'typed', otherHit.char);
        } else {
          // Clicked outside with no letter targeted
          this.options.onStatusChange?.('miss', '');
          this.shockwaves.push({
            x: clickPxX,
            y: clickPxY,
            startTime: now,
            duration: 250,
            color: 'rgba(255, 80, 80, 0.8)',
          });
        }
      }

      this.lastHandsPinching[i] = hand.isPinching;
    }

    if (hands.length === 1) {
      this.renderTopGuidance(ctx, w, '👐 يمكنك استخدام كلتا اليدين للكتابة معاً أو النقر خارج الكيبورد');
    }

    // Render cells, particles, beams, shockwaves
    this.renderCells(ctx, w, h);
    this.renderParticles(ctx, w, h);
    this.renderBeams(ctx, w, h, now);
    this.renderShockwaves(ctx, w, h, now);

    ctx.restore();
  }


  /** Backward-compatible single finger wrapper. */
  updateFinger(normX: number, normY: number, isPinchTouch: boolean, now: number): void {
    this.updateDualHands([
      {
        indexX: normX,
        indexY: normY,
        pinchX: normX,
        pinchY: normY,
        isPinching: isPinchTouch,
      },
    ], now);
  }

  private hitTestCell(normX: number, normY: number): LetterCell | null {
    for (const cell of this.cells) {
      if (
        normX >= cell.x &&
        normX <= cell.x + cell.w &&
        normY >= cell.y &&
        normY <= cell.y + cell.h
      ) {
        return cell;
      }
    }
    return null;
  }

  private renderPointerReticle(ctx: CanvasRenderingContext2D, px: number, py: number, color: string): void {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;
    ctx.shadowColor = color;
    ctx.shadowBlur = 14;

    // Crosshair circle
    ctx.beginPath();
    ctx.arc(px, py, 14, 0, Math.PI * 2);
    ctx.stroke();

    // 4 Tick lines
    const tLen = 6;
    ctx.beginPath();
    ctx.moveTo(px - 20, py); ctx.lineTo(px - 20 + tLen, py);
    ctx.moveTo(px + 20, py); ctx.lineTo(px + 20 - tLen, py);
    ctx.moveTo(px, py - 20); ctx.lineTo(px, py - 20 + tLen);
    ctx.moveTo(px, py + 20); ctx.lineTo(px, py + 20 - tLen);
    ctx.stroke();

    // Center laser dot
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(px, py, 3, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  private renderClickTriggerReticle(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    isPinching: boolean,
    targetCell: LetterCell | null,
    w: number,
    h: number,
  ): void {
    ctx.save();
    const pulse = Math.sin(this.clickPointPulse) * 3;
    const baseRadius = 24;
    const radius = isPinching ? 18 : baseRadius + pulse;
    const color = isPinching ? '#ffaa00' : '#00f0ff';

    ctx.strokeStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = isPinching ? 22 : 14;
    ctx.lineWidth = isPinching ? 3.5 : 2;

    // Connecting dashed aim beam from click point to target letter
    if (targetCell) {
      const tx = (targetCell.x + targetCell.w / 2) * w;
      const ty = (targetCell.y + targetCell.h / 2) * h;
      ctx.save();
      ctx.setLineDash([6, 6]);
      ctx.lineDashOffset = -this.clickPointPulse * 8;
      ctx.strokeStyle = isPinching ? 'rgba(255, 170, 0, 0.85)' : 'rgba(0, 240, 255, 0.45)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(tx, ty);
      ctx.stroke();
      ctx.restore();
    }

    // Outer rotating energy ring
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.stroke();

    // Brackets
    ctx.beginPath();
    ctx.arc(cx, cy, radius + 7, this.clickPointPulse, this.clickPointPulse + Math.PI * 0.4);
    ctx.arc(cx, cy, radius + 7, this.clickPointPulse + Math.PI, this.clickPointPulse + Math.PI * 1.4);
    ctx.stroke();

    // Center fill
    ctx.fillStyle = isPinching ? '#ffaa00' : 'rgba(0, 240, 255, 0.25)';
    ctx.beginPath();
    ctx.arc(cx, cy, isPinching ? 10 : 5, 0, Math.PI * 2);
    ctx.fill();

    // Text Label badge
    ctx.shadowBlur = 0;
    ctx.font = '700 12px Cairo, Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = isPinching ? '#ffaa00' : '#ffffff';
    const labelText = isPinching ? '⚡ نقرة مؤكدة!' : '👌 نقطة النقر (انقر بالأصابع)';
    ctx.fillText(labelText, cx, cy - radius - 14);

    ctx.restore();
  }

  private renderTopGuidance(ctx: CanvasRenderingContext2D, w: number, text: string): void {
    ctx.save();
    ctx.font = '600 13px Cairo, Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.fillText(text, w / 2, this.paperFrame.y * (window.innerHeight || 640) - 16);
    ctx.restore();
  }

  private renderBeams(ctx: CanvasRenderingContext2D, _w: number, _h: number, now: number): void {
    this.lightningBeams = this.lightningBeams.filter((b) => now - b.startTime < b.duration);
    for (const b of this.lightningBeams) {
      const age = now - b.startTime;
      const progress = age / b.duration;
      const alpha = 1 - progress;

      ctx.save();
      ctx.strokeStyle = `rgba(0, 240, 255, ${alpha})`;
      ctx.shadowColor = '#00f0ff';
      ctx.shadowBlur = 20;
      ctx.lineWidth = 3.5 * alpha + 1;

      // Draw multi-segment lightning bolt
      const segments = 6;
      ctx.beginPath();
      ctx.moveTo(b.fromX, b.fromY);
      for (let i = 1; i < segments; i++) {
        const segT = i / segments;
        const midX = b.fromX + (b.toX - b.fromX) * segT;
        const midY = b.fromY + (b.toY - b.fromY) * segT;
        const dist = Math.hypot(b.toX - b.fromX, b.toY - b.fromY) || 1;
        const perpX = -(b.toY - b.fromY) / dist;
        const perpY = (b.toX - b.fromX) / dist;
        const jitter = Math.sin(i * 12.5 + now * 0.05) * 16 * (1 - segT);
        ctx.lineTo(midX + perpX * jitter, midY + perpY * jitter);
      }
      ctx.lineTo(b.toX, b.toY);
      ctx.stroke();

      // White hot core
      ctx.strokeStyle = `rgba(255, 255, 255, ${alpha})`;
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Impact burst at target
      ctx.fillStyle = `rgba(0, 240, 255, ${alpha * 0.6})`;
      ctx.beginPath();
      ctx.arc(b.toX, b.toY, 22 * (1 - progress * 0.5), 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();
    }
  }

  private renderShockwaves(ctx: CanvasRenderingContext2D, _w: number, _h: number, now: number): void {
    this.shockwaves = this.shockwaves.filter((s) => now - s.startTime < s.duration);
    for (const s of this.shockwaves) {
      const age = now - s.startTime;
      const progress = age / s.duration;
      const alpha = 1 - progress;
      const r = 10 + progress * 40;

      ctx.save();
      ctx.strokeStyle = `rgba(255, 170, 0, ${alpha})`;
      ctx.lineWidth = 2.5 * alpha;
      ctx.shadowColor = '#ffaa00';
      ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  private seizeLetter(cell: LetterCell, _hitX: number, _hitY: number, w: number, h: number): void {
    if (cell.char === '⌫') {
      this.backspace();
      return;
    }
    if (cell.char === '␣') {
      this.typedText += ' ';
    } else {
      this.typedText += cell.char;
    }
    this.textInput.value = this.typedText;
    this.options.onTextUpdated?.(this.typedText);

    haptic([25, 40]);
    this.playSynthBlip();

    // Spawn flying particle
    const startX = (cell.x + cell.w / 2) * w;
    const startY = (cell.y + cell.h / 2) * h;
    const targetRect = this.textInput.getBoundingClientRect();
    const targetX = targetRect.left + targetRect.width / 2;
    const targetY = targetRect.top + targetRect.height / 2;

    this.particles.push({
      x: startX,
      y: startY,
      targetX,
      targetY,
      progress: 0,
      char: cell.char === '␣' ? '␣' : cell.char,
      color: '#00f0ff',
    });
  }

  private renderPaperFrame(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const px = this.paperFrame.x * w;
    const py = this.paperFrame.y * h;
    const pw = this.paperFrame.w * w;
    const ph = this.paperFrame.h * h;

    // Glowing boundary
    ctx.strokeStyle = 'rgba(0, 240, 255, 0.65)';
    ctx.lineWidth = 2;
    ctx.shadowColor = '#00f0ff';
    ctx.shadowBlur = 12;
    ctx.strokeRect(px, py, pw, ph);

    // Dark glass backing for high contrast
    ctx.fillStyle = 'rgba(10, 18, 30, 0.45)';
    ctx.fillRect(px, py, pw, ph);

    // Corner targeting brackets
    const cLen = 22;
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = '#00f0ff';
    // Top-Left
    ctx.beginPath();
    ctx.moveTo(px, py + cLen);
    ctx.lineTo(px, py);
    ctx.lineTo(px + cLen, py);
    ctx.stroke();
    // Top-Right
    ctx.beginPath();
    ctx.moveTo(px + pw - cLen, py);
    ctx.lineTo(px + pw, py);
    ctx.lineTo(px + pw, py + cLen);
    ctx.stroke();
    // Bottom-Left
    ctx.beginPath();
    ctx.moveTo(px, py + ph - cLen);
    ctx.lineTo(px, py + ph);
    ctx.lineTo(px + cLen, py + ph);
    ctx.stroke();
    // Bottom-Right
    ctx.beginPath();
    ctx.moveTo(px + pw - cLen, py + ph);
    ctx.lineTo(px + pw, py + ph);
    ctx.lineTo(px + pw, py + ph - cLen);
    ctx.stroke();

    // Header Badge
    ctx.shadowBlur = 0;
    ctx.font = '700 12.5px Cairo, Inter, system-ui, sans-serif';
    ctx.fillStyle = '#00f0ff';
    ctx.textAlign = 'left';
    ctx.fillText('👐 لوحة الورقة: يد تشير بالسبابة ☝️ + يد تنقر بالقرصة 👌 خارج الكيبورد للكتابة', px + 10, py - 10);
  }

  private renderCells(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    ctx.shadowBlur = 0;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (const cell of this.cells) {
      const cx = (cell.x + cell.w / 2) * w;
      const cy = (cell.y + cell.h / 2) * h;
      const isHovered = this.hoveredChar === cell.char;

      if (cell.char === '⌫') {
        // Special render for Backspace / Effacer
        ctx.strokeStyle = isHovered ? '#ff0055' : 'rgba(255, 51, 102, 0.45)';
        ctx.fillStyle = isHovered ? 'rgba(255, 0, 85, 0.35)' : 'rgba(255, 51, 102, 0.12)';
        ctx.fillRect(cell.x * w + 2, cell.y * h + 2, cell.w * w - 4, cell.h * h - 4);
        ctx.strokeRect(cell.x * w + 2, cell.y * h + 2, cell.w * w - 4, cell.h * h - 4);
        ctx.font = '700 15px Cairo, Inter, sans-serif';
        ctx.fillStyle = isHovered ? '#ffffff' : '#ff6699';
        if (isHovered) {
          ctx.shadowColor = '#ff0055';
          ctx.shadowBlur = 16;
        }
        ctx.fillText('⌫ مسح', cx, cy);
        ctx.shadowBlur = 0;
        continue;
      }

      if (cell.char === '␣') {
        // Special render for Space / Espace
        ctx.strokeStyle = isHovered ? '#00f0ff' : 'rgba(0, 240, 255, 0.3)';
        ctx.fillStyle = isHovered ? 'rgba(0, 240, 255, 0.25)' : 'rgba(0, 240, 255, 0.08)';
        ctx.fillRect(cell.x * w + 2, cell.y * h + 2, cell.w * w - 4, cell.h * h - 4);
        ctx.strokeRect(cell.x * w + 2, cell.y * h + 2, cell.w * w - 4, cell.h * h - 4);
        ctx.font = '700 14px Cairo, Inter, sans-serif';
        ctx.fillStyle = isHovered ? '#ffffff' : '#99f6ff';
        ctx.fillText('␣ مسافة', cx, cy);
        continue;
      }

      // Cell border
      ctx.strokeStyle = isHovered ? '#ffaa00' : 'rgba(255, 255, 255, 0.15)';
      ctx.lineWidth = 1;
      ctx.strokeRect(cell.x * w + 2, cell.y * h + 2, cell.w * w - 4, cell.h * h - 4);

      // Character glyph
      ctx.font = isHovered ? '700 24px Cairo, Inter, sans-serif' : '600 20px Cairo, Inter, sans-serif';
      ctx.fillStyle = isHovered ? '#ffffff' : '#e2e8f0';
      if (isHovered) {
        ctx.shadowColor = '#00f0ff';
        ctx.shadowBlur = 14;
      }
      ctx.fillText(cell.char, cx, cy);
      ctx.shadowBlur = 0;
    }
  }

  private renderCellHover(
    ctx: CanvasRenderingContext2D,
    cell: LetterCell,
    w: number,
    h: number,
  ): void {
    const cx = (cell.x + cell.w / 2) * w;
    const cw = cell.w * w;
    const ch = cell.h * h;

    ctx.save();
    // High intensity neon cell background
    ctx.fillStyle = 'rgba(0, 240, 255, 0.35)';
    ctx.shadowColor = '#00f0ff';
    ctx.shadowBlur = 24;
    ctx.fillRect(cell.x * w + 3, cell.y * h + 3, cw - 6, ch - 6);

    // Glowing border
    ctx.strokeStyle = '#00f0ff';
    ctx.lineWidth = 2.5;
    ctx.strokeRect(cell.x * w + 3, cell.y * h + 3, cw - 6, ch - 6);

    // Target badge right above the cell: [ A ] 🎯
    ctx.font = '700 13px Cairo, Inter, sans-serif';
    ctx.fillStyle = '#00f0ff';
    ctx.textAlign = 'center';
    ctx.fillText(`[ ${cell.char} ] 🎯`, cx, cell.y * h - 8);

    ctx.restore();
  }

  private renderParticles(ctx: CanvasRenderingContext2D, _w: number, _h: number): void {
    this.particles = this.particles.filter((p) => p.progress < 1);
    for (const p of this.particles) {
      p.progress += 0.055;
      const curX = p.x + (p.targetX - p.x) * p.progress;
      const curY = p.y + (p.targetY - p.y) * p.progress;
      const alpha = 1 - p.progress;

      ctx.save();
      ctx.fillStyle = `rgba(0, 240, 255, ${alpha})`;
      ctx.shadowColor = '#00f0ff';
      ctx.shadowBlur = 18;
      ctx.beginPath();
      ctx.arc(curX, curY, 8 * (1 - p.progress * 0.4), 0, Math.PI * 2);
      ctx.fill();

      ctx.font = '700 16px Inter, sans-serif';
      ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
      ctx.fillText(p.char, curX, curY - 14);
      ctx.restore();
    }
  }

  private backspace(): void {
    this.typedText = this.typedText.slice(0, -1);
    this.textInput.value = this.typedText;
    this.options.onTextUpdated?.(this.typedText);
  }

  private clearText(): void {
    this.typedText = '';
    this.textInput.value = '';
    this.options.onTextUpdated?.('');
  }

  private speakText(): void {
    if (!this.typedText.trim() || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(this.typedText);
    utterance.lang = this.currentAlphabet === 'arabic' ? 'ar-SA' : 'fr-FR';
    window.speechSynthesis.speak(utterance);
  }

  private async copyText(): Promise<void> {
    if (!this.typedText) return;
    try {
      await navigator.clipboard.writeText(this.typedText);
      const prev = this.textInput.value;
      this.textInput.value = '📋 تم النسخ إلى الحافظة!';
      setTimeout(() => {
        this.textInput.value = prev;
      }, 1400);
    } catch {
      // ignore clipboard permission error
    }
  }

  private spawn3D(): void {
    if (!this.typedText.trim()) return;
    this.options.onSpawn3DText?.(this.typedText);
  }

  private playSynthBlip(): void {
    try {
      if (!this.audioCtx) {
        const AudioCtor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        this.audioCtx = new AudioCtor();
      }
      if (this.audioCtx.state === 'suspended') void this.audioCtx.resume();
      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(540, this.audioCtx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(1080, this.audioCtx.currentTime + 0.08);
      gain.gain.setValueAtTime(0.2, this.audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.audioCtx.currentTime + 0.12);
      osc.connect(gain);
      gain.connect(this.audioCtx.destination);
      osc.start();
      osc.stop(this.audioCtx.currentTime + 0.12);
    } catch {
      // AudioContext unavailable or blocked
    }
  }

  dispose(): void {
    this.overlayCanvas.remove();
    this.textHudElement.remove();
    if (this.audioCtx) void this.audioCtx.close();
  }
}
