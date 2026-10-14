/**
 * GestureRecognizer tests.
 *
 * MediaPipe's 21 landmarks are simulated with a parametric synthetic hand so the
 * geometry and the temporal behaviour (pinch hysteresis, hold-to-click,
 * fist-to-reset) can be verified without a camera.
 *
 * Landmark indices: 0 wrist · 1-4 thumb · 5-8 index · 9-12 middle ·
 * 13-16 ring · 17-20 pinky.
 */
import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/app/config';
import {
  GestureRecognizer,
  handSize,
  isFist,
  isOpenPalm,
  isPointing,
  palmCenter,
  palmNormal,
  palmOrientation,
  pinchRatio,
  type Landmark,
  type RawHand,
} from '../src/core/hands/GestureRecognizer';

interface HandOptions {
  /** Uniform size multiplier (simulates moving closer/further). */
  scale?: number;
  offsetX?: number;
  /** Fold every finger towards the wrist. */
  curl?: boolean;
  /** Extend only the index finger. */
  point?: boolean;
  /** Thumb→index gap as a fraction of hand size (omit for a natural open hand). */
  pinchGap?: number;
}

const lerpPoint = (a: { x: number; y: number }, b: { x: number; y: number }, t: number): Landmark => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
  z: 0,
});

/** MCP joints for index, middle, ring and pinky. */
const MCPS = [
  { x: 0.44, y: 0.7 },
  { x: 0.5, y: 0.68 },
  { x: 0.56, y: 0.69 },
  { x: 0.62, y: 0.72 },
];

const EXTENDED_TIPS = [
  { x: 0.42, y: 0.36 },
  { x: 0.5, y: 0.32 },
  { x: 0.58, y: 0.35 },
  { x: 0.65, y: 0.4 },
];

const CURLED_TIPS = [
  { x: 0.47, y: 0.66 },
  { x: 0.5, y: 0.65 },
  { x: 0.54, y: 0.66 },
  { x: 0.58, y: 0.68 },
];

const WRIST = { x: 0.5, y: 0.86 };

/** Builds a plausible 21-landmark hand. */
function makeHand(options: HandOptions = {}): Landmark[] {
  const { scale = 1, offsetX = 0, curl = false, point = false } = options;

  const landmarks: Landmark[] = [];
  landmarks[0] = { ...WRIST, z: 0 };
  // Thumb: CMC → MCP → IP → tip.
  landmarks[1] = { x: 0.4, y: 0.78, z: 0 };
  landmarks[2] = { x: 0.36, y: 0.72, z: 0 };
  landmarks[3] = { x: 0.33, y: 0.66, z: 0 };
  landmarks[4] = { x: 0.31, y: 0.6, z: 0 };

  let base = 5;
  for (let finger = 0; finger < 4; finger += 1) {
    const mcp = MCPS[finger]!;
    const folded = curl || (point && finger > 0);
    const tip = folded ? CURLED_TIPS[finger]! : EXTENDED_TIPS[finger]!;
    landmarks[base] = { ...mcp, z: 0 };
    landmarks[base + 1] = lerpPoint(mcp, tip, 0.38);
    landmarks[base + 2] = lerpPoint(mcp, tip, 0.72);
    landmarks[base + 3] = { ...tip, z: 0 };
    base += 4;
  }

  if (options.pinchGap !== undefined) {
    const indexTip = landmarks[8]!;
    // The recogniser normalises by handSize = wrist → index MCP (landmark 5),
    // so the synthetic gap must be expressed in the same unit.
    const size = Math.hypot(landmarks[0]!.x - landmarks[5]!.x, landmarks[0]!.y - landmarks[5]!.y);
    const gap = options.pinchGap * size;
    landmarks[4] = { x: indexTip.x + gap, y: indexTip.y, z: 0 };
  }

  // Scale and translate around the wrist so size/depth can be varied.
  return landmarks.map((p) => ({
    x: WRIST.x + offsetX + (p.x - WRIST.x) * scale,
    y: WRIST.y + (p.y - WRIST.y) * scale,
    z: p.z,
  }));
}

const hand = (landmarks: Landmark[], handedness: 'Left' | 'Right' = 'Right'): RawHand => ({
  landmarks,
  handedness,
  score: 0.95,
});

describe('geometry helpers', () => {
  it('computes the palm centre from the palm landmarks', () => {
    const center = palmCenter(makeHand());
    expect(center.x).toBeGreaterThan(0.45);
    expect(center.x).toBeLessThan(0.6);
    expect(center.y).toBeGreaterThan(0.65);
  });

  it('reports a bigger hand size when the hand is closer', () => {
    expect(handSize(makeHand({ scale: 1.8 }))).toBeGreaterThan(handSize(makeHand()));
  });

  it('separates a pinch from an open hand', () => {
    expect(pinchRatio(makeHand({ pinchGap: 0.1 }))).toBeLessThan(0.2);
    expect(pinchRatio(makeHand())).toBeGreaterThan(0.7);
  });

  it('returns a unit-length palm normal', () => {
    const normal = palmNormal(makeHand());
    expect(Math.hypot(normal.x, normal.y, normal.z)).toBeCloseTo(1, 5);
  });

  it('maps the palm normal to bounded orientation angles', () => {
    const orientation = palmOrientation(palmNormal(makeHand()));
    expect(Math.abs(orientation.yaw)).toBeLessThanOrEqual(Math.PI);
    expect(Math.abs(orientation.pitch)).toBeLessThanOrEqual(Math.PI);
    expect(Number.isFinite(orientation.roll)).toBe(true);
  });

  it('detects an open palm but not a closed fist', () => {
    expect(isOpenPalm(makeHand())).toBe(true);
    expect(isFist(makeHand())).toBe(false);
    expect(isFist(makeHand({ curl: true }))).toBe(true);
    expect(isOpenPalm(makeHand({ curl: true }))).toBe(false);
  });

  it('detects a pointing hand', () => {
    expect(isPointing(makeHand({ point: true }))).toBe(true);
    expect(isPointing(makeHand())).toBe(false);
    expect(isPointing(makeHand({ curl: true }))).toBe(false);
  });
});

describe('GestureRecognizer', () => {
  it('reports no gesture when no hands are visible', () => {
    const state = new GestureRecognizer().update([], 0);
    expect(state.gesture).toBe('none');
    expect(state.poses).toHaveLength(0);
    expect(state.resetTriggered).toBe(false);
  });

  it('detects a single-hand pinch', () => {
    const state = new GestureRecognizer().update([hand(makeHand({ pinchGap: 0.05 }))], 1000);
    expect(state.gesture).toBe('pinch');
    expect(state.poses[0]?.pinching).toBe(true);
  });

  it('detects an open palm as a rotate gesture', () => {
    const state = new GestureRecognizer().update([hand(makeHand())], 1000);
    expect(state.gesture).toBe('palm');
  });

  it('detects two hands pinching as a scale gesture', () => {
    const state = new GestureRecognizer().update(
      [hand(makeHand({ pinchGap: 0.05 })), hand(makeHand({ pinchGap: 0.05, offsetX: 0.25 }), 'Left')],
      1000,
    );
    expect(state.gesture).toBe('two-hands');
    expect(state.handsDistance).toBeGreaterThan(0.1);
  });

  it('applies pinch hysteresis so a loosening pinch stays held', () => {
    const recognizer = new GestureRecognizer();
    recognizer.update([hand(makeHand({ pinchGap: 0.05 }))], 1000);
    // 0.4 is above the "start" threshold (0.34) but below the "release" one (0.46).
    const state = recognizer.update([hand(makeHand({ pinchGap: 0.4 }))], 1100);
    expect(state.poses[0]?.pinching).toBe(true);
  });

  it('releases the pinch once the fingers are clearly apart', () => {
    const recognizer = new GestureRecognizer();
    recognizer.update([hand(makeHand({ pinchGap: 0.05 }))], 1000);
    const state = recognizer.update([hand(makeHand())], 1100);
    expect(state.poses[0]?.pinching).toBe(false);
    expect(state.gesture).toBe('palm');
  });

  it('triggers a reset only after the fist is held for a second', () => {
    const recognizer = new GestureRecognizer();
    const fists = hand(makeHand({ curl: true }));

    const early = recognizer.update([fists], 1000);
    expect(early.gesture).toBe('fist');
    expect(early.resetTriggered).toBe(false);

    const held = recognizer.update([fists], 1000 + 1200);
    expect(held.resetTriggered).toBe(true);

    // The trigger must not repeat while the fist stays closed.
    const again = recognizer.update([fists], 1000 + 1400);
    expect(again.resetTriggered).toBe(false);
  });

  it('re-arms the fist reset after the hand opens', () => {
    const recognizer = new GestureRecognizer();
    const fists = hand(makeHand({ curl: true }));
    const open = hand(makeHand());

    recognizer.update([fists], 1000);
    recognizer.update([fists], 2200); // fires
    recognizer.update([open], 2300); // releases and re-arms
    recognizer.update([fists], 2400);
    const second = recognizer.update([fists], 3600);
    expect(second.resetTriggered).toBe(true);
  });

  it('reports click progress for a pointing hand and fires exactly once', () => {
    const recognizer = new GestureRecognizer();
    const pointing = hand(makeHand({ point: true }));

    const first = recognizer.update([pointing], 1000);
    expect(first.gesture).toBe('point');
    expect(first.poses[0]?.cursorProgress).toBe(0);
    expect(first.clickTriggered).toBe(false);

    const held = recognizer.update([pointing], 1000 + CONFIG.hands.cursorHoldMs + 50);
    expect(held.clickTriggered).toBe(true);

    const after = recognizer.update([pointing], 1000 + CONFIG.hands.cursorHoldMs + 250);
    expect(after.clickTriggered).toBe(false);
  });

  it('exposes the pointer position from the primary hand', () => {
    const state = new GestureRecognizer().update([hand(makeHand({ pinchGap: 0.05 }), 'Left')], 1000);
    expect(state.pointer.x).toBeGreaterThan(0.4);
    expect(state.pointer.y).toBeGreaterThan(0.3);
  });

  it('clears temporal state on reset()', () => {
    const recognizer = new GestureRecognizer();
    recognizer.update([hand(makeHand({ curl: true }))], 1000);
    recognizer.reset();
    const state = recognizer.update([hand(makeHand({ curl: true }))], 1000 + 5000);
    expect(state.gesture).toBe('fist');
    expect(state.resetTriggered).toBe(false);
  });
});
