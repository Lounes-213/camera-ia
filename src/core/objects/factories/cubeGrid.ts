import * as THREE from 'three';
import { mark, pbr } from './shared';

/**
 * 3x3x3 lattice of cubes. A Group of meshes (not InstancedMesh) keeps the glow
 * shells and per-mesh material theming trivial; 27 boxes is still nothing.
 */
export function createCubeGrid(color?: THREE.ColorRepresentation): THREE.Object3D {
  const group = new THREE.Group();
  const geometry = new THREE.BoxGeometry(0.2, 0.2, 0.2);
  const material = pbr(color ?? '#ff7a00', { metalness: 0.5, roughness: 0.3 });

  const spacing = 0.27;
  const offset = spacing * 1;
  for (let x = -1; x <= 1; x += 1) {
    for (let y = -1; y <= 1; y += 1) {
      for (let z = -1; z <= 1; z += 1) {
        const cube = mark(new THREE.Mesh(geometry, material));
        cube.position.set(x * spacing, y * spacing + offset, z * spacing);
        // Hollow out the centre for a nicer silhouette.
        if (x === 0 && y === 0 && z === 0) cube.scale.setScalar(0.55);
        group.add(cube);
      }
    }
  }

  group.userData.triangles = 27 * 12;
  return group;
}
