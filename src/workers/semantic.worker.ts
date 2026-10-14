/**
 * semantic.worker.ts — optional, lazy multilingual embedding worker.
 *
 * It is only ever created when the user switches on "smart matching"
 * (`features.semanticSearch`). It downloads the multilingual MiniLM model once
 * (~30 MB), embeds the candidate documents and re-ranks them by cosine
 * similarity, so a Darija, Arabic or French phrase can find the right object.
 *
 * Runs entirely on-device; the query never leaves the browser.
 */

// Minimal worker typing so this file does not need the "webworker" lib.
interface WorkerScope {
  postMessage: (message: unknown) => void;
  onmessage: ((event: MessageEvent) => void) | null;
}
const ctx = self as unknown as WorkerScope;

interface RankItem {
  id: string;
  text: string;
}

type InboundMessage =
  | { type: 'warmup' }
  | { type: 'rank'; query: string; documents: RankItem[] };

type OutboundMessage =
  | { type: 'progress'; progress: number }
  | { type: 'ready'; vectors: number }
  | { type: 'results'; query: string; ranked: { id: string; score: number }[] }
  | { type: 'error'; message: string };

const MODEL_ID = 'Xenova/paraphrase-multilingual-MiniLM-L12-v2';

type Extractor = (
  text: string | string[],
  options: { pooling: 'mean'; normalize: boolean },
) => Promise<{ data: Float32Array; dims: number[] }>;

let extractor: Extractor | null = null;
let initPromise: Promise<void> | null = null;
const vectors = new Map<string, Float32Array>();

async function init(): Promise<void> {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const mod = (await import('@xenova/transformers')) as unknown as {
      pipeline: (
        task: string,
        model: string,
        options: Record<string, unknown>,
      ) => Promise<Extractor>;
      env: Record<string, unknown>;
    };
    // Never probe the local filesystem; use the browser HTTP cache instead.
    mod.env.allowLocalModels = false;
    mod.env.useBrowserCache = true;

    extractor = await mod.pipeline('feature-extraction', MODEL_ID, {
      progress_callback: (report: { status?: string; progress?: number }) => {
        if (report?.status === 'progress' && typeof report.progress === 'number') {
          post({ type: 'progress', progress: Math.max(0, Math.min(1, report.progress / 100)) });
        }
      },
    });

    post({ type: 'ready', vectors: vectors.size });
  })().catch((err: unknown) => {
    initPromise = null;
    post({ type: 'error', message: (err as Error)?.message ?? 'init-failed' });
    throw err;
  });
  return initPromise;
}

async function embed(text: string): Promise<Float32Array | null> {
  if (!extractor) return null;
  const output = await extractor(text, { pooling: 'mean', normalize: true });
  return output.data;
}

function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  const length = Math.min(a.length, b.length);
  for (let i = 0; i < length; i += 1) dot += (a[i] ?? 0) * (b[i] ?? 0);
  // Both vectors are L2-normalised by the pipeline, so the dot product is cosine.
  return dot;
}

async function rank(query: string, documents: RankItem[]): Promise<void> {
  await init();

  const queryVector = await embed(query);
  if (!queryVector) {
    post({ type: 'error', message: 'no-extractor' });
    return;
  }

  const ranked: { id: string; score: number }[] = [];
  for (const document of documents) {
    const key = `${document.id}:${document.text}`;
    let vector = vectors.get(key);
    if (!vector) {
      const embedded = await embed(document.text);
      if (!embedded) continue;
      vector = embedded;
      vectors.set(key, vector);
    }
    ranked.push({ id: document.id, score: cosine(queryVector, vector) });
  }

  ranked.sort((a, b) => b.score - a.score);
  post({ type: 'results', query, ranked });
}

function post(message: OutboundMessage): void {
  ctx.postMessage(message);
}

ctx.onmessage = (event: MessageEvent) => {
  const message = event.data as InboundMessage;
  if (!message || typeof message !== 'object') return;

  switch (message.type) {
    case 'warmup':
      void init().catch(() => undefined);
      break;
    case 'rank':
      void rank(String(message.query ?? ''), Array.isArray(message.documents) ? message.documents : []).catch(
        (err: unknown) => post({ type: 'error', message: (err as Error)?.message ?? 'rank-failed' }),
      );
      break;
    default:
      break;
  }
};
