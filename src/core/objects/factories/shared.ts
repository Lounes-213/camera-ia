/**
 * Shared helpers for the procedural object factories.
 *
 * Every factory builds its meshes with a MeshStandardMaterial created here so
 * SceneManager can recolour/re-tune the whole object with one traversal.
 */
import * as THREE from 'three';

export interface PbrOptions {
  metalness?: number;
  roughness?: number;
  emissiveIntensity?: number;
  color?: THREE.ColorRepresentation;
}

/** Creates the standard PBR material used by all procedural objects. */
export function pbr(color: THREE.ColorRepresentation = '#ff7a00', options: PbrOptions = {}): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    color,
    metalness: options.metalness ?? 0.45,
    roughness: options.roughness ?? 0.28,
    emissive: new THREE.Color(color),
    emissiveIntensity: options.emissiveIntensity ?? 0.35,
    flatShading: false,
  });
  material.userData.isPbr = true;
  return material;
}

/** Marks a mesh so SceneManager knows it participates in material theming. */
export function mark<T extends THREE.Mesh>(mesh: T): T {
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.userData.themable = true;
  return mesh;
}

/** Rotates a geometry so its "up" axis is +Y (convenient for cones/cylinders). */
export function orientUp(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  return geometry;
}
