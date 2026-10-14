/**
 * SceneManager — the single owner of the anchored 3D content.
 *
 * Hierarchy (per mode):
 *
 *   holder ──► transformGroup ──► floatGroup ──► objectRoot (normalised, base at y=0)
 *     │              │
 *     │              └─ user rotation / scale / height / auto-rotate
 *     └─ contact shadow (stays flat on the marker plane)
 *
 * In marker mode `holder` is parented to the MindAR anchor; in hands mode it is
 * parented to the scene and driven by HandTracker. Reparenting keeps a single
 * code path for materials, glow, shadow, export and snapshots.
 */
import * as THREE from 'three';
import type { GestureType, MaterialState, ModelMeta, Quality, TransformState } from '../../app/state';
import { damp } from '../../utils/math';
import {
  applyMaterial,
  applyOpacity,
  countTriangles,
  createObject,
  disposeObject,
} from '../objects/ObjectRegistry';
import { GLBLoader, type LoadProgress } from '../objects/GLBLoader';
import { normalizeModel } from '../search/ModelNormalizer';
import { GlowEffect } from './GlowEffect';
import { LightingRig } from './LightingRig';
import { ContactShadow } from './Shadow';
import { OneEuroFilter } from '../../utils/math';

export interface SceneManagerDeps {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  anchorGroup: THREE.Group;
  material: MaterialState;
  transform: TransformState;
  quality: Quality;
}

export class SceneManager {
  readonly holder = new THREE.Group();
  readonly transformGroup = new THREE.Group();
  private readonly floatGroup = new THREE.Group();
  private readonly glow = new GlowEffect();
  private readonly shadow: ContactShadow;
  private readonly lighting: LightingRig;
  private readonly loader: GLBLoader;

  private objectRoot: THREE.Object3D | null = null;
  private mixer: THREE.AnimationMixer | null = null;
  private autoAngle = 0;
  private opacity = 1;
  private materialState: MaterialState;
  private transformState: TransformState;
  private quality: Quality;
  private objectMeta: ModelMeta | null = null;
  private fadeFilter = new OneEuroFilter(3.2, 0.01);
  private disposed = false;
  /** Which space the holder lives in (marker anchor vs camera). */
  private space: 'marker' | 'camera' = 'marker';
  /** Latest hand-driven target (hands mode only). */
  private handTarget: { x: number; y: number; z: number } | null = null;
  private handRotation = { yaw: 0, pitch: 0, roll: 0 };
  private handGesture: GestureType = 'none';

  constructor(private readonly deps: SceneManagerDeps) {
    this.materialState = { ...deps.material };
    this.transformState = { ...deps.transform, rotation: { ...deps.transform.rotation } };
    this.quality = deps.quality;

    this.holder.add(this.transformGroup);
    this.transformGroup.add(this.floatGroup);
    this.shadow = new ContactShadow(this.holder);
    this.lighting = new LightingRig(deps.renderer, deps.scene);
    this.loader = new GLBLoader(deps.renderer);

    deps.anchorGroup.add(this.holder);
    this.lighting.setIntensity(this.materialState.lightIntensity);
    this.shadow.setEnabled(this.materialState.contactShadow);
    this.applyQuality(this.quality);
  }

  /** Current object root (null until the first object is set). */
  get object(): THREE.Object3D | null {
    return this.objectRoot;
  }

  /** Metadata of the loaded model (null for builtin objects). */
  get meta(): ModelMeta | null {
    return this.objectMeta;
  }

  /** Reparents content between marker space and camera space. */
  setSpace(space: 'marker' | 'camera', scene: THREE.Scene): void {
    this.space = space;
    if (space === 'marker') {
      this.handTarget = null;
      this.holder.position.set(0, 0, 0);
      this.holder.rotation.set(0, 0, 0);
      this.deps.anchorGroup.add(this.holder);
    } else {
      scene.add(this.holder);
      if (this.holder.position.lengthSq() < 0.001) {
        // Place in front of camera at default comfortable viewing position
        this.holder.position.set(0, -0.05, -0.7);
      }
    }
  }

  /** Records the current hand gesture (used for subtle feedback). */
  setHandGesture(gesture: GestureType): void {
    this.handGesture = gesture;
  }

  /** Current hand gesture. */
  getHandGesture(): GestureType {
    return this.handGesture;
  }

  /** Clears hand target so the object stays anchored in its current position. */
  clearHandPose(): void {
    this.handTarget = null;
  }

  /**
   * Sets the hand-driven pose. The position is in camera space and is smoothed
   * here so the caller can pass raw (already filtered) values every frame.
   */
  setHandPose(pose: {
    position: THREE.Vector3 | { x: number; y: number; z: number };
    yaw: number;
    pitch: number;
    roll: number;
  }): void {
    this.handTarget = { x: pose.position.x, y: pose.position.y, z: pose.position.z };
    this.handRotation = { yaw: pose.yaw, pitch: pose.pitch, roll: pose.roll };
  }

  /** Adds a procedural object by id. */
  setBuiltinObject(id: string, color: string): ModelMeta {
    const object = createObject(id, color);
    this.install(object, {
      id: `builtin:${id}`,
      title: id,
      provider: 'builtin',
      license: 'MIT',
      builtin: true,
      triangles: countTriangles(object),
    });
    return this.objectMeta!;
  }

  /** Loads a GLB/GLTF from a URL (search results, remote assets). */
  async loadFromUrl(
    url: string,
    meta: ModelMeta,
    onProgress?: (progress: LoadProgress) => void,
    signal?: AbortSignal,
  ): Promise<ModelMeta> {
    const loaded = await this.loader.loadFromUrl(url, onProgress, signal);
    return this.install(loaded.scene, {
      ...meta,
      bytes: loaded.bytes,
      triangles: countTriangles(loaded.scene),
    }, loaded.animations);
  }

  /** Loads a user-supplied .glb/.gltf file. */
  async loadFromFile(
    file: File,
    onProgress?: (progress: LoadProgress) => void,
  ): Promise<ModelMeta> {
    const loaded = await this.loader.loadFromFile(file, onProgress);
    return this.install(
      loaded.scene,
      {
        id: `file:${file.name}`,
        title: file.name,
        provider: 'user',
        license: 'unknown',
        bytes: file.size,
        triangles: countTriangles(loaded.scene),
      },
      loaded.animations,
    );
  }

  /** Normalises, installs and themes a freshly loaded object. */
  private install(
    object: THREE.Object3D,
    meta: ModelMeta,
    animations: THREE.AnimationClip[] = [],
  ): ModelMeta {
    this.clearObject();

    const report = normalizeModel(object);
    this.objectRoot = report.pivot;
    this.objectMeta = { ...meta, triangles: report.triangles };
    this.floatGroup.add(report.pivot);

    applyMaterial(report.pivot, this.materialState);
    this.glow.setLayers(this.quality === 'low' ? 1 : 2);
    this.glow.attach(report.pivot, this.materialState.color, this.materialState.glowStrength);
    this.glow.setEnabled(this.materialState.glow);

    const box = new THREE.Box3().setFromObject(report.pivot);
    const size = box.getSize(new THREE.Vector3());
    this.shadow.setDiameter(Math.max(0.55, Math.max(size.x, size.z) * 1.5));

    if (animations.length > 0 && this.materialState.animation) {
      this.mixer = new THREE.AnimationMixer(report.pivot);
      for (const clip of animations) this.mixer.clipAction(clip).play();
    }

    this.applyTransform();
    applyOpacity(report.pivot, this.opacity);
    return this.objectMeta;
  }

  /** Removes and disposes the current object (no leaks on change). */
  private clearObject(): void {
    this.glow.detach();
    if (this.mixer) {
      this.mixer.stopAllAction();
      this.mixer.uncacheRoot(this.mixer.getRoot() as THREE.Object3D);
      this.mixer = null;
    }
    if (this.objectRoot) {
      this.floatGroup.remove(this.objectRoot);
      disposeObject(this.objectRoot);
      this.objectRoot = null;
    }
    this.objectMeta = null;
  }

  /** Applies a material patch and pushes it to the GPU. */
  setMaterial(patch: Partial<MaterialState>): MaterialState {
    this.materialState = { ...this.materialState, ...patch };
    applyMaterial(this.objectRoot, this.materialState);
    this.glow.setColor(this.materialState.color);
    this.glow.setStrength(this.materialState.glowStrength);
    this.glow.setEnabled(this.materialState.glow);
    this.shadow.setEnabled(this.materialState.contactShadow);
    if (patch.lightIntensity !== undefined) {
      this.lighting.setIntensity(this.materialState.lightIntensity);
    }
    if (this.mixer && patch.animation !== undefined) {
      if (this.materialState.animation) {
        this.mixer.timeScale = 1;
      } else {
        this.mixer.timeScale = 0;
      }
    }
    return this.materialState;
  }

  /** Applies a transform patch. */
  setTransform(patch: Partial<TransformState>): TransformState {
    this.transformState = {
      ...this.transformState,
      ...patch,
      rotation: { ...this.transformState.rotation, ...(patch.rotation ?? {}) },
    };
    this.applyTransform();
    return this.transformState;
  }

  /** Restores the default transform. */
  resetTransform(): TransformState {
    this.autoAngle = 0;
    this.transformState = {
      autoRotate: this.transformState.autoRotate,
      spinSpeed: 1,
      scale: 1,
      height: 0.28,
      rotation: { x: 0, y: 0, z: 0 },
    };
    this.applyTransform();
    return this.transformState;
  }

  private applyTransform(): void {
    this.transformGroup.position.y = this.transformState.height;
    this.transformGroup.scale.setScalar(Math.max(0.05, this.transformState.scale));
  }

  /** Rotates the object from a drag delta (radians). */
  rotateBy(dx: number, dy: number): void {
    this.setTransform({
      rotation: {
        x: this.transformState.rotation.x + dy,
        y: this.transformState.rotation.y + dx,
        z: this.transformState.rotation.z,
      },
    });
  }

  /** Multiplies the current scale (clamped). */
  scaleBy(factor: number): void {
    const scale = Math.min(3.5, Math.max(0.15, this.transformState.scale * factor));
    this.setTransform({ scale });
  }

  /** Adds to the height above the marker plane (marker-width units). */
  heightBy(delta: number): void {
    const height = Math.min(2.5, Math.max(-0.4, this.transformState.height + delta));
    this.setTransform({ height });
  }

  /** Smoothly fades the whole anchored object in/out. */
  setFade(value: number): void {
    this.opacity = Math.max(0, Math.min(1, value));
    applyOpacity(this.objectRoot, this.opacity);
    this.glow.setFade(this.opacity);
    this.shadow.setFade(this.opacity);
  }

  /** Current fade value 0..1. */
  getFade(): number {
    return this.opacity;
  }

  /** Per-frame animation: auto-rotate, float, orbit moons, flame, mixer, glow. */
  update(dt: number, elapsed: number, targetVisible: boolean): void {
    if (this.disposed) return;

    // Found/lost fade, smoothed so it never pops.
    const target = targetVisible ? 1 : 0;
    const smoothed = this.fadeFilter.filter(target, elapsed * 1000);
    if (Math.abs(smoothed - this.opacity) > 0.001) this.setFade(smoothed);

    if (this.transformState.autoRotate) {
      this.autoAngle += dt * 0.6 * this.transformState.spinSpeed;
    }
    const rotation = this.transformState.rotation;
    this.transformGroup.rotation.set(rotation.x, rotation.y + this.autoAngle, rotation.z);

    if (this.materialState.animation) {
      this.floatGroup.position.y = Math.sin(elapsed * 1.7) * 0.03;
      this.floatGroup.rotation.z = Math.sin(elapsed * 0.9) * 0.02;
    } else {
      this.floatGroup.position.y = 0;
      this.floatGroup.rotation.z = 0;
    }

    // Hands mode: the holder follows the hand in camera space.
    if (this.space === 'camera' && this.handTarget) {
      const target = this.handTarget;
      this.holder.position.set(
        damp(this.holder.position.x, target.x, 16, dt),
        damp(this.holder.position.y, target.y, 16, dt),
        damp(this.holder.position.z, target.z, 14, dt),
      );
      this.holder.rotation.set(
        damp(this.holder.rotation.x, this.handRotation.pitch, 8, dt),
        damp(this.holder.rotation.y, this.handRotation.yaw, 8, dt),
        damp(this.holder.rotation.z, this.handRotation.roll, 8, dt),
      );
    }

    if (this.objectRoot) {
      this.objectRoot.traverse((node) => {
        const orbit = node.userData.orbit as
          | { radius: number; speed: number; height: number }
          | undefined;
        if (orbit) {
          const angle = elapsed * orbit.speed;
          node.position.set(
            Math.cos(angle) * orbit.radius,
            orbit.height + Math.sin(angle * 2) * 0.05,
            Math.sin(angle) * orbit.radius,
          );
        }
        if (node.userData.flame) {
          const flicker = 0.85 + Math.sin(elapsed * 22) * 0.12 + Math.sin(elapsed * 7.3) * 0.06;
          node.scale.set(flicker, 0.9 + Math.sin(elapsed * 17) * 0.2, flicker);
        }
      });
    }

    this.mixer?.update(dt);
    this.glow.update(elapsed);
  }

  /** Applies a quality level: pixel ratio, glow layers, shadow penumbra. */
  applyQuality(quality: Quality): void {
    this.quality = quality;
    const renderer = this.deps.renderer;
    const dpr = window.devicePixelRatio || 1;
    const cap = quality === 'high' ? 2 : quality === 'medium' ? 1.5 : 1;
    renderer.setPixelRatio(Math.min(dpr, cap));
    this.glow.setLayers(quality === 'low' ? 1 : 2);
    this.glow.setPulse(quality !== 'low');
    this.shadow.setQuality(quality);
    applyMaterial(this.objectRoot, this.materialState);
  }

  /** The material state currently applied. */
  getMaterial(): MaterialState {
    return { ...this.materialState };
  }

  /** The transform state currently applied. */
  getTransform(): TransformState {
    return { ...this.transformState, rotation: { ...this.transformState.rotation } };
  }

  /** Root node handed to the GLB exporter. */
  getExportRoot(): THREE.Object3D | null {
    return this.objectRoot;
  }

  /** Temporarily removes the glow shells so they are not serialised. */
  beginExport(): void {
    this.glow.detach();
  }

  /** Restores the glow shells after an export/snapshot. */
  endExport(): void {
    if (!this.objectRoot) return;
    this.glow.attach(this.objectRoot, this.materialState.color, this.materialState.glowStrength);
    this.glow.setEnabled(this.materialState.glow);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clearObject();
    this.glow.dispose();
    this.shadow.dispose();
    this.lighting.dispose();
    this.loader.dispose();
    this.holder.removeFromParent();
  }
}
