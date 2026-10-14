/**
 * Hand → world projection.
 *
 * Deliberately import-free so both the lazy MediaPipe module and the always-on
 * app shell can use it: importing HandTracker would pull MediaPipe into the base
 * bundle, and the app needs this maths on every frame.
 *
 * The hand's apparent size is used as a depth cue, then the normalised position
 * is projected through the camera's vertical field of view.
 */
import { CONFIG } from '../../app/config';
import { clamp } from '../../utils/math';

export interface HandPoseInput {
  center: { x: number; y: number; z: number };
  size: number;
  yaw: number;
  pitch: number;
  roll: number;
}

export interface CameraProjection {
  fov: number;
  aspect: number;
}

export interface HandWorldPose {
  /** Position in camera space (negative z is in front of the camera). */
  position: { x: number; y: number; z: number };
  yaw: number;
  pitch: number;
  roll: number;
  /** Estimated distance in world units (1 = the reference hand distance). */
  distance: number;
}

/** Projects a normalised hand pose into camera space. */
export function handToWorld(
  pose: HandPoseInput,
  camera: CameraProjection,
  _mirrored: boolean,
): HandWorldPose {
  const ratio = pose.size > 0.0001 ? pose.size : 0.0001;
  const distance = clamp(CONFIG.hands.refHandSize / ratio, 0.45, 2.6);
  const z = -distance;

  const halfFov = (camera.fov * Math.PI) / 360;
  const visibleHeight = 2 * Math.abs(z) * Math.tan(halfFov);
  const visibleWidth = visibleHeight * (camera.aspect || 1);

  const nx = clamp(pose.center.x, 0, 1);
  const ny = clamp(pose.center.y, 0, 1);
  // Note: pose.center.x is already in screen coordinate space (0..1, left to right).
  // In camera space, +X is right, so (nx - 0.5) * visibleWidth correctly maps to 3D.
  return {
    position: {
      x: (nx - 0.5) * visibleWidth,
      y: -(ny - 0.5) * visibleHeight,
      z,
    },
    yaw: pose.yaw,
    pitch: pose.pitch,
    roll: pose.roll,
    distance,
  };
}
