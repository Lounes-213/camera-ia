/**
 * GET /api/model?id=<model-id>&provider=polypizza
 *
 * Streams a model file through the edge so the API key never reaches the client
 * and so we can enforce a hard size budget before a phone downloads 40 MB.
 *
 * The binary itself is cached in Cache Storage at the edge for a week.
 */
import type { Env, PagesHandler } from '../_shared';
import { CORS_HEADERS, fail, rateLimit } from '../_shared';

const DEFAULT_BASE = 'https://api.poly.pizza/v1.1';
const MAX_BYTES = 12 * 1024 * 1024;

export const onRequestOptions: PagesHandler<Env> = () =>
  new Response(null, { status: 204, headers: CORS_HEADERS });

export const onRequestGet: PagesHandler<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const id = (url.searchParams.get('id') ?? '').trim();
  if (!id) return fail('missing-id', 400);

  if (!rateLimit(request, Number(env.RATE_LIMIT_PER_MINUTE ?? '30'))) {
    return fail('rate-limited', 429, { retryAfter: 60 });
  }

  const key = env.POLY_PIZZA_KEY;
  if (!key) return fail('search-not-configured', 503);

  const upstreamUrl = `${env.POLY_PIZZA_BASE ?? DEFAULT_BASE}/download/${encodeURIComponent(id)}`;

  const cache = typeof caches !== 'undefined' ? await caches.open('polypizza-models-v1') : null;
  const cacheKey = new Request(upstreamUrl, { method: 'GET' });
  if (cache) {
    const hit = await cache.match(cacheKey);
    if (hit) return withHeaders(hit);
  }

  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, { headers: { 'x-auth-token': key } });
  } catch {
    return fail('upstream-unreachable', 502);
  }

  if (upstream.status === 429) return fail('quota-exceeded', 429, { retryAfter: 300 });
  if (!upstream.ok) return fail(`upstream-${upstream.status}`, 502);

  const length = Number(upstream.headers.get('content-length') ?? '0');
  if (length > MAX_BYTES) return fail('model-too-large', 413, { maxBytes: MAX_BYTES });

  const buffer = await upstream.arrayBuffer();
  if (buffer.byteLength > MAX_BYTES) return fail('model-too-large', 413, { maxBytes: MAX_BYTES });

  const response = new Response(buffer, {
    status: 200,
    headers: {
      ...CORS_HEADERS,
      'content-type': 'model/gltf-binary',
      'content-length': String(buffer.byteLength),
      'cache-control': 'public, max-age=604800, immutable',
    },
  });

  if (cache) {
    try {
      cache.put(cacheKey, response.clone());
    } catch {
      /* best-effort */
    }
  }
  return response;
};

function withHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(CORS_HEADERS)) headers.set(name, value);
  return new Response(response.body, { status: response.status, headers });
}
