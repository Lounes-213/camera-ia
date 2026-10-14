/**
 * ContactShadow — a soft blob shadow that sits on the marker plane.
 *
 * A real shadow map would need a directional light with a shadow camera tuned to
 * the marker and costs an extra depth pass; over a video background a blurred
 * radial gradient reads just as convincingly and is essentially free. At high
 * quality a second, larger, fainter blob fakes the penumbra.
 */
import * as THREE from 'three';

/** Builds a radial-gradient alpha texture once and reuses it. */
function createShadowTexture(): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, 'rgba(0,0,0,0.85)');
    gradient.addColorStop(0.45, 'rgba(0,0,0,0.42)');
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

export class ContactShadow {
  private readonly group = new THREE.Group();
  private readonly inner: THREE.Mesh;
  private readonly outer: THREE.Mesh;
  private readonly texture: THREE.CanvasTexture;
  private readonly innerMaterial: THREE.MeshBasicMaterial;
  private readonly outerMaterial: THREE.MeshBasicMaterial;
  private diameter = 1;
  private opacity = 0.55;
  private enabled = true;

  constructor(parent: THREE.Object3D) {
    this.texture = createShadowTexture();
    const geometry = new THREE.PlaneGeometry(1, 1);
    geometry.rotateX(-Math.PI / 2);

    this.innerMaterial = new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      opacity: this.opacity,
      depthWrite: false,
      toneMapped: false,
      color: 0x120c08,
    });
    this.outerMaterial = this.innerMaterial.clone();
    this.outerMaterial.opacity = this.opacity * 0.4;

    this.inner = new THREE.Mesh(geometry, this.innerMaterial);
    this.outer = new THREE.Mesh(geometry, this.outerMaterial);
    this.inner.renderOrder = 1;
    this.outer.renderOrder = 0;
    this.group.add(this.outer, this.inner);
    // Sits just above the marker plane to avoid z-fighting.
    this.group.position.y = 0.0015;
    this.group.renderOrder = 0;
    parent.add(this.group);
    this.setDiameter(1);
  }

  /** Shadow diameter in marker-width units. */
  setDiameter(diameter: number): void {
    this.diameter = Math.max(0.05, diameter);
    this.inner.scale.setScalar(this.diameter * 0.62);
    this.outer.scale.setScalar(this.diameter * 1.05);
  }

  /** Shadow opacity 0..1. */
  setOpacity(opacity: number): void {
    this.opacity = Math.max(0, Math.min(1, opacity));
    this.innerMaterial.opacity = this.opacity;
    this.outerMaterial.opacity = this.opacity * 0.4;
  }

  /** Enables/disables the shadow without disposing it. */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.group.visible = enabled;
  }

  /** Quality switch: the penumbra blob only exists at high/medium quality. */
  setQuality(quality: 'high' | 'medium' | 'low'): void {
    this.outer.visible = quality !== 'low';
  }

  /** Fades the shadow together with the object. */
  setFade(fade: number): void {
    const clamped = Math.max(0, Math.min(1, fade));
    this.innerMaterial.opacity = this.opacity * clamped;
    this.outerMaterial.opacity = this.opacity * 0.4 * clamped;
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  dispose(): void {
    this.group.removeFromParent();
    this.inner.geometry.dispose();
    this.innerMaterial.dispose();
    this.outerMaterial.dispose();
    this.texture.dispose();
  }
}
