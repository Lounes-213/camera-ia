/**
 * ObjectRegistry — the catalogue of procedural objects plus the helpers that
 * theme and dispose them.
 *
 * Everything the app renders is either created here (no network, no assets) or
 * imported through GLBLoader. All objects are built at roughly 1 unit wide so
 * the transform/scale maths is identical for procedural and imported models.
 */
import * as THREE from 'three';
import type { TranslationKey } from '../../ui/i18n';
import type { MaterialState } from '../../app/state';
import {
  createCrystal,
  createCubeGrid,
  createIcosahedron,
  createOrbitSphere,
  createRobot,
  createRocket,
  createTorusKnot,
} from './factories';

export interface ObjectDefinition {
  id: string;
  labelKey: TranslationKey;
  /** Approximate triangle budget, used to pick a quality level. */
  triangles: number;
  create: (color?: THREE.ColorRepresentation) => THREE.Object3D;
}

export const OBJECT_DEFINITIONS: readonly ObjectDefinition[] = [
  { id: 'torusKnot', labelKey: 'objects.torusKnot', triangles: 11520, create: createTorusKnot },
  {
    id: 'icosahedron',
    labelKey: 'objects.icosahedron',
    triangles: 100,
    create: createIcosahedron,
  },
  { id: 'crystal', labelKey: 'objects.crystal', triangles: 24, create: createCrystal },
  { id: 'cubeGrid', labelKey: 'objects.cubeGrid', triangles: 324, create: createCubeGrid },
  {
    id: 'orbitSphere',
    labelKey: 'objects.orbitSphere',
    triangles: 6456,
    create: createOrbitSphere,
  },
  { id: 'rocket', labelKey: 'objects.rocket', triangles: 288, create: createRocket },
  { id: 'robot', labelKey: 'objects.robot', triangles: 148, create: createRobot },
] as const;

const byId = new Map(OBJECT_DEFINITIONS.map((definition) => [definition.id, definition]));

/** Looks up a definition, falling back to the first entry. */
export function getDefinition(id: string): ObjectDefinition {
  return byId.get(id) ?? OBJECT_DEFINITIONS[0]!;
}

/** Builds a procedural object by id. */
export function createObject(id: string, color?: THREE.ColorRepresentation): THREE.Object3D {
  return getDefinition(id).create(color);
}

/** True when the id refers to a bundled procedural object. */
export function isBuiltinObject(id: string): boolean {
  return byId.has(id);
}

/** Human label for a builtin object id (falls back to the raw id). */
export function objectLabelKey(id: string): TranslationKey {
  return byId.get(id)?.labelKey ?? 'objects.custom';
}

/**
 * Applies a MaterialState to every themable mesh under `root`.
 * Colour is skipped for meshes whose material carries a texture map (imported
 * models), where tinting would wreck the artwork.
 */
export function applyMaterial(root: THREE.Object3D | null, material: MaterialState): void {
  if (!root) return;
  const color = new THREE.Color(material.color);
  const emissiveIntensity = material.glow ? material.emissiveIntensity : 0.04;

  root.traverse((node) => {
    const mesh = node as THREE.Mesh & { material?: THREE.Material | THREE.Material[] };
    if (!mesh.isMesh && !(mesh as unknown as THREE.Points).isPoints) return;
    if (mesh.userData.isGlowShell) return;

    const materials = Array.isArray(mesh.material)
      ? mesh.material
      : mesh.material
        ? [mesh.material]
        : [];

    for (const entry of materials) {
      const mat = entry as THREE.MeshStandardMaterial;
      if (!mat) continue;
      const hasMap = Boolean(mat.map);
      if (!hasMap && mat.color) mat.color.copy(color);
      if (mat.emissive) {
        if (!hasMap) mat.emissive.copy(color);
        mat.emissiveIntensity = emissiveIntensity;
      }
      if (typeof mat.metalness === 'number') mat.metalness = material.metalness;
      if (typeof mat.roughness === 'number') mat.roughness = material.roughness;
      if (typeof mat.wireframe === 'boolean') mat.wireframe = material.wireframe;
      mat.needsUpdate = true;
    }
  });
}

/** Sets the overall opacity of every mesh under `root` (used for fades). */
export function applyOpacity(root: THREE.Object3D | null, opacity: number): void {
  if (!root) return;
  const clamped = Math.max(0, Math.min(1, opacity));
  const opaque = clamped >= 0.999;

  root.traverse((node) => {
    const mesh = node as THREE.Mesh & { material?: THREE.Material | THREE.Material[] };
    if (!mesh.isMesh) return;
    const materials = Array.isArray(mesh.material)
      ? mesh.material
      : mesh.material
        ? [mesh.material]
        : [];
    for (const entry of materials) {
      const mat = entry as THREE.Material;
      if (!mat) continue;
      if (mat.userData.baseTransparent === undefined) {
        mat.userData.baseTransparent = mat.transparent;
        mat.userData.baseOpacity = mat.opacity;
      }
      if (opaque) {
        mat.transparent = Boolean(mat.userData.baseTransparent);
        mat.opacity = (mat.userData.baseOpacity as number) ?? 1;
      } else {
        mat.transparent = true;
        mat.opacity = ((mat.userData.baseOpacity as number) ?? 1) * clamped;
      }
      mat.needsUpdate = true;
    }
  });
}

/** Counts triangles in a subtree. */
export function countTriangles(root: THREE.Object3D): number {
  let total = 0;
  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    const geometry = mesh.geometry;
    const index = geometry.getIndex();
    const position = geometry.getAttribute('position');
    if (!position) return;
    const count = index ? index.count : position.count;
    total += Math.floor(count / 3);
  });
  return total;
}

/** Releases every geometry and material under `root` exactly once. */
export function disposeObject(root: THREE.Object3D | null): void {
  if (!root) return;
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();

  root.traverse((node) => {
    const mesh = node as THREE.Mesh & { material?: THREE.Material | THREE.Material[] };
    if (mesh.geometry) geometries.add(mesh.geometry);
    const list = Array.isArray(mesh.material)
      ? mesh.material
      : mesh.material
        ? [mesh.material]
        : [];
    for (const material of list) {
      if (!material) continue;
      materials.add(material);
      for (const value of Object.values(material as unknown as Record<string, unknown>)) {
        if (value instanceof THREE.Texture) textures.add(value);
      }
    }
  });

  for (const geometry of geometries) geometry.dispose();
  for (const texture of textures) texture.dispose();
  for (const material of materials) material.dispose();
  root.removeFromParent();
}
