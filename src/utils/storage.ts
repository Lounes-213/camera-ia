/**
 * Namespaced, type-safe localStorage wrapper.
 *
 * Storage may be unavailable (private mode / disabled cookies), so every call is
 * guarded and falls back to an in-memory map.
 */
import { CONFIG } from '../app/config';

const memory = new Map<string, string>();
const PREFIX = CONFIG.storage.key;

const backing: Storage | null = (() => {
  try {
    const probe = `${PREFIX}.__probe__`;
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch {
    return null;
  }
})();

function fullKey(key: string): string {
  return `${PREFIX}.${key}`;
}

/** Reads and JSON-parses a persisted value. */
export function load<T>(key: string, fallback: T): T {
  try {
    const raw = backing ? backing.getItem(fullKey(key)) : memory.get(fullKey(key));
    if (raw === null || raw === undefined) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** Serialises and persists a value. Silently ignores quota errors. */
export function save(key: string, value: unknown): void {
  try {
    const raw = JSON.stringify(value);
    if (backing) backing.setItem(fullKey(key), raw);
    else memory.set(fullKey(key), raw);
  } catch (err) {
    console.warn('[storage] failed to persist', key, err);
  }
}

/** Removes a single persisted key. */
export function remove(key: string): void {
  try {
    if (backing) backing.removeItem(fullKey(key));
    else memory.delete(fullKey(key));
  } catch {
    /* ignore */
  }
}

export const storage = { load, save, remove };
