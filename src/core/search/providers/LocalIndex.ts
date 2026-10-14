/**
 * LocalIndex — the offline-first provider.
 *
 * Ships as a bundled JSON index (no network call to list models) with tags in
 * English, French, Arabic and Darija. The GLBs themselves are lazy-loaded from a
 * free, CORS-enabled host and then cached by ModelCache, so the second use is
 * instant and works offline.
 */
import Fuse from 'fuse.js';
import localIndex from '../local-index.json';
import type { SearchResult } from '../../../app/state';
import type { ParsedQuery } from '../QueryParser';
import { normalizeText } from '../QueryParser';
import type { SearchProvider } from './types';

interface LocalEntry {
  id: string;
  title: { en: string; fr: string; ar: string };
  author: string;
  license: string;
  sourceUrl: string;
  glb: string;
  thumbnail?: string;
  animated?: boolean;
  tags: string[];
}

interface IndexFile {
  version: number;
  attribution: string;
  models: LocalEntry[];
}

const data = localIndex as IndexFile;

/** Flattens an entry into a searchable document. */
function toDocument(entry: LocalEntry): { entry: LocalEntry; haystack: string } {
  const words = [
    entry.title.en,
    entry.title.fr,
    entry.title.ar,
    ...entry.tags,
  ].map(normalizeText);
  return { entry, haystack: words.join(' ') };
}

const documents = data.models.map(toDocument);

const fuse = new Fuse(documents, {
  keys: ['haystack'],
  includeScore: true,
  threshold: 0.4,
  ignoreLocation: true,
  minMatchCharLength: 2,
});

/** Localised title for the active UI language. */
function titleFor(entry: LocalEntry, lang: string): string {
  if (lang.startsWith('ar')) return entry.title.ar;
  if (lang.startsWith('fr')) return entry.title.fr;
  return entry.title.en;
}

export class LocalIndexProvider implements SearchProvider {
  readonly name = 'local';
  readonly label = 'Built-in library';

  /** The bundled attribution string, surfaced in the credits modal. */
  get attribution(): string {
    return data.attribution;
  }

  /** How many models ship in the index. */
  get size(): number {
    return data.models.length;
  }

  async search(query: ParsedQuery, _signal?: AbortSignal, lang = 'en'): Promise<SearchResult[]> {
    const needle = query.english ?? query.terms.join(' ');
    const normalizedNeedle = normalizeText(needle);
    if (!normalizedNeedle) return [];

    const scored = new Map<string, { entry: LocalEntry; score: number }>();

    for (const document of documents) {
      let score = 0;
      if (document.haystack.includes(normalizedNeedle)) score += 1;
      const results = fuse.search(normalizedNeedle, { limit: 8 });
      for (const result of results) {
        if (result.item.entry.id !== document.entry.id) continue;
        score = Math.max(score, 0.7 - (result.score ?? 0.7) * 0.5);
      }
      if (score > 0) scored.set(document.entry.id, { entry: document.entry, score });
    }

    return [...scored.values()]
      .sort((a, b) => b.score - a.score)
      .slice(0, 12)
      .map(({ entry, score }) => this.toResult(entry, lang, score));
  }

  /** Converts an index entry into the provider-agnostic result shape. */
  private toResult(entry: LocalEntry, lang: string, score: number): SearchResult & { score?: number } {
    return {
      id: entry.id,
      title: titleFor(entry, lang),
      author: entry.author,
      license: entry.license,
      sourceUrl: entry.sourceUrl,
      provider: this.name,
      thumbnail: entry.thumbnail,
      downloadUrl: entry.glb,
      format: 'glb',
      score,
    };
  }
}
