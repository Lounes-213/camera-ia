/**
 * SpatialGrabManager — direct 3D manipulation engine for grabbing, dragging,
 * and anchoring objects anywhere in real-world 3D space.
 *
 * Supports both hand pinch grabbing and mouse/touch screen dragging with
 * visual glowing selection rings and persistent physical anchoring.
 */
import * as THREE from 'three';

export interface SpatialGrabManagerOptions {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  targetObject: THREE.Object3D;
  onPositionChanged?: (pos: THREE.Vector3) => void;
}

export class SpatialGrabManager {
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly targetObject: THREE.Object3D;
  private readonly onPositionChanged?: (pos: THREE.Vector3) => void;

  private isHandGrabbing = false;
  private isPointerDragging = false;
  private grabOffset = new THREE.Vector3();
  private readonly selectionRing: THREE.Mesh;
  private enabled = true;
  private freePlacementMode = false;

  constructor(options: SpatialGrabManagerOptions) {
    this.scene = options.scene;
    this.camera = options.camera;
    this.targetObject = options.targetObject;
    this.onPositionChanged = options.onPositionChanged;

    // Glowing selection / anchor ring beneath the object
    const ringGeo = new THREE.RingGeometry(0.22, 0.26, 32);
    ringGeo.rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color('#00f0ff'),
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.8,
    });
    this.selectionRing = new THREE.Mesh(ringGeo, ringMat);
    this.selectionRing.name = 'spatial-selection-ring';
    this.scene.add(this.selectionRing);
    this.updateRing();
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.selectionRing.visible = enabled;
  }

  setFreePlacement(free: boolean): void {
    this.freePlacementMode = free;
  }

  get isFreePlacement(): boolean {
    return this.freePlacementMode;
  }

  get isGrabbing(): boolean {
    return this.isHandGrabbing || this.isPointerDragging;
  }

  /**
   * Updates hand grab based on hand world position and pinch state.
   * @param handPos Current 3D position of the hand.
   * @param isPinch True if user is pinching.
   */
  updateHandGrab(handPos: THREE.Vector3, isPinch: boolean): boolean {
    if (!this.enabled) return false;

    const objPos = this.targetObject.position;

    // If pinching: immediately seize the object!
    if (isPinch) {
      if (!this.isHandGrabbing) {
        this.isHandGrabbing = true;
        // Smoothly compute grab offset between object and fingertips
        this.grabOffset.subVectors(objPos, handPos);
        // If object was far from fingers, bring it right into comfortable reach
        if (this.grabOffset.length() > 0.35) {
          this.grabOffset.normalize().multiplyScalar(0.06);
        }
        this.setRingColor('#ff8800', 1.0);
      }

      if (this.isHandGrabbing) {
        const targetPos = new THREE.Vector3().addVectors(handPos, this.grabOffset);
        this.targetObject.position.lerp(targetPos, 0.65);
        this.updateRing();
        this.onPositionChanged?.(this.targetObject.position);
        return true;
      }
    } else {
      // Released pinch -> drop and securely anchor at this 3D position
      if (this.isHandGrabbing) {
        this.isHandGrabbing = false;
        this.setRingColor('#00f0ff', 0.8);
        this.onPositionChanged?.(this.targetObject.position);
      }
    }

    this.updateRing();
    return this.isHandGrabbing;
  }

  /**
   * Directly places the object at a specific screen coordinate (2D -> 3D unproject).
   * @param screenX Normalised screen X (0..1)
   * @param screenY Normalised screen Y (0..1)
   * @param targetDistance Distance in front of camera (default ~0.65m)
   */
  placeAtScreenPoint(screenX: number, screenY: number, targetDistance = 0.65): void {
    const ndcX = (screenX - 0.5) * 2;
    const ndcY = -(screenY - 0.5) * 2;

    const vector = new THREE.Vector3(ndcX, ndcY, 0.5);
    vector.unproject(this.camera);

    const dir = vector.sub(this.camera.position).normalize();
    const newPos = new THREE.Vector3().copy(this.camera.position).addScaledVector(dir, targetDistance);

    this.targetObject.position.copy(newPos);
    this.updateRing();
    this.onPositionChanged?.(this.targetObject.position);
  }

  /** Starts a pointer drag (mouse / touch). */
  startPointerDrag(screenX: number, screenY: number): boolean {
    if (!this.enabled) return false;
    this.isPointerDragging = true;
    this.placeAtScreenPoint(screenX, screenY);
    this.setRingColor('#ff8800', 1.0);
    return true;
  }

  /** Updates pointer drag position. */
  updatePointerDrag(screenX: number, screenY: number): void {
    if (!this.isPointerDragging) return;
    this.placeAtScreenPoint(screenX, screenY);
  }

  /** Ends pointer drag. */
  endPointerDrag(): void {
    if (!this.isPointerDragging) return;
    this.isPointerDragging = false;
    this.setRingColor('#00f0ff', 0.8);
    this.onPositionChanged?.(this.targetObject.position);
  }

  private setRingColor(hex: string, opacity: number): void {
    const mat = this.selectionRing.material as THREE.MeshBasicMaterial;
    mat.color.set(hex);
    mat.opacity = opacity;
  }

  private updateRing(): void {
    this.selectionRing.position.copy(this.targetObject.position);
    this.selectionRing.position.y -= 0.12; // place slightly below the object base
  }

  dispose(): void {
    this.selectionRing.geometry.dispose();
    (this.selectionRing.material as THREE.Material).dispose();
    this.scene.remove(this.selectionRing);
  }
}
