import * as THREE from 'three';
import { mark, pbr } from './shared';

/** Interlocking torus knot — the default showpiece object. */
export function createTorusKnot(color?: THREE.ColorRepresentation): THREE.Object3D {
  const geometry = new THREE.TorusKnotGeometry(0.32, 0.105, 180, 32, 2, 3);
  const mesh = mark(new THREE.Mesh(geometry, pbr(color ?? '#ff7a00')));
  mesh.rotation.x = Math.PI / 8;
  const group = new THREE.Group();
  group.add(mesh);
  group.userData.triangles = 180 * 32 * 2;
  return group;
}
