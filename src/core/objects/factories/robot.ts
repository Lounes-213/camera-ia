import * as THREE from 'three';
import { mark, pbr } from './shared';

/** Friendly low-poly robot: boxy body, antenna, floating hands. */
export function createRobot(color?: THREE.ColorRepresentation): THREE.Object3D {
  const group = new THREE.Group();
  const base = color ?? '#ff7a00';
  const body = pbr(base, { metalness: 0.45, roughness: 0.35 });
  const accent = pbr('#ffe0c2', { metalness: 0.2, roughness: 0.5 });

  const torso = mark(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.52, 0.34), body));
  torso.position.y = 0.58;
  group.add(torso);

  const chest = mark(
    new THREE.Mesh(
      new THREE.BoxGeometry(0.24, 0.2, 0.05),
      pbr('#00d4c7', { metalness: 0.1, roughness: 0.3, emissiveIntensity: 1.1 }),
    ),
  );
  chest.position.set(0, 0.6, 0.18);
  group.add(chest);

  const head = mark(new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.3, 0.3), body));
  head.position.y = 1.0;
  group.add(head);

  const face = mark(
    new THREE.Mesh(
      new THREE.BoxGeometry(0.26, 0.12, 0.04),
      pbr('#1a1410', { metalness: 0.2, roughness: 0.2, emissiveIntensity: 0.9 }),
    ),
  );
  face.position.set(0, 1.02, 0.16);
  group.add(face);

  const antenna = mark(new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.22, 8), accent));
  antenna.position.y = 1.26;
  group.add(antenna);

  const antennaTip = mark(
    new THREE.Mesh(
      new THREE.SphereGeometry(0.045, 16, 12),
      pbr('#ff7a00', { metalness: 0.1, roughness: 0.4, emissiveIntensity: 1.5 }),
    ),
  );
  antennaTip.position.y = 1.4;
  group.add(antennaTip);

  const armGeometry = new THREE.BoxGeometry(0.12, 0.4, 0.14);
  for (const side of [-1, 1]) {
    const arm = mark(new THREE.Mesh(armGeometry, body));
    arm.position.set(side * 0.34, 0.6, 0);
    arm.rotation.z = side * 0.14;
    group.add(arm);
  }

  const legGeometry = new THREE.BoxGeometry(0.16, 0.36, 0.18);
  for (const side of [-1, 1]) {
    const leg = mark(new THREE.Mesh(legGeometry, accent));
    leg.position.set(side * 0.14, 0.18, 0);
    group.add(leg);
  }

  group.userData.triangles = (6 + 6 + 6 + 6 + 2 * 8 + 2 * 12 + 2 * 12) * 2;
  return group;
}
