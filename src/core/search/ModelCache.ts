/**
 * ModelCache — makes previously used models instant and offline-capable.
 *
 * - GLB payloads live in the Cache Storage API (`caches`), which is exactly the
 *   mechanism a service worker would use and survives reloads;
 * - credits/metadata live in IndexedDB so the CreditsModal can list every model
 *   the user ever loaded for CC-BY compliance, even while offline.
 *
 * Every method degrades gracefully when storage is unavailable.
 */
import { CONFIG } from '../../app/config';
import type { ModelMeta } from '../../app/state';

const DB_NAME = 'webar-models';
const DB_VERSION = 1;
const STORE = 'meta';

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(null);
      return;
    }
    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'id' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

function tx<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T | null> {
  return openDb().then(
    (db) =>
      new Promise<T | null>((resolve) => {
        if (!db) {
          resolve(null);
          return;
        }
        try {
          const transaction = db.transaction(STORE, mode);
          const request = run(transaction.objectStore(STORE));
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => resolve(null);
        } catch {
          resolve(null);
        }
      }),
  );
}

export class ModelCache {
  private readonly cacheName = CONFIG.search.cacheName;

  private async cache(): Promise<Cache | null> {
    if (typeof caches === 'undefined') return null;
    try {
      return await caches.open(this.cacheName);
    } catch {
      return null;
    }
  }

  /** Returns a cached model payload, if present. */
  async get(url: string): Promise<ArrayBuffer | null> {
    const cache = await this.cache();
    if (!cache) return null;
    try {
      const response = await cache.match(url);
      if (!response) return null;
      return await response.arrayBuffer();
    } catch {
      return null;
    }
  }

  /** True when the model is already cached (loaded instantly, works offline). */
  async has(url: string): Promise<boolean> {
    const cache = await this.cache();
    if (!cache) return false;
    try {
      return Boolean(await cache.match(url));
    } catch {
      return false;
    }
  }

  /** Stores a model payload. */
  async put(url: string, buffer: ArrayBuffer): Promise<void> {
    const cache = await this.cache();
    if (!cache) return;
    try {
      await cache.put(
        url,
        new Response(buffer, {
          headers: {
            'content-type': 'model/gltf-binary',
            'content-length': String(buffer.byteLength),
          },
        }),
      );
    } catch (err) {
      console.warn('[cache] failed to store model', err);
    }
  }

  /** Persists model credits/attribution metadata. */
  async putMeta(meta: ModelMeta): Promise<void> {
    await tx('readwrite', (store) => store.put(meta) as IDBRequest<IDBValidKey>);
  }

  /** Reads all stored credits, newest first. */
  async listMeta(): Promise<ModelMeta[]> {
    const all = await tx<ModelMeta[]>('readonly', (store) => store.getAll() as IDBRequest<ModelMeta[]>);
    if (!all) return [];
    return all.filter((meta) => meta && typeof meta.id === 'string');
  }

  /** Deletes one model from the cache (used by "report / remove"). */
  async remove(url: string): Promise<void> {
    const cache = await this.cache();
    if (!cache) return;
    try {
      await cache.delete(url);
    } catch {
      /* ignore */
    }
  }

  /** Empties the whole cache. */
  async clear(): Promise<void> {
    if (typeof caches === 'undefined') return;
    try {
      await caches.delete(this.cacheName);
    } catch {
      /* ignore */
    }
  }
}
