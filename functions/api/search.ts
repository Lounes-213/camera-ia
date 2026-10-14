/**
 * GET /api/search?q=<text>&limit=<n>
 *
 * Free proxy in front of the Poly Pizza API:
 *  - the API key lives in the `POLY_PIZZA_KEY` secret, never in the client;
 *  - responses are cached at the edge for an hour (free-tier friendly);
 *  - only CC0 / CC-BY models are returned;
 *  - the payload is normalised so the client has one result shape.
 *
 * A missing key is not an error the user should ever see: the endpoint answers
 * `503` with a clear message and the app silently falls back to the bundled
 * offline index.
 */
import type { Env, PagesHandler } from '../_shared';
import { asRecord, fail, json, normaliseLicense, rateLimit } from '../_shared';

const DEFAULT_BASE = 'https://api.poly.pizza/v1.1';
const MAX_LIMIT = 24;

export const onRequestOptions: PagesHandler<Env> = () => json({ ok: true });

export const onRequestGet: PagesHandler<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const query = (url.searchParams.get('q') ?? '').trim().slice(0, 80);
  if (!query) return fail('missing-query', 400);

  if (!rateLimit(request, Number(env.RATE_LIMIT_PER_MINUTE ?? '30'))) {
    return fail('rate-limited', 429, { retryAfter: 60 });
  }

  const key = env.POLY_PIZZA_KEY;
  if (!key) {
    // Not configured: tell the client to use the offline index.
    return fail('search-not-configured', 503);
  }

  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(url.searchParams.get('limit') ?? '24')));

  // Poly Pizza's legacy endpoint; search then filter by licence.
  const upstreamUrl = new URL(`${env.POLY_PIZZA_BASE ?? DEFAULT_BASE}/search/${encodeURIComponent(query)}`);
  upstreamUrl.searchParams.set('limit', String(limit));
  upstreamUrl.searchParams.set('license', 'CC0,CC-BY');

  const cache = typeof caches !== 'undefined' ? await caches.open('polypizza-search-v1') : null;
  const cacheKey = new Request(upstreamUrl.toString(), { method: 'GET' });
  if (cache) {
    const hit = await cache.match(cacheKey);
    if (hit) return new Response(hit.body, hit);
  }

  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl.toString(), {
      headers: { 'x-auth-token': key, accept: 'application/json' },
    });
  } catch {
    return fail('upstream-unreachable', 502);
  }

  if (upstream.status === 429) return fail('quota-exceeded', 429, { retryAfter: 300 });
  if (upstream.status === 401 || upstream.status === 403) {
    return fail('upstream-unauthorized', 503);
  }
  if (!upstream.ok) return fail(`upstream-${upstream.status}`, 502);

  let payload: unknown;
  try {
    payload = await upstream.json();
  } catch {
    return fail('upstream-bad-json', 502);
  }

  const results = normaliseResults(payload, limit);
  const response = json({ results, count: results.length }, 200);

  if (cache) {
    try {
      cache.put(cacheKey, response.clone());
    } catch {
      /* cache is best-effort */
    }
  }
  return response;
};

interface NormalisedResult {
  id: string;
  title: string;
  author: string;
  license: string;
  sourceUrl: string;
  thumbnail: string;
  triangles?: number;
  bytes?: number;
  format: string;
}

/** Accepts the several shapes Poly Pizza's API has used over time. */
function normaliseResults(payload: unknown, limit: number): NormalisedResult[] {
  const record = asRecord(payload);
  const candidates = Array.isArray(payload)
    ? payload
    : Array.isArray(record?.results)
      ? (record?.results as unknown[])
      : Array.isArray(record?.data)
        ? (record?.data as unknown[])
        : [];

  const out: NormalisedResult[] = [];
  for (const candidate of candidates) {
    const item = asRecord(candidate);
    if (!item) continue;

    const id = stringOf(item.id ?? item._id ?? item.slug);
    if (!id) continue;

    const license = normaliseLicense(item.license ?? item.licence ?? 'CC0');
    // The client promises CC0/CC-BY only; drop anything else.
    if (!license) continue;

    const glb = stringOf(item.Download ?? item.download ?? item.model ?? item.glb ?? '');
    out.push({
      id,
      title: stringOf(item.Title ?? item.title ?? item.name) || 'Untitled model',
      author: stringOf(item.Creator ?? item.author ?? item.username) || 'Unknown',
      license,
      sourceUrl: stringOf(item.External ?? item.sourceUrl ?? item.url),
      thumbnail: stringOf(item.Thumbnail ?? item.thumbnail ?? item.image),
      triangles: numberOf(item.triangles ?? item.Tris),
      bytes: numberOf(item.bytes ?? item.size),
      format: glb.toLowerCase().endsWith('.glb') ? 'glb' : 'gltf',
    });
    if (out.length >= limit) break;
  }
  return out;
}

function stringOf(value: unknown): string {
  return typeof value === 'string' ? value.slice(0, 2048) : '';
}

function numberOf(value: unknown): number | undefined {
  const num = typeof value === 'string' ? Number(value) : value;
  return typeof num === 'number' && Number.isFinite(num) ? num : undefined;
}
