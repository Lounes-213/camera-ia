/**
 * GlowEffect — a neon rim glow that is safe over a transparent AR canvas.
 *
 * Why not UnrealBloom? A bloom pass renders to an intermediate buffer and
 * overwrites alpha, which would erase the camera video showing through the
 * transparent canvas, and it costs a full-screen pass on every frame.
 *
 * Instead we add "shells": back-faced copies of each mesh, slightly enlarged,
 * rendered with additive blending and no depth write. That produces a soft
 * emissive halo that composites correctly with `alpha: true` and costs almost
 * nothing, even on mid-range phones.
 */
import * as THREE from 'three';

interface Shell {
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  host: THREE.Mesh;
}

export class GlowEffect {
  private shells: Shell[] = [];
  private color = new THREE.Color('#ff7a00');
  private strength = 1.1;
  private enabled = true;
  private pulse = true;
  /** Number of halo layers (quality dependent). */
  private layers = 2;

  /** Attaches halo shells to every mesh under `root`. */
  attach(root: THREE.Object3D, color: THREE.ColorRepresentation, strength: number): void {
    this.detach();
    this.color.set(color);
    this.strength = strength;

    root.traverse((node) => {
      if (!(node as THREE.Mesh).isMesh) return;
      const mesh = node as THREE.Mesh;
      if (mesh.userData.isGlowShell) return;
      this.addShell(mesh, 1.045, 0.5);
      if (this.layers > 1) this.addShell(mesh, 1.11, 0.24);
    });

    this.setEnabled(this.enabled);
  }

  private addShell(host: THREE.Mesh, scale: number, opacity: number): void {
    const material = new THREE.MeshBasicMaterial({
      color: this.color,
      transparent: true,
      opacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.BackSide,
      toneMapped: false,
    });
    const mesh = new THREE.Mesh(host.geometry, material);
    mesh.scale.setScalar(scale);
    mesh.renderOrder = 999;
    mesh.frustumCulled = false;
    mesh.userData.isGlowShell = true;
    mesh.userData.baseOpacity = opacity;
    host.add(mesh);
    this.shells.push({ mesh, material, host });
  }

  /** Enables or disables the halo (keeps shells for instant re-enable). */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    for (const shell of this.shells) {
      shell.mesh.visible = enabled;
    }
  }

  /** Updates the halo colour. */
  setColor(color: THREE.ColorRepresentation): void {
    this.color.set(color);
    for (const shell of this.shells) shell.material.color.set(color);
  }

  /** Updates the halo strength (0..2). */
  setStrength(strength: number): void {
    this.strength = Math.max(0, strength);
    this.applyStrength();
  }

  /** Enables/disables the subtle idle pulse. */
  setPulse(pulse: boolean): void {
    this.pulse = pulse;
  }

  /** Sets the number of layers (2 for high quality, 1 for low). */
  setLayers(layers: number): void {
    this.layers = layers;
    // Rebuild so the change takes effect immediately.
    const host = this.shells[0]?.host;
    const root = host?.parent;
    if (root) this.attach(root, this.color, this.strength);
  }

  private applyStrength(): void {
    for (const shell of this.shells) {
      const base = (shell.mesh.userData.baseOpacity as number) ?? 0.4;
      shell.material.opacity = base * this.strength;
    }
  }

  /** Per-frame pulse, kept very subtle so it never looks flickery. */
  update(elapsed: number): void {
    if (!this.enabled || !this.pulse || this.shells.length === 0) return;
    const wobble = 1 + Math.sin(elapsed * 1.6) * 0.06;
    for (const shell of this.shells) {
      const base = (shell.mesh.userData.baseOpacity as number) ?? 0.4;
      shell.material.opacity = base * this.strength * wobble;
    }
  }

  /** Sets an overall fade multiplier used during found/lost transitions. */
  setFade(fade: number): void {
    const clamped = Math.max(0, Math.min(1, fade));
    for (const shell of this.shells) {
      const base = (shell.mesh.userData.baseOpacity as number) ?? 0.4;
      shell.material.opacity = base * this.strength * clamped;
    }
  }

  /** Removes all shells. Geometries are shared with the host meshes — never disposed here. */
  detach(): void {
    for (const shell of this.shells) {
      shell.host.remove(shell.mesh);
      shell.material.dispose();
    }
    this.shells = [];
  }

  dispose(): void {
    this.detach();
  }
}
