/**
 * Shared helpers for the Cloudflare Pages Functions proxy.
 *
 * These run on Cloudflare's edge (workerd), NOT in the browser. Their only job
 * is to keep the third-party API key server-side, cache aggressively, limit
 * abuse and normalise the upstream payload into the shape the client expects.
 *
 * Deploy with:
 *   npx wrangler pages secret put POLY_PIZZA_KEY --project-name <your-pages-project>
 */

/** Minimal Pages Function typings so we do not need extra type packages. */
export interface Env {
  POLY_PIZZA_KEY?: string;
  POLY_PIZZA_BASE?: string;
  RATE_LIMIT_PER_MINUTE?: string;
}

export interface PagesContext<E> {
  request: Request;
  env: E;
  params: Record<string, string | string[]>;
  waitUntil(promise: Promise<unknown>): void;
  next(): Promise<Response>;
}

export type PagesHandler<E> = (context: PagesContext<E>) => Response | Promise<Response>;

/** CORS headers: the app is same-origin, but this also allows local dev. */
export const CORS_HEADERS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
  'access-control-allow-headers': 'content-type',
  'access-control-max-age': '86400',
};

export const JSON_HEADERS: Record<string, string> = {
  ...CORS_HEADERS,
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400',
};

/** Standard JSON response. */
export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS, ...headers },
  });
}

/** JSON error response. */
export function fail(message: string, status = 400, extra: Record<string, unknown> = {}): Response {
  return json({ error: message, ...extra }, status);
}

/**
 * Best-effort in-memory rate limiter.
 *
 * Workers isolates are ephemeral, so this only limits a single hot isolate — it
 * is a speed bump, not a security boundary. The real protection is that the API
 * key is never exposed and the upstream quota stays private.
 */
const buckets = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(request: Request, limit: number): boolean {
  const ip = request.headers.get('cf-connecting-ip') ?? request.headers.get('x-forwarded-for') ?? 'local';
  const now = Date.now();
  const bucket = buckets.get(ip);
  if (!bucket || now > bucket.resetAt) {
    buckets.set(ip, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  bucket.count += 1;
  return bucket.count <= limit;
}

/** Normalises a licence string to the CC0 / CC-BY family we allow. */
export function normaliseLicense(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.toLowerCase();
  if (text.includes('cc0') || text.includes('public domain')) return 'CC0-1.0';
  if (text.startsWith('cc-by') || text.includes('cc-by') || text.includes('attribution')) {
    return 'CC-BY-4.0';
  }
  return null;
}

/** True when the upstream payload looks like the free Poly Pizza response. */
export function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}
