/**
 * Asset URL helpers.
 *
 * The app may be served from a sub-path (GitHub Pages, a folder on a shared
 * host), so nothing should hard-code a leading `/`.
 */

const base = import.meta.env.BASE_URL || './';

/** Joins a public asset path with the deployment base URL. */
export function assetUrl(path: string): string {
  if (/^(https?:)?\/\//.test(path) || path.startsWith('data:') || path.startsWith('blob:')) {
    return path;
  }
  const cleanBase = base.endsWith('/') ? base : `${base}/`;
  return `${cleanBase}${path.replace(/^\/+/, '')}`;
}

/** Checks that a public file is reachable (used for targets.mind). */
export async function assetExists(path: string): Promise<boolean> {
  try {
    const res = await fetch(assetUrl(path), { method: 'HEAD', cache: 'no-store' });
    return res.ok;
  } catch {
    return false;
  }
}
