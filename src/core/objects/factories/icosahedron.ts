import * as THREE from 'three';
import { mark, pbr } from './shared';

/** Faceted icosahedron with a subtle inner core. */
export function createIcosahedron(color?: THREE.ColorRepresentation): THREE.Object3D {
  const group = new THREE.Group();

  const shell = mark(
    new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.52, 1),
      pbr(color ?? '#ff7a00', { metalness: 0.65, roughness: 0.2 }),
    ),
  );
  group.add(shell);

  const core = mark(
    new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.3, 0),
      pbr(color ?? '#ff7a00', { metalness: 0.1, roughness: 0.6, emissiveIntensity: 0.9 }),
    ),
  );
  core.rotation.set(0.6, 0.4, 0.2);
  group.add(core);

  group.userData.triangles = 80 + 20;
  return group;
}
