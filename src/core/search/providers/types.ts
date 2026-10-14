import type { SearchResult } from '../../../app/state';
import type { ParsedQuery } from '../QueryParser';

/**
 * A pluggable model source.
 *
 * Implementations must:
 *  - honour the AbortSignal (the search sheet aborts the previous request);
 *  - throw `SearchQuotaError` when the upstream quota is exhausted, so the
 *    orchestrator can fall back to the offline index;
 *  - only ever return models under a permissive (CC0 / CC-BY) licence.
 */
export interface SearchProvider {
  /** Machine name, also used as the `provider` field on results. */
  readonly name: string;
  /** Human label for the credits modal. */
  readonly label: string;
  search(query: ParsedQuery, signal?: AbortSignal, lang?: string): Promise<SearchResult[]>;
}

/** Thrown when a provider's free quota is exhausted. */
export class SearchQuotaError extends Error {
  constructor(provider: string) {
    super(`quota:${provider}`);
    this.name = 'SearchQuotaError';
  }
}

/** Thrown when a provider is unreachable (offline, CORS, 5xx). */
export class SearchUnavailableError extends Error {
  constructor(provider: string, reason?: string) {
    super(`unavailable:${provider}${reason ? `:${reason}` : ''}`);
    this.name = 'SearchUnavailableError';
  }
}
