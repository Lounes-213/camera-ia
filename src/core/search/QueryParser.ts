/**
 * QueryParser — turns free text in English, French, Arabic or Darija
 * (both Arabic script and Latin transliteration) into a canonical English
 * object name, without any paid LLM.
 *
 * Pipeline: normalise → strip filler words → detect language → exact dictionary
 * hit → fuzzy dictionary hit (Fuse.js). Everything is pure so it is unit-tested.
 */
import Fuse from 'fuse.js';
import dictionary from './dictionary.json';

export type QueryLang = 'en' | 'fr' | 'ar' | 'darija' | 'unknown';

export interface ParsedQuery {
  /** The raw user input. */
  original: string;
  /** Normalised (lowercase, accent- and diacritic-free) input. */
  normalized: string;
  /** Detected language of the input. */
  lang: QueryLang;
  /** Meaningful words after filler removal. */
  terms: string[];
  /** Canonical English concept, when the dictionary recognises it. */
  english: string | null;
  /** 0..1 confidence of the dictionary hit. */
  confidence: number;
  /** The string to send to online providers. */
  providerQuery: string;
  /** True when the concept came from the bundled dictionary. */
  fromDictionary: boolean;
}

type Dictionary = Record<string, { fr?: string[]; ar?: string[]; darija?: string[] }>;

const FILLERS: Record<Exclude<QueryLang, 'unknown'>, string[]> = {
  en: [
    'i want',
    'i would like',
    'give me',
    'show me',
    'can you',
    'please',
    'a',
    'an',
    'the',
    'some',
    'me',
    'want',
    'need',
    'add',
    'object',
    'model',
    'of',
    'to',
    'my',
  ],
  fr: [
    'je veux',
    'je voudrais',
    'donne moi',
    'donne-moi',
    'montre moi',
    'montre-moi',
    "s'il te plait",
    'sil te plait',
    'svp',
    'un',
    'une',
    'des',
    'le',
    'la',
    'les',
    'du',
    'de',
    'moi',
    'veux',
    'voudrais',
    'ajoute',
    'objet',
    'modele',
    'modèle',
    'pour',
    'avec',
    'et',
  ],
  ar: [
    'اريد',
    'أريد',
    'اعطني',
    'أعطني',
    'عطيني',
    'من فضلك',
    'لو سمحت',
    'هل',
    'يمكن',
    'لي',
    'شي',
    'كائن',
    'مجسم',
    'واحد',
    'بغيت',
    'بغيتي',
    'عايز',
    'بدي',
  ],
  darija: ['bghit', 'bghiti', '3tini', 'a3tini', '3afak', 'chwiya', 'wa7ed', 'wahd', 'sir', 'ji'],
};

/**
 * Diacritic + Arabic normalisation so "فُسْتان", "فستان" and "fustan" all match.
 *
 * NFKD first so that accented Latin letters and hamza-bearing Arabic letters
 * decompose into a base letter plus a combining mark, then every combining mark
 * is dropped in one pass — that covers Latin accents and Arabic tashkeel alike
 * (Arabic marks are Mn, not in the Latin combining range).
 */
export function normalizeText(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKD')
    // Strip every combining mark (Latin accents + Arabic harakat + hamza forms).
    .replace(/\p{M}/gu, '')
    // Arabic letter variants.
    .replace(/[\u0623\u0625\u0622\u0671]/g, '\u0627') // أ إ آ ٱ → ا
    .replace(/\u0649/g, '\u064a') // ى → ي
    .replace(/\u0629/g, '\u0647') // ة → ه
    .replace(/\u0624/g, '\u0648') // ؤ → و
    .replace(/\u0626/g, '\u064a') // ئ → ي
    // Remove tashkeel and tatweel.
    .replace(/[\u064b-\u0652\u0670\u0640]/g, '')
    .replace(/[^\p{L}\p{N}\s'-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Detects the query language from script and stop-words. */
export function detectQueryLang(input: string): QueryLang {
  const text = input.toLowerCase();
  if (/[\u0600-\u06ff]/.test(text)) return 'ar';
  if (FILLERS.darija.some((word) => text.includes(word))) return 'darija';
  const frenchMarkers = [
    'je',
    'veux',
    'un ',
    'une ',
    'des ',
    'le ',
    'la ',
    'les ',
    'avec',
    'pour',
    'modele',
    'modèle',
    'donne',
    'montre',
    'belle',
    'joli',
  ];
  if (frenchMarkers.some((marker) => text.includes(marker))) return 'fr';
  if (/[éèêëàâäùûüôöîïç]/.test(text)) return 'fr';
  return 'en';
}

/** Removes filler/stop words while keeping the meaningful nouns. */
export function stripFillers(input: string, lang: QueryLang): string {
  let text = ` ${normalizeText(input)} `;
  const fillers = lang === 'unknown' ? [...FILLERS.en, ...FILLERS.fr] : FILLERS[lang];
  for (const filler of fillers) {
    const normalized = normalizeText(filler);
    if (!normalized) continue;
    text = text.replace(new RegExp(`(?<=[\\s-])${escapeRegExp(normalized)}(?=[\\s-])`, 'g'), ' ');
  }
  return text.replace(/\s+/g, ' ').trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---- Dictionary index ------------------------------------------------------

interface ReverseEntry {
  normalized: string;
  english: string;
  lang: QueryLang;
}

function buildIndex(): ReverseEntry[] {
  const entries: ReverseEntry[] = [];
  const dict = dictionary as Dictionary;
  for (const [english, translations] of Object.entries(dict)) {
    entries.push({ normalized: normalizeText(english), english, lang: 'en' });
    for (const lang of ['fr', 'ar', 'darija'] as const) {
      for (const word of translations[lang] ?? []) {
        const normalized = normalizeText(word);
        if (normalized) entries.push({ normalized, english, lang });
      }
    }
  }
  return entries;
}

const INDEX = buildIndex();
const EXACT = new Map<string, ReverseEntry>();
for (const entry of INDEX) {
  if (!EXACT.has(entry.normalized)) EXACT.set(entry.normalized, entry);
}

const fuse = new Fuse(INDEX, {
  keys: ['normalized'],
  includeScore: true,
  threshold: 0.34,
  ignoreLocation: true,
  minMatchCharLength: 3,
});

/** Looks up one word in the dictionary (exact, then fuzzy). */
export function translateToEnglish(
  term: string,
  lang: QueryLang = 'unknown',
): { english: string | null; confidence: number } {
  const normalized = normalizeText(term);
  if (!normalized) return { english: null, confidence: 0 };

  const exact = EXACT.get(normalized);
  if (exact) {
    // Prefer a hit in the language the user actually wrote in.
    return { english: exact.english, confidence: lang === exact.lang ? 1 : 0.95 };
  }

  const results = fuse.search(normalized, { limit: 1 });
  const best = results[0];
  if (!best?.item) return { english: null, confidence: 0 };

  // Fuse's bitap matcher is generous with short strings ("mchat" would score
  // against "armchair"). Require the candidate to be a plausible typo of the
  // shorter of the two words before accepting a fuzzy hit.
  const candidate = best.item.normalized;
  const lengthDelta = Math.abs(candidate.length - normalized.length);
  const allowed = Math.max(2, Math.floor(Math.max(candidate.length, normalized.length) * 0.34));
  if (lengthDelta > allowed) return { english: null, confidence: 0 };

  const score = typeof best.score === 'number' ? best.score : 1;
  return { english: best.item.english, confidence: Math.max(0, 1 - score) };
}

/** Popular suggestion chips shown in the search sheet. */
export const SUGGESTIONS: readonly string[] = [
  'rocket',
  'cat',
  'car',
  'tree',
  'house',
  'robot',
  'duck',
  'flower',
  'dragon',
  'diamond',
] as const;

export class QueryParser {
  /** Parses a raw query into a canonical, provider-ready description. */
  parse(input: string): ParsedQuery {
    const original = input ?? '';
    const lang = detectQueryLang(original);
    const stripped = stripFillers(original, lang);
    const terms = (stripped || normalizeText(original)).split(' ').filter(Boolean);

    let english: string | null = null;
    let confidence = 0;
    let fromDictionary = false;

    // Try the whole phrase first (handles "tasse de café"), then each word.
    const phrase = translateToEnglish(terms.join(' '), lang);
    if (phrase.english && phrase.confidence > 0.5) {
      english = phrase.english;
      confidence = phrase.confidence;
      fromDictionary = true;
    } else {
      for (const term of terms) {
        const hit = translateToEnglish(term, lang);
        if (hit.english && hit.confidence > confidence) {
          english = hit.english;
          confidence = hit.confidence;
          fromDictionary = true;
        }
      }
    }

    return {
      original,
      normalized: normalizeText(original),
      lang,
      terms,
      english,
      confidence,
      providerQuery: english ?? terms.join(' ') ?? '',
      fromDictionary,
    };
  }
}
