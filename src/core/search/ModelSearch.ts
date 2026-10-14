/**
 * ModelSearch — orchestrates the "ask for an object" feature.
 *
 * Order of operations for every query:
 *   1. parse the free text (any of en/fr/ar/darija) into a canonical concept;
 *   2. query the bundled offline index immediately (always available);
 *   3. query the online provider through the proxy, unless offline/quota/error;
 *   4. optionally re-rank with the semantic worker;
 *   5. remember the model's credits for CC-BY compliance.
 *
 * Previous requests are aborted, results are de-duplicated and everything is
 * reported through a single `onState` callback so the UI stays dumb.
 */
import type { SearchResult, SearchState } from '../../app/state';
import { CONFIG } from '../../app/config';
import { isMobile } from '../../utils/device';
import { QueryParser, type ParsedQuery } from './QueryParser';
import { LocalIndexProvider } from './providers/LocalIndex';
import { PolyPizzaProvider } from './providers/PolyPizza';
import { SearchProvider, SearchQuotaError, SearchUnavailableError } from './providers/types';
import { ModelCache } from './ModelCache';
import { SemanticIndex, type SemanticStatus } from './SemanticIndex';

export type { SearchProvider } from './providers/types';

export interface ModelSearchOptions {
  onState: (patch: Partial<SearchState>) => void;
  lang?: () => string;
}

export class ModelSearch {
  private readonly parser = new QueryParser();
  private readonly local = new LocalIndexProvider();
  private readonly online: SearchProvider | null;
  private readonly cache = new ModelCache();
  private semantic: SemanticIndex | null = null;
  private controller: AbortController | null = null;
  private debounceTimer: number | null = null;
  private lastQuery = '';

  constructor(private readonly options: ModelSearchOptions) {
    this.online = CONFIG.features.search ? new PolyPizzaProvider() : null;
  }

  /** The offline index provider (exposed for local model listing). */
  get localProvider(): LocalIndexProvider {
    return this.local;
  }

  /** Cache facade used when loading a chosen model. */
  get modelCache(): ModelCache {
    return this.cache;
  }

  /** Voice input availability (Web Speech API, Chrome/Edge/Safari). */
  get voiceAvailable(): boolean {
    if (!CONFIG.features.voice) return false;
    const scope = window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown };
    return Boolean(scope.SpeechRecognition ?? scope.webkitSpeechRecognition);
  }

  /** Debounced search, safe to call on every keystroke. */
  search(query: string): void {
    this.lastQuery = query;
    if (this.debounceTimer !== null) window.clearTimeout(this.debounceTimer);
    this.debounceTimer = window.setTimeout(() => {
      this.debounceTimer = null;
      void this.run(query);
    }, CONFIG.search.debounceMs);
  }

  /** Runs a search immediately (Enter key / suggestion chip). */
  searchNow(query: string): void {
    if (this.debounceTimer !== null) window.clearTimeout(this.debounceTimer);
    this.debounceTimer = null;
    this.lastQuery = query;
    void this.run(query);
  }

  /** Cancels any in-flight request. */
  abort(): void {
    this.controller?.abort();
    this.controller = null;
  }

  /** Turns the optional semantic re-ranking on. */
  async enableSemantic(): Promise<boolean> {
    if (!CONFIG.features.semanticSearch) return false;
    if (!this.semantic) {
      this.semantic = new SemanticIndex((status: SemanticStatus) => {
        this.options.onState({
          semantic: status.ready,
          semanticProgress: status.progress,
        });
        if (status.error) {
          this.options.onState({ semantic: false, semanticProgress: 0 });
        }
      });
    }
    this.options.onState({ semanticProgress: 0.01 });
    const ready = await this.semantic.init();
    this.options.onState({ semantic: ready, semanticProgress: ready ? 1 : 0 });
    if (ready && this.lastQuery) void this.run(this.lastQuery);
    return ready;
  }

  /** Warm the worker in the background when the user opens the search sheet. */
  warmSemantic(): void {
    if (!CONFIG.features.semanticSearch) return;
    void this.enableSemantic();
  }

  /** Returns the cached payload for a result, downloading + caching on miss. */
  async fetchModel(
    result: SearchResult,
    onProgress?: (ratio: number | null) => void,
    signal?: AbortSignal,
  ): Promise<ArrayBuffer> {
    const cached = await this.cache.get(result.downloadUrl);
    if (cached) {
      await this.cache.putMeta(this.toMeta(result, cached.byteLength));
      return cached;
    }

    const response = await fetch(result.downloadUrl, { signal, mode: 'cors' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const declared = Number(response.headers.get('content-length') ?? '0');
    if (declared > CONFIG.search.maxDownloadBytes) throw new Error('model-too-large');

    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > CONFIG.search.maxDownloadBytes) throw new Error('model-too-large');

    onProgress?.(1);
    await this.cache.put(result.downloadUrl, buffer);
    await this.cache.putMeta(this.toMeta(result, buffer.byteLength));
    return buffer;
  }

  /** Credits for every model ever loaded (CC-BY compliance). */
  async credits() {
    return this.cache.listMeta();
  }

  dispose(): void {
    this.abort();
    if (this.debounceTimer !== null) window.clearTimeout(this.debounceTimer);
    this.semantic?.dispose();
    this.semantic = null;
  }

  // ---- internals -----------------------------------------------------------

  private async run(query: string): Promise<void> {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      this.options.onState({ query: trimmed, status: 'idle', results: [], errorKind: 'none' });
      return;
    }

    this.abort();
    const controller = new AbortController();
    this.controller = controller;
    this.options.onState({ query: trimmed, status: 'searching', errorKind: 'none' });

    const parsed: ParsedQuery = this.parser.parse(trimmed);
    const lang = this.options.lang?.() ?? 'en';

    const localResults = await this.local.search(parsed, controller.signal, lang);

    let onlineResults: SearchResult[] = [];
    let errorKind: SearchState['errorKind'] = 'none';
    let status: SearchState['status'] = 'done';

    if (this.online && !navigator.onLine) {
      errorKind = 'offline';
    } else if (this.online) {
      try {
        onlineResults = await this.online.search(parsed, controller.signal);
      } catch (err) {
        if ((err as { name?: string })?.name === 'AbortError') return;
        if (err instanceof SearchQuotaError) errorKind = 'quota';
        else if (err instanceof SearchUnavailableError) errorKind = 'error';
        else errorKind = 'error';
        status = localResults.length > 0 ? 'done' : 'error';
      }
    } else {
      errorKind = 'none';
    }

    if (controller.signal.aborted) return;

    let results = dedupe([...localResults, ...onlineResults]);

    if (results.length === 0 && errorKind === 'none') {
      // Fall back to the offline index with a looser match before giving up.
      const relaxed = this.parser.parse(parsed.terms.at(-1) ?? trimmed);
      results = await this.local.search(relaxed, controller.signal, lang);
      if (results.length === 0) status = 'done';
    }

    if (this.semantic?.isReady && results.length > 1) {
      const ranked = await this.semantic.rank(trimmed, results);
      if (ranked.length > 0) {
        const order = new Map(ranked.map((entry, index) => [entry.id, index]));
        results = [...results].sort(
          (a, b) => (order.get(a.id) ?? 999) - (order.get(b.id) ?? 999),
        );
      }
    }

    this.options.onState({
      query: trimmed,
      status,
      results,
      errorKind,
      voiceAvailable: this.voiceAvailable,
      semantic: this.semantic?.isReady ?? false,
    });
  }

  /** Builds the credit record stored in IndexedDB. */
  private toMeta(result: SearchResult, bytes: number) {
    return {
      id: result.id,
      title: result.title,
      author: result.author,
      license: result.license,
      sourceUrl: result.sourceUrl,
      provider: result.provider,
      thumbnail: result.thumbnail,
      triangles: result.triangles,
      bytes,
    };
  }
}

/** Removes duplicates while preserving order (local results win). */
function dedupe(results: SearchResult[]): SearchResult[] {
  const seen = new Set<string>();
  const out: SearchResult[] = [];
  for (const result of results) {
    const key = `${result.provider}:${result.title.toLowerCase()}:${result.author.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(result);
  }
  return out;
}

/** True when the device is likely too slow for heavy models. */
export const prefersLightModels = (): boolean => isMobile();
