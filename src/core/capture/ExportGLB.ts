/**
 * ExportGLB — serialises the current object to a binary .glb file.
 *
 * The exporter runs on the normalised object only (no glow shells, no float
 * pivot), so the downloaded asset drops straight into any other 3D viewer.
 */
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';

export interface ExportOptions {
  /** Include invisible helper nodes (default: false). */
  onlyVisible?: boolean;
  /** Filename without extension. */
  name?: string;
}

/** Exports a subtree as a .glb Blob. */
export function exportGLB(root: THREE.Object3D, options: ExportOptions = {}): Promise<Blob> {
  const exporter = new GLTFExporter();
  return new Promise((resolve, reject) => {
    exporter.parse(
      root,
      (result) => {
        if (result instanceof ArrayBuffer) resolve(new Blob([result], { type: 'model/gltf-binary' }));
        else reject(new Error('export-not-binary'));
      },
      (error) => reject(error instanceof Error ? error : new Error(String(error))),
      { binary: true, onlyVisible: options.onlyVisible ?? false, truncateDrawRange: true },
    );
  });
}

/** Sanitises a model title into a safe file name. */
export function exportFilename(title: string): string {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9\u0600-\u06ff\u00c0-\u017f]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  const stamp = new Date().toISOString().slice(0, 10);
  return `${base || 'webar-object'}-${stamp}.glb`;
}
