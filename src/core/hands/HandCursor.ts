/**
 * HandCursor — Spatial laser pointer & gesture interaction engine.
 *
 * Supports:
 *  1. One-hand laser cursor following index fingertip apex.
 *  2. Cross-hand click: Hand A points cursor, Hand B pinches to click!
 *  3. Single-hand pinch click & hover dwell click.
 *  4. Two-finger spatial scroll: pinch/two fingers drag to scroll containers & pages.
 */
import { haptic } from '../../utils/device';

const INTERACTIVE_SELECTOR =
  'button, a, input, select, textarea, [role="button"], [role="tab"], [role="link"], [data-hand-clickable], video, iframe, [tabindex]';

export class HandCursor {
  private readonly element: HTMLDivElement;
  private readonly ring: HTMLDivElement;
  private readonly dot: HTMLDivElement;
  private hovered: Element | null = null;
  private visible = false;
  private lastClickAt = 0;
  private currentPx = 0;
  private currentPy = 0;

  constructor() {
    this.element = document.createElement('div');
    this.element.className = 'hand-cursor';
    this.element.setAttribute('aria-hidden', 'true');

    this.ring = document.createElement('div');
    this.ring.className = 'hand-cursor__ring';
    this.dot = document.createElement('div');
    this.dot.className = 'hand-cursor__dot';

    this.element.append(this.ring, this.dot);
    document.body.appendChild(this.element);
  }

  /**
   * Positions the cursor for one frame.
   * @param x Normalised screen x (0..1).
   * @param y Normalised screen y (0..1).
   * @param progress Hold progress 0..1 shown as the ring sweep.
   * @param click True on the frame the hold completes.
   * @param active True if cursor should be displayed.
   */
  update(x: number, y: number, progress: number, click: boolean, active: boolean): void {
    this.setVisible(active);
    if (!active) return;

    this.currentPx = x * window.innerWidth;
    this.currentPy = y * window.innerHeight;
    this.element.style.transform = `translate3d(${this.currentPx}px, ${this.currentPy}px, 0) translate(-50%, -50%)`;
    this.ring.style.setProperty('--progress', String(Math.max(0, Math.min(1, progress))));

    const target = this.hitTest(this.currentPx, this.currentPy);
    if (target !== this.hovered) {
      this.hovered?.classList.remove('hand-hover');
      this.hovered = target;
      this.hovered?.classList.add('hand-hover');
    }

    // Only show ring when close to / hovering an interactive target!
    const isHoveringTarget = this.hovered !== null;
    this.element.classList.toggle('is-hovering-target', isHoveringTarget);
    if (isHoveringTarget) {
      this.ring.style.opacity = '1';
      this.ring.style.setProperty('--progress', String(Math.max(0, Math.min(1, progress))));
    } else {
      this.ring.style.opacity = '0';
      this.ring.style.setProperty('--progress', '0');
    }

    if (click && isHoveringTarget) this.trigger(this.currentPx, this.currentPy, false);
  }

  isHoveringTarget(): boolean {
    return this.hovered !== null;
  }

  getHoveredElement(): Element | null {
    return this.hovered;
  }

  getCurrentPosition(): { px: number; py: number } {
    return { px: this.currentPx, py: this.currentPy };
  }

  /** Hides the cursor and clears hover state. */
  hide(): void {
    this.setVisible(false);
  }

  dispose(): void {
    this.hovered?.classList.remove('hand-hover');
    this.element.remove();
  }

  private setVisible(visible: boolean): void {
    if (visible === this.visible) return;
    this.visible = visible;
    this.element.classList.toggle('is-visible', visible);
    if (!visible) {
      this.hovered?.classList.remove('hand-hover');
      this.hovered = null;
    }
  }

  /** Finds the closest interactive ancestor under the cursor. */
  hitTest(px: number, py: number): Element | null {
    const elements = document.elementsFromPoint(px, py);
    for (const element of elements) {
      if (element === this.element) continue;
      if (element.closest('.hand-cursor')) continue;
      const interactive = element.closest(INTERACTIVE_SELECTOR);
      if (interactive) return interactive;
    }
    return null;
  }

  /**
   * Dispatches a real click so buttons, links, inputs, and AR controls trigger.
   * @param px Screen X in pixels (optional, defaults to current cursor position)
   * @param py Screen Y in pixels (optional)
   * @param force If true, bypasses the long cooldown (for deliberate cross-hand pinch clicks)
   */
  trigger(px?: number, py?: number, force = false): boolean {
    const targetPx = px ?? this.currentPx;
    const targetPy = py ?? this.currentPy;

    const now = performance.now();
    const cooldown = force ? 240 : 600;
    if (now - this.lastClickAt < cooldown) return false;
    this.lastClickAt = now;

    // First try interactive target under cursor
    let target = this.hitTest(targetPx, targetPy);

    // If nothing interactive was found, try the direct top-most non-cursor element
    if (!target) {
      const topElements = document.elementsFromPoint(targetPx, targetPy);
      for (const el of topElements) {
        if (el === this.element || el.closest('.hand-cursor')) continue;
        target = el;
        break;
      }
    }

    if (!target) return false;

    haptic([15, 40, 15]);
    this.element.classList.add('is-clicking');
    setTimeout(() => this.element.classList.remove('is-clicking'), 240);

    const rect = target.getBoundingClientRect();
    const clickX = rect.left + rect.width / 2;
    const clickY = rect.top + rect.height / 2;

    const init: MouseEventInit = {
      bubbles: true,
      cancelable: true,
      clientX: clickX,
      clientY: clickY,
      view: window,
    };

    target.dispatchEvent(new PointerEvent('pointerdown', { ...init, pointerType: 'touch' }));
    target.dispatchEvent(new MouseEvent('mousedown', init));
    target.dispatchEvent(new MouseEvent('mouseup', init));
    target.dispatchEvent(new MouseEvent('click', init));

    // If target is an HTMLInputElement, focus it!
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
      target.focus();
    }

    return true;
  }

  /**
   * Spatial 2-finger scroll gesture ("w ki ndir zuj asabi3 w nscroli scroli ll jiha hadik").
   * Smoothly scrolls the element under the cursor or the window.
   */
  scroll(px: number, py: number, deltaPxX: number, deltaPxY: number): void {
    const scrollTarget = this.findScrollableElement(px, py);

    this.element.classList.add('is-scrolling');
    setTimeout(() => this.element.classList.remove('is-scrolling'), 150);

    if (scrollTarget) {
      scrollTarget.scrollBy({
        left: deltaPxX,
        top: deltaPxY,
        behavior: 'auto',
      });
    } else {
      window.scrollBy({
        left: deltaPxX,
        top: deltaPxY,
        behavior: 'auto',
      });
    }
  }

  private findScrollableElement(px: number, py: number): HTMLElement | null {
    const elements = document.elementsFromPoint(px, py);
    for (const el of elements) {
      if (el === this.element || el.closest('.hand-cursor')) continue;
      let curr: HTMLElement | null = el as HTMLElement;
      while (curr && curr !== document.body && curr !== document.documentElement) {
        const style = window.getComputedStyle(curr);
        const canScrollY =
          (style.overflowY === 'auto' || style.overflowY === 'scroll') &&
          curr.scrollHeight > curr.clientHeight;
        const canScrollX =
          (style.overflowX === 'auto' || style.overflowX === 'scroll') &&
          curr.scrollWidth > curr.clientWidth;
        if (canScrollY || canScrollX) return curr;
        curr = curr.parentElement;
      }
    }
    // Check preset rows or document
    const presets = document.querySelector('.ar-youtube-player__presets') as HTMLElement | null;
    if (presets) {
      const rect = presets.getBoundingClientRect();
      if (px >= rect.left && px <= rect.right && py >= rect.top && py <= rect.bottom) {
        return presets;
      }
    }
    return (document.scrollingElement as HTMLElement) || document.documentElement;
  }
}
