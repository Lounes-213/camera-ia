/**
 * PolyPizza — online provider (free, CC0/CC-BY only).
 *
 * The API key never ships to the browser: requests go through the Cloudflare
 * Pages Functions proxy in `functions/api/search.ts`, which injects the secret,
 * adds cache headers and applies a basic rate limit. Model downloads use
 * `functions/api/model.ts` for the same reason.
 *
 * Sketchfab is deliberately NOT implemented: its API requires OAuth user login
 * and its licence terms do not allow anonymous download, so it cannot honour the
 * "no account required" promise. The SearchProvider interface is ready for it
 * if that ever changes — see the README.
 */
import type { SearchResult } from '../../../app/state';
import { CONFIG } from '../../../app/config';
import type { ParsedQuery } from '../QueryParser';
import { type SearchProvider, SearchQuotaError, SearchUnavailableError } from './types';

interface ProxyResponse {
  results?: unknown[];
  error?: string;
  retryAfter?: number;
}

interface ProxyItem {
  id?: unknown;
  title?: unknown;
  author?: unknown;
  license?: unknown;
  sourceUrl?: unknown;
  thumbnail?: unknown;
  triangles?: unknown;
  bytes?: unknown;
  format?: unknown;
}

export class PolyPizzaProvider implements SearchProvider {
  readonly name = 'polypizza';
  readonly label = 'Poly Pizza (CC0 / CC-BY)';

  constructor(private readonly baseUrl: string = CONFIG.search.proxyBase) {}

  async search(query: ParsedQuery, signal?: AbortSignal): Promise<SearchResult[]> {
    const term = query.providerQuery || query.terms.join(' ');
    if (!term) return [];

    const url = `${this.baseUrl}/search?q=${encodeURIComponent(term)}&limit=24`;
    let response: Response;
    try {
      response = await fetch(url, { signal, headers: { accept: 'application/json' } });
    } catch (err) {
      if ((err as { name?: string })?.name === 'AbortError') throw err;
      throw new SearchUnavailableError(this.name, 'network');
    }

    if (response.status === 429) throw new SearchQuotaError(this.name);
    if (!response.ok) throw new SearchUnavailableError(this.name, `http-${response.status}`);

    let payload: ProxyResponse;
    try {
      payload = (await response.json()) as ProxyResponse;
    } catch {
      throw new SearchUnavailableError(this.name, 'bad-json');
    }

    if (!Array.isArray(payload.results)) throw new SearchUnavailableError(this.name, 'bad-shape');

    return payload.results
      .map((item) => this.toResult(item as ProxyItem))
      .filter((result): result is SearchResult => result !== null)
      .slice(0, 24);
  }

  /** Normalises one proxy item, dropping anything malformed or non-commercial. */
  private toResult(item: ProxyItem): SearchResult | null {
    const id = asString(item.id, 128);
    if (!id) return null;

    const license = asString(item.license, 40) || 'CC0';
    // Defence in depth: the proxy filters too, but never trust the network.
    if (!/^(cc0|cc-by)/i.test(license)) return null;

    return {
      id: `${this.name}:${id}`,
      title: asString(item.title, 120) || 'Untitled model',
      author: asString(item.author, 120) || 'Unknown',
      license,
      sourceUrl: asString(item.sourceUrl, 2048),
      provider: this.name,
      thumbnail: asString(item.thumbnail, 2048) || undefined,
      // Downloads are proxied so the API key stays server-side.
      downloadUrl: `${this.baseUrl}/model?id=${encodeURIComponent(id)}&provider=${this.name}`,
      triangles: asNumber(item.triangles),
      bytes: asNumber(item.bytes),
      format: asString(item.format, 16) || 'glb',
    };
  }
}

function asString(value: unknown, max: number): string {
  return typeof value === 'string' ? value.slice(0, max) : '';
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
