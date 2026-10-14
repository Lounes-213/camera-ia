import * as THREE from 'three';
import { mark, pbr } from './shared';

/** Metallic sphere with two orbiting rings and a small moon. */
export function createOrbitSphere(color?: THREE.ColorRepresentation): THREE.Object3D {
  const group = new THREE.Group();

  const sphere = mark(
    new THREE.Mesh(
      new THREE.SphereGeometry(0.36, 48, 32),
      pbr(color ?? '#ff7a00', { metalness: 0.7, roughness: 0.18 }),
    ),
  );
  sphere.position.y = 0.4;
  group.add(sphere);

  const ringMaterial = pbr(color ?? '#ff7a00', { metalness: 0.2, roughness: 0.45 });
  const ringA = mark(new THREE.Mesh(new THREE.TorusGeometry(0.52, 0.012, 8, 96), ringMaterial));
  ringA.rotation.set(Math.PI / 2.4, 0.2, 0);
  ringA.position.y = 0.4;
  group.add(ringA);

  const ringB = mark(new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.01, 8, 96), ringMaterial));
  ringB.rotation.set(Math.PI / 1.7, -0.4, 0.3);
  ringB.position.y = 0.4;
  group.add(ringB);

  const moon = mark(
    new THREE.Mesh(
      new THREE.SphereGeometry(0.07, 20, 14),
      pbr(color ?? '#ff7a00', { metalness: 0.1, roughness: 0.5, emissiveIntensity: 0.8 }),
    ),
  );
  moon.position.set(0.52, 0.4, 0);
  moon.userData.orbit = { radius: 0.62, speed: 0.9, height: 0.4 };
  group.add(moon);

  group.userData.triangles = 48 * 32 * 2 + 2 * 96 * 8 * 2;
  return group;
}
