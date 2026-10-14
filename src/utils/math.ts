/**
 * Small, pure math helpers plus jitter-removing filters shared by the AR,
 * hand-tracking and networking layers. All functions are side-effect free and
 * unit-tested.
 */

export const clamp = (value: number, min: number, max: number): number =>
  value < min ? min : value > max ? max : value;

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export const inverseLerp = (a: number, b: number, v: number): number =>
  a === b ? 0 : clamp((v - a) / (b - a), 0, 1);

export const smoothstep = (t: number): number => {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
};

/** Frame-rate independent exponential smoothing. */
export const damp = (current: number, target: number, lambda: number, dt: number): number =>
  lerp(current, target, 1 - Math.exp(-lambda * dt));

export const average = (values: readonly number[]): number =>
  values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;

export const distance2 = (ax: number, ay: number, bx: number, by: number): number =>
  Math.hypot(ax - bx, ay - by);

/** Normalises an angle to (-π, π]. */
export function normalizeAngle(angle: number): number {
  let a = angle;
  while (a > Math.PI) a -= Math.PI * 2;
  while (a <= -Math.PI) a += Math.PI * 2;
  return a;
}

/**
 * One-Euro filter: low-latency, low-jitter smoothing of a noisy scalar signal.
 * Used both for hand landmarks and (in spirit) matches MindAR's pose filter.
 */
export class OneEuroFilter {
  private hatXPrev: number | null = null;
  private dxHatPrev = 0;
  private tPrev: number | null = null;

  constructor(
    /** Minimum cutoff frequency (Hz). Lower = smoother, laggier. */
    public minCutOff = 1.0,
    /** Speed coefficient. Higher = more responsive to fast motion. */
    public beta = 0.02,
    /** Cutoff for the derivative estimate. */
    public dCutOff = 1.0,
  ) {}

  /** Resets the filter history (call when the tracked subject is lost). */
  reset(): void {
    this.hatXPrev = null;
    this.dxHatPrev = 0;
    this.tPrev = null;
  }

  private alpha(cutoff: number, dt: number): number {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }

  /** Filters one sample taken at `timestampMs`. */
  filter(x: number, timestampMs: number): number {
    if (this.tPrev === null || this.hatXPrev === null) {
      this.tPrev = timestampMs;
      this.hatXPrev = x;
      return x;
    }
    const dt = (timestampMs - this.tPrev) / 1000;
    if (dt <= 0) return this.hatXPrev;

    const dx = (x - this.hatXPrev) / dt;
    const aD = this.alpha(this.dCutOff, dt);
    const dxHat = aD * dx + (1 - aD) * this.dxHatPrev;

    const cutoff = this.minCutOff + this.beta * Math.abs(dxHat);
    const a = this.alpha(cutoff, dt);
    const hatX = a * x + (1 - a) * this.hatXPrev;

    this.tPrev = timestampMs;
    this.hatXPrev = hatX;
    this.dxHatPrev = dxHat;
    return hatX;
  }
}

/** Wraps three independent One-Euro filters for a 3D point. */
export class OneEuroVec3 {
  private readonly fx: OneEuroFilter;
  private readonly fy: OneEuroFilter;
  private readonly fz: OneEuroFilter;

  constructor(minCutOff = 1, beta = 0.02) {
    this.fx = new OneEuroFilter(minCutOff, beta);
    this.fy = new OneEuroFilter(minCutOff, beta);
    this.fz = new OneEuroFilter(minCutOff, beta);
  }

  reset(): void {
    this.fx.reset();
    this.fy.reset();
    this.fz.reset();
  }

  filter(x: number, y: number, z: number, t: number): [number, number, number] {
    return [this.fx.filter(x, t), this.fy.filter(y, t), this.fz.filter(z, t)];
  }
}

/**
 * Normalises a value into a 0..1 range using a running min/max (numerically
 * stable exponential moving bounds).
 */
export function normalize(value: number, min: number, max: number): number {
  return max <= min ? 0 : clamp((value - min) / (max - min), 0, 1);
}

/** Shortest-path lerp between two angles (radians). */
export function lerpAngle(a: number, b: number, t: number): number {
  return a + normalizeAngle(b - a) * t;
}
