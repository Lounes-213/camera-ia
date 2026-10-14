/**
 * AirDrawManager — real-time 3D spatial air drawing & writing engine.
 *
 * Constructs neon 3D strokes directly into the Three.js scene as the user
 * writes or draws in the air using hand pinch / index finger gestures or touch/mouse.
 */
import * as THREE from 'three';

export interface StrokeConfig {
  color: string;
  size: number;
}

export interface Stroke {
  group: THREE.Group;
  points: THREE.Vector3[];
  color: string;
  size: number;
}

export const DRAW_PRESET_COLORS: readonly string[] = [
  '#00f0ff', // Cyber Cyan
  '#ff8800', // Neon Orange
  '#ff0088', // Electric Pink
  '#00ff66', // Matrix Green
  '#ffe600', // Solar Yellow
  '#ffffff', // Pure White
];

export class AirDrawManager {
  readonly root = new THREE.Group();
  private readonly strokes: Stroke[] = [];
  private currentStroke: Stroke | null = null;
  private active = false; // Is air drawing mode toggled on?
  private isDrawing = false; // Currently actively laying down a stroke
  private currentColor = DRAW_PRESET_COLORS[0]!;
  private currentSize = 0.012; // Radius of stroke
  private lastPoint: THREE.Vector3 | null = null;
  private minDistance = 0.006; // Minimum spacing between recorded points

  constructor(private readonly scene: THREE.Scene) {
    this.root.name = 'air-draw-root';
    this.scene.add(this.root);
  }

  /** Toggles or sets air drawing mode active state. */
  setActive(active: boolean): void {
    this.active = active;
    if (!active && this.isDrawing) {
      this.endStroke();
    }
  }

  get isActive(): boolean {
    return this.active;
  }

  setColor(color: string): void {
    this.currentColor = color;
  }

  getColor(): string {
    return this.currentColor;
  }

  setSize(size: number): void {
    this.currentSize = Math.max(0.004, Math.min(0.05, size));
  }

  getSize(): number {
    return this.currentSize;
  }

  /** Starts a new stroke at the given 3D world position. */
  startStroke(pos: THREE.Vector3): void {
    if (this.isDrawing) this.endStroke();

    const group = new THREE.Group();
    group.name = `stroke-${this.strokes.length}`;
    this.root.add(group);

    const firstPt = pos.clone();
    this.currentStroke = {
      group,
      points: [firstPt],
      color: this.currentColor,
      size: this.currentSize,
    };
    this.lastPoint = firstPt;
    this.isDrawing = true;

    // Place a glowing start cap sphere
    const capGeo = new THREE.SphereGeometry(this.currentSize, 12, 12);
    const capMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(this.currentColor) });
    const capMesh = new THREE.Mesh(capGeo, capMat);
    capMesh.position.copy(firstPt);
    group.add(capMesh);
  }

  /** Adds a point to the currently active stroke if it moved enough. */
  addPoint(pos: THREE.Vector3): void {
    if (!this.isDrawing || !this.currentStroke || !this.lastPoint) return;

    const dist = this.lastPoint.distanceTo(pos);
    if (dist < this.minDistance) return;

    const newPt = pos.clone();
    this.currentStroke.points.push(newPt);

    // Build a segment cylinder connecting lastPoint to newPt
    const segment = this.createSegmentMesh(this.lastPoint, newPt, this.currentStroke.size, this.currentStroke.color);
    this.currentStroke.group.add(segment);

    // Join sphere at the joint for smooth rounded corners
    const joinGeo = new THREE.SphereGeometry(this.currentStroke.size, 10, 10);
    const joinMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(this.currentStroke.color) });
    const joinMesh = new THREE.Mesh(joinGeo, joinMat);
    joinMesh.position.copy(newPt);
    this.currentStroke.group.add(joinMesh);

    this.lastPoint = newPt;
  }

  /** Finishes the current stroke. */
  endStroke(): void {
    if (!this.isDrawing) return;
    this.isDrawing = false;
    if (this.currentStroke && this.currentStroke.points.length > 0) {
      this.strokes.push(this.currentStroke);
    }
    this.currentStroke = null;
    this.lastPoint = null;
  }

  /** Creates an oriented cylinder mesh connecting two 3D points. */
  private createSegmentMesh(p1: THREE.Vector3, p2: THREE.Vector3, radius: number, colorHex: string): THREE.Mesh {
    const dir = new THREE.Vector3().subVectors(p2, p1);
    const length = dir.length();
    const mid = new THREE.Vector3().addVectors(p1, p2).multiplyScalar(0.5);

    const geo = new THREE.CylinderGeometry(radius, radius, length, 10, 1, false);
    // Align cylinder (default along Y) with dir
    const orientation = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      dir.clone().normalize(),
    );

    const mat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(colorHex),
    });

    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(mid);
    mesh.quaternion.copy(orientation);
    return mesh;
  }

  /** Removes the most recent stroke (Undo). */
  undo(): boolean {
    if (this.isDrawing) this.endStroke();
    const last = this.strokes.pop();
    if (!last) return false;

    this.disposeGroup(last.group);
    this.root.remove(last.group);
    return true;
  }

  /** Erases any stroke that comes within radius of the given 3D position. */
  eraseNear(pos: THREE.Vector3, radius = 0.08): boolean {
    if (this.isDrawing) this.endStroke();
    let erased = false;
    for (let i = this.strokes.length - 1; i >= 0; i--) {
      const stroke = this.strokes[i]!;
      const hit = stroke.points.some((pt) => pt.distanceTo(pos) <= radius);
      if (hit) {
        this.disposeGroup(stroke.group);
        this.root.remove(stroke.group);
        this.strokes.splice(i, 1);
        erased = true;
      }
    }
    return erased;
  }

  /** Clears all drawn strokes. */
  clear(): void {
    if (this.isDrawing) this.endStroke();
    for (const stroke of this.strokes) {
      this.disposeGroup(stroke.group);
      this.root.remove(stroke.group);
    }
    this.strokes.length = 0;
  }

  get strokeCount(): number {
    return this.strokes.length;
  }

  private disposeGroup(group: THREE.Group): void {
    group.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry?.dispose();
        if (Array.isArray(child.material)) {
          child.material.forEach((m) => m.dispose());
        } else {
          child.material?.dispose();
        }
      }
    });
  }

  dispose(): void {
    this.clear();
    this.scene.remove(this.root);
  }
}
