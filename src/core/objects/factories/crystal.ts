import * as THREE from 'three';
import { mark, pbr } from './shared';

/** Elongated gem: a faceted octahedron plus a small satellite shard. */
export function createCrystal(color?: THREE.ColorRepresentation): THREE.Object3D {
  const group = new THREE.Group();

  const gem = mark(
    new THREE.Mesh(
      new THREE.OctahedronGeometry(0.42, 0),
      pbr(color ?? '#ff7a00', {
        metalness: 0.3,
        roughness: 0.06,
        emissiveIntensity: 0.5,
      }),
    ),
  );
  gem.scale.set(0.82, 1.42, 0.82);
  gem.position.y = 0.42;
  group.add(gem);

  const shard = mark(
    new THREE.Mesh(
      new THREE.OctahedronGeometry(0.16, 0),
      pbr(color ?? '#ff7a00', { metalness: 0.35, roughness: 0.1 }),
    ),
  );
  shard.scale.set(0.7, 1.3, 0.7);
  shard.position.set(0.42, 0.14, -0.1);
  shard.rotation.z = 0.32;
  group.add(shard);

  group.userData.triangles = 12;
  return group;
}
