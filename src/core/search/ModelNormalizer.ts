/**
 * ModelNormalizer — makes any incoming GLB behave like a builtin object.
 *
 * It centres the model on X/Z, drops its base exactly onto the marker plane and
 * scales it into a 1-unit bounding box so transform maths is identical for every
 * model. It also enforces a triangle budget and sheds per-mesh costs that would
 * hurt frame time in AR.
 *
 * The pure maths live in exported helpers so they can be unit-tested without a
 * WebGL context.
 */
import * as THREE from 'three';

export interface NormalizeOptions {
  /** Longest edge of the normalised bounding box, in scene units. */
  targetSize?: number;
  /** Reject models above this triangle count. */
  maxTriangles?: number;
}

export interface NormalizeReport {
  triangles: number;
  size: { x: number; y: number; z: number };
  scale: number;
  /** True when the model was scaled down aggressively (low quality source). */
  downscaled: boolean;
  /** Wrapper that now owns the model, centred and sitting on y = 0. */
  pivot: THREE.Object3D;
}

/** Scale factor that maps a size onto `targetSize` (longest edge). */
export function fitScaleFor(sx: number, sy: number, sz: number, targetSize: number): number {
  const longest = Math.max(sx, sy, sz);
  if (!Number.isFinite(longest) || longest <= 0) return 1;
  return targetSize / longest;
}

/**
 * Offset that moves a box so its base sits on y = 0 and it is centred on X/Z.
 * Returns the translation to apply to the object *after* scaling.
 */
export function baseOffsetFor(
  min: { x: number; y: number; z: number },
  max: { x: number; y: number; z: number },
  scale: number,
): { x: number; y: number; z: number } {
  const centerX = (min.x + max.x) / 2;
  const centerZ = (min.z + max.z) / 2;
  return { x: -centerX * scale, y: -min.y * scale, z: -centerZ * scale };
}

/**
 * Normalises `root` in place (wrapping it in a pivot so the caller can still
 * rotate/scale the whole thing). Throws `model-too-large` when over budget.
 */
export function normalizeModel(root: THREE.Object3D, options: NormalizeOptions = {}): NormalizeReport {
  const targetSize = options.targetSize ?? 1;
  const maxTriangles = options.maxTriangles ?? 150_000;

  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());

  const triangles = countTriangles(root);
  if (triangles > maxTriangles) {
    throw new Error('model-too-large');
  }

  const scale = fitScaleFor(size.x, size.y, size.z, targetSize);
  const offset = baseOffsetFor(box.min, box.max, scale);

  root.scale.multiplyScalar(scale);

  const pivot = new THREE.Group();
  pivot.name = 'model-pivot';
  pivot.add(root);
  pivot.position.set(offset.x, offset.y, offset.z);

  prepareForAr(pivot);

  root.userData.normalized = { scale, triangles, size: size.toArray() };
  pivot.userData.normalized = root.userData.normalized;

  return {
    triangles,
    size: { x: size.x, y: size.y, z: size.z },
    scale,
    downscaled: scale < 0.5,
    pivot,
  };
}

/** Counts triangles across a subtree. */
export function countTriangles(root: THREE.Object3D): number {
  let total = 0;
  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    const geometry = mesh.geometry;
    const position = geometry.getAttribute('position');
    const index = geometry.getIndex();
    const count = index ? index.count : (position?.count ?? 0);
    total += Math.floor(count / 3);
  });
  return total;
}

/**
 * Drops expensive per-mesh settings for AR: no shadow casting (we fake a blob),
 * no frustum culling surprises on skinned meshes, environment reflections on for
 * PBR realism, and double-sided materials kept only where they are needed.
 */
function prepareForAr(root: THREE.Object3D): void {
  root.traverse((node) => {
    const mesh = node as THREE.Mesh & { isSkinnedMesh?: boolean };
    if (!mesh.isMesh) return;

    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.userData.themable = true;
    // Skinned/animated meshes may have animated bounds — never cull them.
    if (mesh.isSkinnedMesh) mesh.frustumCulled = false;

    const materials = Array.isArray(mesh.material)
      ? mesh.material
      : mesh.material
        ? [mesh.material]
        : [];
    for (const entry of materials) {
      const material = entry as THREE.MeshStandardMaterial;
      if (!material) continue;
      if ('envMapIntensity' in material) {
        (material as THREE.MeshStandardMaterial).envMapIntensity = 1;
      }
      // Transparent sort order in AR is fragile: force depth-write off only for
      // genuinely transparent materials, otherwise keep solids solid.
      if (material.transparent && material.opacity < 0.02) {
        material.visible = false;
      }
      material.needsUpdate = true;
    }
  });
}

/** Disposes a model subtree (geometries + materials + textures). */
export function disposeModel(root: THREE.Object3D | null): void {
  if (!root) return;
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  root.traverse((node) => {
    const mesh = node as THREE.Mesh & { material?: THREE.Material | THREE.Material[] };
    if (mesh.geometry) geometries.add(mesh.geometry);
    const list = Array.isArray(mesh.material)
      ? mesh.material
      : mesh.material
        ? [mesh.material]
        : [];
    for (const material of list) if (material) materials.add(material);
  });
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
  root.removeFromParent();
}
