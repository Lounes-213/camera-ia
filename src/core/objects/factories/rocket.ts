import * as THREE from 'three';
import { mark, pbr } from './shared';

/** Low-poly rocket standing on the marker, with fins, window and exhaust. */
export function createRocket(color?: THREE.ColorRepresentation): THREE.Object3D {
  const group = new THREE.Group();
  const base = color ?? '#ff7a00';

  const bodyMaterial = pbr(base, { metalness: 0.35, roughness: 0.32 });

  const body = mark(
    new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.24, 0.86, 24, 1), bodyMaterial),
  );
  body.position.y = 0.43;
  group.add(body);

  const nose = mark(new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.42, 24), bodyMaterial));
  nose.position.y = 1.07;
  group.add(nose);

  const window = mark(
    new THREE.Mesh(
      new THREE.SphereGeometry(0.075, 20, 16),
      pbr('#9fe8ff', { metalness: 0.9, roughness: 0.05, emissiveIntensity: 0.6 }),
    ),
  );
  window.position.set(0, 0.62, 0.19);
  group.add(window);

  const finMaterial = pbr(base, { metalness: 0.3, roughness: 0.45 });
  for (let i = 0; i < 4; i += 1) {
    const fin = mark(new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.3, 0.24), finMaterial));
    const angle = (i / 4) * Math.PI * 2;
    fin.position.set(Math.sin(angle) * 0.23, 0.18, Math.cos(angle) * 0.23);
    fin.rotation.y = -angle;
    fin.rotation.z = 0.18;
    group.add(fin);
  }

  const flame = mark(
    new THREE.Mesh(
      new THREE.ConeGeometry(0.16, 0.34, 20),
      pbr('#ffd166', { metalness: 0, roughness: 0.9, emissiveIntensity: 1.6 }),
    ),
  );
  flame.position.y = -0.17;
  flame.rotation.x = Math.PI;
  flame.userData.flame = true;
  group.add(flame);

  group.userData.triangles = 24 * 4 + 24 * 2 + 20 * 2 + 4 * 12;
  return group;
}
