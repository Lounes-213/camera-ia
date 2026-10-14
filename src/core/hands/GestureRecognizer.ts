/**
 * GestureRecognizer — pure geometry + a small amount of state.
 *
 * All the maths is exported as pure functions so it can be unit-tested without a
 * camera or MediaPipe. The class only adds temporal behaviour: pinch hysteresis,
 * "hold to click" and "hold a fist to reset".
 */
import type { GestureType } from '../../app/state';
import { CONFIG } from '../../app/config';
import { clamp, normalizeAngle } from '../../utils/math';

export interface Landmark {
  x: number;
  y: number;
  z: number;
}

export interface RawHand {
  /** 21 landmarks in normalised video coordinates (0..1). */
  landmarks: Landmark[];
  handedness: 'Left' | 'Right';
  score: number;
}

export interface HandPose {
  /** 21 landmarks in normalised video coordinates (0..1). */
  landmarks: Landmark[];
  handedness: 'Left' | 'Right';
  score: number;
  /** Palm centre in normalised video space. */
  center: { x: number; y: number; z: number };
  /** Unit palm normal in video space. */
  normal: { x: number; y: number; z: number };
  /** Wrist→index-MCP distance, used as a depth proxy. */
  size: number;
  /** thumb-index distance divided by hand size. */
  pinchRatio: number;
  pinching: boolean;
  yaw: number;
  pitch: number;
  roll: number;
  /** 0..1 progress of the "hold to click" ring when pointing. */
  cursorProgress: number;
}

export interface GestureState {
  gesture: GestureType;
  poses: HandPose[];
  /** Index into `poses` of the hand that drives the object. */
  primaryIndex: number;
  /** Estimated distance between both hands (0 when only one is present). */
  handsDistance: number;
  /** True when a fist was held long enough and a reset should fire. */
  resetTriggered: boolean;
  /** True when the pointing cursor completed a 600 ms hold. */
  clickTriggered: boolean;
  /** Where the pinch/cursor is, in normalised video space. */
  pointer: { x: number; y: number };
}

// ---- Pure geometry ---------------------------------------------------------

const distance = (a: Landmark, b: Landmark): number =>
  Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/** Palm centre = average of wrist + the four finger MCP joints. */
export function palmCenter(landmarks: Landmark[]): { x: number; y: number; z: number } {
  const indices = [0, 5, 9, 13, 17];
  let x = 0;
  let y = 0;
  let z = 0;
  for (const index of indices) {
    const point = landmarks[index];
    if (!point) continue;
    x += point.x;
    y += point.y;
    z += point.z;
  }
  return { x: x / indices.length, y: y / indices.length, z: z / indices.length };
}

/** Hand "size": wrist → index MCP. Larger means closer to the camera. */
export function handSize(landmarks: Landmark[]): number {
  const wrist = landmarks[0];
  const index = landmarks[9];
  if (!wrist || !index) return 0.0001;
  return Math.max(0.0001, distance(wrist, index));
}

/** Thumb-tip ↔ index-tip distance normalised by hand size. */
export function pinchRatio(landmarks: Landmark[]): number {
  const thumb = landmarks[4];
  const index = landmarks[8];
  if (!thumb || !index) return 1;
  return distance(thumb, index) / handSize(landmarks);
}

/** Palm normal from the plane (wrist, index MCP, pinky MCP). */
export function palmNormal(landmarks: Landmark[]): { x: number; y: number; z: number } {
  const wrist = landmarks[0];
  const index = landmarks[5];
  const pinky = landmarks[17];
  if (!wrist || !index || !pinky) return { x: 0, y: 0, z: 1 };

  const ax = index.x - wrist.x;
  const ay = index.y - wrist.y;
  const az = index.z - wrist.z;
  const bx = pinky.x - wrist.x;
  const by = pinky.y - wrist.y;
  const bz = pinky.z - wrist.z;

  let nx = ay * bz - az * by;
  let ny = az * bx - ax * bz;
  let nz = ax * by - ay * bx;
  const length = Math.hypot(nx, ny, nz) || 1;
  nx /= length;
  ny /= length;
  nz /= length;
  return { x: nx, y: ny, z: nz };
}

/** Yaw/pitch/roll (radians) derived from the palm normal. */
export function palmOrientation(normal: { x: number; y: number; z: number }): {
  yaw: number;
  pitch: number;
  roll: number;
} {
  const yaw = Math.atan2(normal.x, Math.abs(normal.z) + 1e-5);
  const pitch = Math.asin(clamp(normal.y, -1, 1));
  const roll = Math.atan2(normal.y, normal.x);
  return {
    yaw: normalizeAngle(yaw * 0.9),
    pitch: normalizeAngle(-pitch * 0.9),
    roll: normalizeAngle(roll),
  };
}

export function isPointing(landmarks: Landmark[]): boolean {
  const wrist = landmarks[0];
  const thumb = landmarks[4];
  const index = landmarks[8];
  if (!wrist || !index) return false;

  // If thumb tip (4) and index tip (8) are touching (علامة 👌 / bien), it is a pinch/pen, NOT pointing alone
  if (thumb && Math.hypot(thumb.x - index.x, thumb.y - index.y) < 0.065) {
    return false;
  }

  const size = handSize(landmarks);
  const tipDistance = (idx: number): number => {
    const point = landmarks[idx];
    return point ? distance(point, wrist) / size : 0;
  };
  // Index extended further from wrist than middle finger
  return (
    tipDistance(8) > 1.35 &&
    tipDistance(8) > tipDistance(12) * 1.08
  );
}

/** True when the hand is a closed fist (all fingertips tucked towards the wrist). */
export function isFist(landmarks: Landmark[]): boolean {
  const wrist = landmarks[0];
  if (!wrist) return false;
  const size = handSize(landmarks);
  const tips = [8, 12, 16, 20];
  let curled = 0;
  for (const tip of tips) {
    const point = landmarks[tip];
    if (!point) continue;
    if (distance(point, wrist) / size < 1.35) curled += 1;
  }
  return curled === tips.length;
}

/** True when the whole palm is open (all fingers extended). */
export function isOpenPalm(landmarks: Landmark[]): boolean {
  const wrist = landmarks[0];
  if (!wrist) return false;
  const size = handSize(landmarks);
  const tips = [8, 12, 16, 20];
  let extended = 0;
  for (const tip of tips) {
    const point = landmarks[tip];
    if (!point) continue;
    if (distance(point, wrist) / size > 1.7) extended += 1;
  }
  return extended >= 3;
}

// ---- Stateful recogniser ---------------------------------------------------

export class GestureRecognizer {
  private wasPinching = new Map<string, boolean>();
  private fistSince = new Map<string, number>();
  private cursorSince: number | null = null;
  private resetArmed = true;

  /** Processes one video frame worth of hands. */
  update(hands: RawHand[], timestampMs: number): GestureState {
    const poses: HandPose[] = hands.map((hand) => this.toPose(hand, timestampMs));

    // ---- two hands pinching = scale ----------------------------------------
    const pinching = poses.filter((pose) => pose.pinching);
    let handsDistance = 0;
    if (poses.length >= 2) {
      const a = poses[0]!;
      const b = poses[1]!;
      handsDistance = Math.hypot(a.center.x - b.center.x, a.center.y - b.center.y, a.center.z - b.center.z);
    }

    let gesture: GestureType = 'none';
    let primaryIndex = 0;

    if (poses.length >= 2 && pinching.length >= 2) {
      gesture = 'two-hands';
      primaryIndex = 0;
    } else if (pinching.length === 1) {
      gesture = 'pinch';
      primaryIndex = poses.indexOf(pinching[0]!);
    } else if (poses.length > 0) {
      // Prefer a pointing hand for the UI cursor, then a fist, then an open palm.
      const pointingIndex = hands.findIndex((hand) => isPointing(hand.landmarks));
      const fistIndex = hands.findIndex((hand) => isFist(hand.landmarks));
      if (pointingIndex >= 0) {
        gesture = 'point';
        primaryIndex = pointingIndex;
      } else if (fistIndex >= 0) {
        gesture = 'fist';
        primaryIndex = fistIndex;
      } else if (hands.some((hand) => isOpenPalm(hand.landmarks))) {
        gesture = 'palm';
        primaryIndex = 0;
      }
    }

    // ---- fist hold → reset --------------------------------------------------
    let resetTriggered = false;
    if (gesture === 'fist') {
      const key = poses[primaryIndex]?.handedness ?? 'Right';
      const since = this.fistSince.get(key) ?? timestampMs;
      if (!this.fistSince.has(key)) this.fistSince.set(key, timestampMs);
      if (this.resetArmed && timestampMs - since >= CONFIG.hands.fistHoldMs) {
        resetTriggered = true;
        this.resetArmed = false;
      }
    } else {
      this.fistSince.clear();
      this.resetArmed = true;
    }

    // ---- pointing hold → click ---------------------------------------------
    let clickTriggered = false;
    const cursorProgress = this.updateCursorProgress(gesture === 'point', timestampMs);
    if (cursorProgress >= 1) {
      clickTriggered = true;
      this.cursorSince = null;
    }

    const primary = poses[primaryIndex];
    const pointer = primary && primary.landmarks && primary.landmarks[8]
      ? { x: primary.landmarks[8].x, y: primary.landmarks[8].y }
      : primary
        ? { x: primary.center.x, y: primary.center.y }
        : { x: 0.5, y: 0.5 };

    return {
      gesture,
      poses: poses.map((pose) => ({ ...pose, cursorProgress })),
      primaryIndex,
      handsDistance,
      resetTriggered,
      clickTriggered,
      pointer,
    };
  }

  /** Clears temporal state (called when tracking is lost). */
  reset(): void {
    this.wasPinching.clear();
    this.fistSince.clear();
    this.cursorSince = null;
    this.resetArmed = true;
  }

  private updateCursorProgress(active: boolean, timestampMs: number): number {
    if (!active) {
      this.cursorSince = null;
      return 0;
    }
    if (this.cursorSince === null) this.cursorSince = timestampMs;
    return clamp((timestampMs - this.cursorSince) / CONFIG.hands.cursorHoldMs, 0, 1);
  }

  private toPose(hand: RawHand, _timestampMs: number): HandPose {
    const { landmarks, handedness, score } = hand;
    const size = handSize(landmarks);
    const ratio = pinchRatio(landmarks);
    const key = handedness;

    const thumb = landmarks[4];
    const index = landmarks[8];
    const directThumbIndex = thumb && index ? Math.hypot(thumb.x - index.x, thumb.y - index.y) : 1;
    const normalizedThumbIndex = directThumbIndex / Math.max(0.01, size);

    const wasPinching = this.wasPinching.get(key) ?? false;
    // Strict recognition of the "bien" / OK sign 👌 (thumb tip 4 & index tip 8 physically touching):
    // Enter pinch: firm direct contact (< 0.052 screen dist or < 0.28 hand size)
    // Exit pinch: clear release (> 0.068 screen dist and > 0.38 hand size)
    const isTouch = directThumbIndex < 0.052 || (directThumbIndex < 0.060 && normalizedThumbIndex < 0.28);
    const isRelease = directThumbIndex > 0.068 && normalizedThumbIndex > 0.38;
    const pinching = wasPinching ? !isRelease : isTouch;
    this.wasPinching.set(key, pinching);

    const normal = palmNormal(landmarks);
    const orientation = palmOrientation(normal);
    const center = palmCenter(landmarks);

    return {
      landmarks,
      handedness,
      score,
      center,
      normal,
      size,
      pinchRatio: ratio,
      pinching,
      yaw: orientation.yaw,
      pitch: orientation.pitch,
      roll: orientation.roll,
      cursorProgress: 0,
    };
  }
}
