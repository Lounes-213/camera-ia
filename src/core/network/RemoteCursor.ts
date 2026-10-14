/**
 * RemoteCursorLayer — renders where everyone else is pointing.
 *
 * Positions arrive as normalised screen coordinates at ~18 Hz, so each cursor is
 * interpolated towards its target every frame and fades out if the peer goes
 * quiet. Keeping this in the DOM (instead of the WebGL scene) means it works
 * identically in marker mode and hands mode and costs nothing.
 */

interface CursorEntry {
  element: HTMLDivElement;
  label: HTMLSpanElement;
  current: { x: number; y: number };
  target: { x: number; y: number };
  lastSeen: number;
  active: boolean;
}

const STALE_MS = 4000;
const FADE_AFTER_MS = 2500;

export class RemoteCursorLayer {
  private readonly container: HTMLDivElement;
  private readonly cursors = new Map<string, CursorEntry>();

  constructor() {
    this.container = document.createElement('div');
    this.container.className = 'remote-cursors';
    this.container.setAttribute('aria-hidden', 'true');
    document.body.appendChild(this.container);
  }

  /** Records a new position for a peer (normalised 0..1 screen coordinates). */
  update(
    id: string,
    name: string,
    x: number,
    y: number,
    active: boolean,
    nowMs: number,
  ): void {
    let entry = this.cursors.get(id);
    if (!entry) {
      const element = document.createElement('div');
      element.className = 'remote-cursor';

      const dot = document.createElement('span');
      dot.className = 'remote-cursor__dot';
      const label = document.createElement('span');
      label.className = 'remote-cursor__label';
      label.textContent = name;

      element.append(dot, label);
      this.container.appendChild(element);
      entry = { element, label, current: { x, y }, target: { x, y }, lastSeen: nowMs, active };
      this.cursors.set(id, entry);
    }

    entry.label.textContent = name;
    entry.target = { x, y };
    entry.lastSeen = nowMs;
    entry.active = active;
    entry.element.classList.toggle('is-idle', !active);
  }

  /** Interpolates cursors and hides the stale ones. */
  tick(dt: number, nowMs: number): void {
    const alpha = Math.min(1, dt * 12);
    for (const [id, entry] of this.cursors) {
      const age = nowMs - entry.lastSeen;

      if (age > STALE_MS) {
        entry.element.remove();
        this.cursors.delete(id);
        continue;
      }

      entry.current.x += (entry.target.x - entry.current.x) * alpha;
      entry.current.y += (entry.target.y - entry.current.y) * alpha;

      // The camera preview is mirrored, so remote pointers are too.
      entry.element.style.transform =
        `translate3d(${(1 - entry.current.x) * 100}vw, ${entry.current.y * 100}vh, 0) translate(-50%, -50%)`;
      entry.element.style.opacity = age > FADE_AFTER_MS ? '0.35' : '1';
    }
  }

  /** Removes one peer's cursor. */
  remove(id: string): void {
    const entry = this.cursors.get(id);
    if (!entry) return;
    entry.element.remove();
    this.cursors.delete(id);
  }

  /** Number of visible cursors. */
  get size(): number {
    return this.cursors.size;
  }

  clear(): void {
    for (const entry of this.cursors.values()) entry.element.remove();
    this.cursors.clear();
  }

  dispose(): void {
    this.clear();
    this.container.remove();
  }
}
