/**
 * SemanticIndex — OPTIONAL semantic re-ranking of search results.
 *
 * Off by default (`features.semanticSearch`). When enabled, it lazily spins up a
 * Web Worker that loads Transformers.js with the multilingual MiniLM embedding
 * model (~30 MB, downloaded once and cached by the browser), embeds the bundled
 * local index and re-ranks the query by cosine similarity. This is what lets
 * "bghit chi haja tayer" find the rocket.
 *
 * The worker bundle is only fetched when the feature is switched on, so the base
 * app never pays for it. If the optional dependency is not installed the feature
 * reports itself unavailable instead of failing.
 */
import type { SearchResult } from '../../app/state';

export interface SemanticRanked {
  id: string;
  score: number;
}

export interface SemanticStatus {
  available: boolean;
  ready: boolean;
  progress: number;
  error: string | null;
}

type WorkerResponse =
  | { type: 'progress'; progress: number }
  | { type: 'ready'; vectors: number }
  | { type: 'results'; query: string; ranked: SemanticRanked[] }
  | { type: 'error'; message: string };

export class SemanticIndex {
  private worker: Worker | null = null;
  private ready = false;
  private unavailable = false;
  private progress = 0;
  private error: string | null = null;
  private pending = new Map<string, (ranked: SemanticRanked[]) => void>();

  constructor(private readonly onStatus?: (status: SemanticStatus) => void) {}

  get isReady(): boolean {
    return this.ready;
  }

  get isUnavailable(): boolean {
    return this.unavailable;
  }

  /** Loads the worker + model. Safe to call repeatedly. */
  async init(): Promise<boolean> {
    if (this.ready) return true;
    if (this.unavailable) return false;

    try {
      // Vite resolves this to a separate chunk, fetched only on first use.
      const worker = new Worker(new URL('../../workers/semantic.worker.ts', import.meta.url), {
        type: 'module',
      });
      this.worker = worker;
      worker.onmessage = (event: MessageEvent<WorkerResponse>) => this.handleMessage(event.data);
      worker.onerror = () => this.fail('worker-error');

      return await new Promise<boolean>((resolve) => {
        const timeout = window.setTimeout(() => {
          this.fail('timeout');
          resolve(false);
        }, 120_000);

        const onReady = (event: MessageEvent<WorkerResponse>) => {
          if (event.data.type === 'ready') {
            window.clearTimeout(timeout);
            worker.removeEventListener('message', onReady);
            resolve(true);
          }
        };
        worker.addEventListener('message', onReady);
      });
    } catch (err) {
      this.fail((err as Error).message);
      return false;
    }
  }

  /** Re-ranks candidate ids against a free-text query. */
  rank(query: string, candidates: SearchResult[]): Promise<SemanticRanked[]> {
    if (!this.ready || !this.worker) return Promise.resolve([]);
    const key = `${Date.now()}-${Math.random()}`;
    return new Promise((resolve) => {
      this.pending.set(key, resolve);
      this.worker?.postMessage({
        type: 'rank',
        query,
        documents: candidates.map((candidate) => ({
          id: candidate.id,
          text: `${candidate.title} ${candidate.provider}`,
        })),
      });
      // Never leave a caller hanging.
      window.setTimeout(() => {
        if (this.pending.delete(key)) resolve([]);
      }, 8000);
    });
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    this.ready = false;
    this.pending.clear();
  }

  private handleMessage(message: WorkerResponse): void {
    switch (message.type) {
      case 'progress':
        this.progress = message.progress;
        this.emit();
        break;
      case 'ready':
        this.ready = true;
        this.progress = 1;
        this.emit();
        break;
      case 'results': {
        // Resolve every waiter with the latest ranking (single in-flight query).
        for (const [key, resolve] of this.pending) {
          this.pending.delete(key);
          resolve(message.ranked);
        }
        break;
      }
      case 'error':
        this.fail(message.message);
        break;
      default:
        break;
    }
  }

  private fail(message: string): void {
    this.error = message;
    this.unavailable = true;
    this.emit();
  }

  private emit(): void {
    this.onStatus?.({
      available: !this.unavailable,
      ready: this.ready,
      progress: this.progress,
      error: this.error,
    });
  }
}
