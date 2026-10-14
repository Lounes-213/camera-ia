/**
 * InputController — turns raw pointer/touch/keyboard events into intents.
 *
 * It knows nothing about Three.js: the host injects a handler object (see
 * `InputHandlers`), which is how the UI layer keeps its "no direct 3D access"
 * rule while still feeling immediate.
 *
 * Gestures
 *  - desktop: drag = rotate, wheel = scale
 *  - mobile : 1 finger = rotate, pinch = scale, 2-finger drag = height,
 *             double tap = reset
 */
import { haptic } from '../../utils/device';

export interface InputHandlers {
  rotate(dx: number, dy: number): void;
  scale(factor: number): void;
  height(delta: number): void;
  reset(): void;
  snapshot(): void;
  toggleTheme(): void;
  cycleLanguage(): void;
  toggleAutoRotate(): void;
  selectObject(index: number): void;
  toggleHands(): void;
  openSearch(): void;
  openRoom(): void;
  toggleFullscreen(): void;
  toggleDebug(): void;
  openHelp(): void;
  escape(): void;
}

interface Point {
  x: number;
  y: number;
}

const ROTATE_SENSITIVITY = 0.0065;
const DOUBLE_TAP_MS = 320;
const TAP_SLOP = 14;

export class InputController {
  private readonly active = new Map<number, Point>();
  private lastSingle: Point | null = null;
  private pinchDistance = 0;
  private pinchMidY = 0;
  private moved = 0;
  private lastTapAt = 0;
  private disposed = false;

  constructor(
    private readonly target: HTMLElement,
    private readonly handlers: InputHandlers,
  ) {
    target.addEventListener('pointerdown', this.onPointerDown);
    target.addEventListener('pointermove', this.onPointerMove, { passive: false });
    target.addEventListener('pointerup', this.onPointerUp);
    target.addEventListener('pointercancel', this.onPointerUp);
    target.addEventListener('wheel', this.onWheel, { passive: false });
    target.addEventListener('dblclick', this.onDoubleClick);
    target.addEventListener('contextmenu', this.onContextMenu);
    window.addEventListener('keydown', this.onKeyDown);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const t = this.target;
    t.removeEventListener('pointerdown', this.onPointerDown);
    t.removeEventListener('pointermove', this.onPointerMove);
    t.removeEventListener('pointerup', this.onPointerUp);
    t.removeEventListener('pointercancel', this.onPointerUp);
    t.removeEventListener('wheel', this.onWheel);
    t.removeEventListener('dblclick', this.onDoubleClick);
    t.removeEventListener('contextmenu', this.onContextMenu);
    window.removeEventListener('keydown', this.onKeyDown);
  }

  // ---- Pointer / touch -----------------------------------------------------

  private readonly onPointerDown = (event: PointerEvent): void => {
    this.target.setPointerCapture?.(event.pointerId);
    this.active.set(event.pointerId, { x: event.clientX, y: event.clientY });
    this.moved = 0;

    if (this.active.size === 2) {
      const [a, b] = [...this.active.values()] as [Point, Point];
      this.pinchDistance = Math.hypot(a.x - b.x, a.y - b.y);
      this.pinchMidY = (a.y + b.y) / 2;
      haptic(8);
    }
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    const previous = this.active.get(event.pointerId);
    if (!previous) return;
    const current = { x: event.clientX, y: event.clientY };

    if (this.active.size >= 2) {
      event.preventDefault();
      this.active.set(event.pointerId, current);
      const [a, b] = [...this.active.values()] as [Point, Point];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      const midY = (a.y + b.y) / 2;

      if (this.pinchDistance > 0 && distance > 0) {
        this.handlers.scale(distance / this.pinchDistance);
      }
      // Vertical two-finger drag lifts the object above the marker.
      const deltaY = (this.pinchMidY - midY) / Math.max(1, this.target.clientHeight);
      if (Math.abs(deltaY) > 0.0004) this.handlers.height(deltaY * 1.6);

      this.pinchDistance = distance;
      this.pinchMidY = midY;
      this.moved += 10;
      return;
    }

    const dx = current.x - previous.x;
    const dy = current.y - previous.y;
    this.active.set(event.pointerId, current);
    this.moved += Math.abs(dx) + Math.abs(dy);

    if (this.moved > 2) {
      event.preventDefault();
      this.handlers.rotate(dx * ROTATE_SENSITIVITY, dy * ROTATE_SENSITIVITY);
    }
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    const wasSingle = this.active.size === 1;
    const point = this.active.get(event.pointerId) ?? this.lastSingle;
    this.active.delete(event.pointerId);
    this.target.releasePointerCapture?.(event.pointerId);

    if (this.active.size < 2) this.pinchDistance = 0;

    // Double tap on touch = reset.
    if (!wasSingle || !point) return;
    const isTouchPointer = event.pointerType === 'touch';
    if (!isTouchPointer || this.moved > TAP_SLOP) return;
    const now = performance.now();
    if (now - this.lastTapAt < DOUBLE_TAP_MS) {
      this.lastTapAt = 0;
      haptic([12, 40, 12]);
      this.handlers.reset();
    } else {
      this.lastTapAt = now;
    }
  };

  private readonly onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    // Natural, multiplicative zoom: one notch ≈ 11%.
    this.handlers.scale(Math.exp(-event.deltaY * 0.0012));
  };

  private readonly onDoubleClick = (event: MouseEvent): void => {
    event.preventDefault();
    this.handlers.reset();
  };

  private readonly onContextMenu = (event: MouseEvent): void => {
    // Keep the stage clean; the UI provides its own menus.
    event.preventDefault();
  };

  // ---- Keyboard ------------------------------------------------------------

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (isTypingTarget(event.target)) return;
    const { key, code } = event;
    const lower = key.toLowerCase();

    if (code === 'Digit1') return this.selectByIndex(0, event);
    if (code === 'Digit2') return this.selectByIndex(1, event);
    if (code === 'Digit3') return this.selectByIndex(2, event);
    if (code === 'Digit4') return this.selectByIndex(3, event);
    if (code === 'Digit5') return this.selectByIndex(4, event);
    if (code === 'Digit6') return this.selectByIndex(5, event);
    if (code === 'Digit7') return this.selectByIndex(6, event);

    switch (lower) {
      case 'r':
        event.preventDefault();
        this.handlers.reset();
        break;
      case 's':
        event.preventDefault();
        this.handlers.snapshot();
        break;
      case 't':
        event.preventDefault();
        this.handlers.toggleTheme();
        break;
      case 'l':
        event.preventDefault();
        this.handlers.cycleLanguage();
        break;
      case ' ':
        event.preventDefault();
        this.handlers.toggleAutoRotate();
        break;
      case 'h':
        event.preventDefault();
        this.handlers.toggleHands();
        break;
      case 'f':
        event.preventDefault();
        this.handlers.openSearch();
        break;
      case 'm':
        event.preventDefault();
        this.handlers.openRoom();
        break;
      case 'v':
        event.preventDefault();
        this.handlers.toggleFullscreen();
        break;
      case 'd':
        event.preventDefault();
        this.handlers.toggleDebug();
        break;
      case '?':
      case '/':
        event.preventDefault();
        this.handlers.openHelp();
        break;
      case 'escape':
        this.handlers.escape();
        break;
      default:
        break;
    }
  };

  private selectByIndex(index: number, event: KeyboardEvent): void {
    event.preventDefault();
    this.handlers.selectObject(index);
  }
}

/** True when the event originates from a text field (shortcuts must not fire). */
function isTypingTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element) return false;
  const tag = element.tagName?.toLowerCase();
  return (
    tag === 'input' ||
    tag === 'textarea' ||
    tag === 'select' ||
    element.isContentEditable === true
  );
}
