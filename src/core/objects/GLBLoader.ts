/**
 * GLBLoader — loads user-imported and searched models.
 *
 * Decoders (DRACO, KTX2/Basis, meshopt) are self-hosted under /public so model
 * loading never touches a CDN. Downloads stream through fetch so we can report
 * progress, enforce a size budget and support cancellation via AbortSignal.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'meshoptimizer';
import { assetUrl } from '../../utils/assets';
import { CONFIG } from '../../app/config';

export interface LoadedModel {
  scene: THREE.Object3D;
  animations: THREE.AnimationClip[];
  bytes: number;
}

export interface LoadProgress {
  loaded: number;
  total: number;
  /** 0..1, or null when the server sends no content-length. */
  ratio: number | null;
}

export function isModelFile(file: File): boolean {
  return /\.(glb|gltf)$/i.test(file.name);
}

/** Maps an ArrayBuffer/text to the right model entry point. */
export class GLBLoader {
  private readonly loader: GLTFLoader;
  private readonly draco: DRACOLoader;

  constructor(renderer: THREE.WebGLRenderer) {
    this.draco = new DRACOLoader();
    this.draco.setDecoderPath(assetUrl('draco/'));

    this.loader = new GLTFLoader();
    this.loader.setDRACOLoader(this.draco);
    this.loader.setMeshoptDecoder(MeshoptDecoder);

    const ktx2 = new KTX2Loader();
    ktx2.setTranscoderPath(assetUrl('basis/'));
    try {
      ktx2.detectSupport(renderer);
      this.loader.setKTX2Loader(ktx2);
    } catch (err) {
      console.warn('[gltf] KTX2 transcoder unavailable', err);
    }
  }

  /** Loads a model from a URL with progress + cancellation + size guard. */
  async loadFromUrl(
    url: string,
    onProgress?: (progress: LoadProgress) => void,
    signal?: AbortSignal,
    maxBytes = CONFIG.search.maxDownloadBytes,
  ): Promise<LoadedModel> {
    const response = await fetch(url, { signal, mode: 'cors' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const declared = Number(response.headers.get('content-length') ?? '0');
    if (declared > maxBytes) throw new Error('model-too-large');

    const buffer = await streamToArrayBuffer(response, declared, onProgress, maxBytes);
    return this.parse(buffer, url);
  }

  /** Loads a user-provided .glb file (drag & drop or file picker). */
  async loadFromFile(
    file: File,
    onProgress?: (progress: LoadProgress) => void,
  ): Promise<LoadedModel> {
    if (file.size > CONFIG.search.maxDownloadBytes) throw new Error('model-too-large');
    const buffer = await file.arrayBuffer();
    onProgress?.({ loaded: file.size, total: file.size, ratio: 1 });
    return this.parse(buffer, file.name);
  }

  /** Parses an ArrayBuffer containing a .glb (or a self-contained .gltf). */
  parse(buffer: ArrayBuffer, path: string): Promise<LoadedModel> {
    return new Promise<LoadedModel>((resolve, reject) => {
      this.loader.parse(
        buffer,
        '',
        (gltf) => {
          resolve({
            scene: gltf.scene,
            animations: gltf.animations ?? [],
            bytes: buffer.byteLength,
          });
        },
        (error) => reject(error instanceof Error ? error : new Error(String(error))),
      );
    }).catch((error) => {
      throw new Error(`Failed to parse "${path}": ${(error as Error).message}`);
    });
  }

  dispose(): void {
    this.draco.dispose();
  }
}

/** Streams a Response body into an ArrayBuffer, reporting progress. */
async function streamToArrayBuffer(
  response: Response,
  total: number,
  onProgress?: (progress: LoadProgress) => void,
  maxBytes = CONFIG.search.maxDownloadBytes,
): Promise<ArrayBuffer> {
  const body = response.body;
  if (!body) return response.arrayBuffer();

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    loaded += value.byteLength;
    if (loaded > maxBytes) {
      await reader.cancel();
      throw new Error('model-too-large');
    }
    chunks.push(value);
    onProgress?.({ loaded, total, ratio: total > 0 ? Math.min(1, loaded / total) : null });
  }

  const merged = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged.buffer;
}
