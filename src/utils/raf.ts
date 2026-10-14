/**
 * A single, shared requestAnimationFrame loop for the whole application.
 *
 * Rules enforced here:
 *  - exactly one RAF loop, no matter how many systems subscribe;
 *  - callbacks are ordered by priority then insertion;
 *  - the loop pauses when the tab is hidden (battery) and resumes on return;
 *  - frame deltas are clamped so a background tab cannot explode the physics.
 */
export type Tick = (dt: number, elapsed: number, now: number) => void;

interface Entry {
  tick: Tick;
  priority: number;
  order: number;
}

export class Ticker {
  private readonly entries = new Map<Tick, Entry>();
  private handle = 0;
  private running = false;
  private last = 0;
  private startTime = 0;
  private order = 0;
  private hiddenBound = false;

  /** Rolling FPS estimate. */
  private frames = 0;
  private fpsAccumulator = 0;
  private fps = 60;

  constructor(private readonly maxDelta = 0.05) {}

  /** Registers a per-frame callback. Returns an unsubscribe function. */
  add(tick: Tick, priority = 0): () => void {
    this.entries.set(tick, { tick, priority, order: this.order++ });
    if (!this.hiddenBound) {
      document.addEventListener('visibilitychange', this.onVisibility);
      this.hiddenBound = true;
    }
    this.start();
    return () => {
      this.entries.delete(tick);
      if (this.entries.size === 0) this.stop();
    };
  }

  /** Starts the loop if it is not already running. */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.startTime = this.last;
    this.handle = requestAnimationFrame(this.frame);
  }

  /** Stops the loop. Subscribers are kept and resumed by `start()`. */
  stop(): void {
    if (!this.running) return;
    this.running = false;
    cancelAnimationFrame(this.handle);
    this.handle = 0;
  }

  /** Smoothed frames per second. */
  getFps(): number {
    return this.fps;
  }

  /** Total elapsed seconds since the loop started. */
  getElapsed(): number {
    return (performance.now() - this.startTime) / 1000;
  }

  dispose(): void {
    this.stop();
    this.entries.clear();
    if (this.hiddenBound) document.removeEventListener('visibilitychange', this.onVisibility);
    this.hiddenBound = false;
  }

  private readonly onVisibility = (): void => {
    if (document.hidden) this.stop();
    else this.start();
  };

  private readonly frame = (now: number): void => {
    if (!this.running) return;
    const rawDelta = (now - this.last) / 1000;
    this.last = now;
    const dt = Math.min(Math.max(rawDelta, 0), this.maxDelta);
    const elapsed = (now - this.startTime) / 1000;

    // FPS estimate, refreshed ~4x/second.
    this.frames += 1;
    this.fpsAccumulator += rawDelta;
    if (this.fpsAccumulator >= 0.25) {
      this.fps = this.frames / this.fpsAccumulator;
      this.frames = 0;
      this.fpsAccumulator = 0;
    }

    const list = [...this.entries.values()].sort(
      (a, b) => a.priority - b.priority || a.order - b.order,
    );
    for (const entry of list) {
      try {
        entry.tick(dt, elapsed, now);
      } catch (err) {
        console.error('[ticker] frame callback failed', err);
      }
    }

    this.handle = requestAnimationFrame(this.frame);
  };
}

/** Application-wide ticker instance. */
export const ticker = new Ticker();
