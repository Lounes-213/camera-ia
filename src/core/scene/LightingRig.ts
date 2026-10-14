/**
 * LightingRig — physically based lighting for the anchored object.
 *
 * A PMREM-filtered RoomEnvironment gives believable PBR reflections without any
 * downloaded HDRI, and three cheap analytic lights let the user tune intensity.
 * The rig only affects the object: the video background is untouched.
 */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

export class LightingRig {
  private readonly envTarget: THREE.WebGLRenderTarget;
  private readonly key: THREE.DirectionalLight;
  private readonly fill: THREE.HemisphereLight;
  private readonly rim: THREE.PointLight;
  private intensity = 1;

  constructor(renderer: THREE.WebGLRenderer, private readonly scene: THREE.Scene) {
    const pmrem = new THREE.PMREMGenerator(renderer);
    pmrem.compileEquirectangularShader();
    this.envTarget = pmrem.fromScene(new RoomEnvironment(), 0.04);
    scene.environment = this.envTarget.texture;
    pmrem.dispose();

    // Key light: warm, slightly above and in front.
    this.key = new THREE.DirectionalLight(0xfff2e0, 1.6);
    this.key.position.set(1.2, 2.4, 1.6);
    scene.add(this.key);

    // Fill: cool bounce from below to lift the shadows.
    this.fill = new THREE.HemisphereLight(0xffd9b0, 0x2a2018, 0.7);
    scene.add(this.fill);

    // Rim: orange point light that makes the neon glow read over bright video.
    this.rim = new THREE.PointLight(0xff7a00, 2.2, 6, 2);
    this.rim.position.set(-1.4, 0.8, -1.2);
    scene.add(this.rim);
  }

  /** Applies a user-facing 0..2 intensity multiplier. */
  setIntensity(value: number): void {
    this.intensity = Math.max(0, value);
    this.key.intensity = 1.6 * this.intensity;
    this.fill.intensity = 0.7 * this.intensity;
    this.rim.intensity = 2.2 * this.intensity;
  }

  /** Current intensity multiplier. */
  getIntensity(): number {
    return this.intensity;
  }

  dispose(): void {
    this.scene.remove(this.key, this.fill, this.rim);
    this.key.dispose();
    this.rim.dispose();
    this.envTarget.dispose();
    if (this.scene.environment === this.envTarget.texture) this.scene.environment = null;
  }
}
