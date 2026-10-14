/**
 * Lightweight i18n module.
 *
 * - `en.json` is the source of truth; its flattened keys become the
 *   compile-time `TranslationKey` union, so `t()` is fully typed.
 * - Other locales are typed as loose records and fall back to English per key.
 * - Supports `{placeholder}` interpolation.
 * - Applies `<html lang>`/`dir` and notifies subscribers for instant switching.
 */
import en from './en.json';
import fr from './fr.json';
import ar from './ar.json';
import { detectLanguage } from '../../utils/device';
import { storage } from '../../utils/storage';
import { createStore } from '../../app/store';

export type Lang = 'en' | 'fr' | 'ar';
export const LANGS: readonly Lang[] = ['en', 'fr', 'ar'] as const;
export const RTL_LANGS: readonly Lang[] = ['ar'];

export const LANG_LABELS: Record<Lang, string> = {
  en: 'English',
  fr: 'Français',
  ar: 'العربية',
};

type Json = { [key: string]: string | Json };

/** Flattens a nested JSON object into dot-notation keys. */
function flatten(obj: Json, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') out[path] = value;
    else Object.assign(out, flatten(value, path));
  }
  return out;
}

const catalogs: Record<Lang, Record<string, string>> = {
  en: flatten(en as Json),
  fr: flatten(fr as Json),
  ar: flatten(ar as Json),
};

export type TranslationKey = keyof typeof catalogs.en & string;

export interface I18nState {
  lang: Lang;
  /** Bumped on every change so subscribers re-render. */
  version: number;
}

const isLang = (value: unknown): value is Lang => LANGS.includes(value as Lang);

/** Picks the initial language: stored → navigator → English. */
function initialLang(): Lang {
  const stored = storage.load<string | null>('lang', null);
  if (isLang(stored)) return stored;
  const detected = detectLanguage();
  return isLang(detected) ? detected : 'en';
}

const store = createStore<I18nState>({ lang: initialLang(), version: 0 }, 'i18n');

/** Current language code. */
export const getLang = (): Lang => store.getState().lang;

/** True when the current language is right-to-left. */
export const isRTL = (lang: Lang = getLang()): boolean => RTL_LANGS.includes(lang);

/** Subscribes to language changes. */
export function onLanguageChange(listener: (lang: Lang) => void): () => void {
  return store.watch(
    (s) => s.lang,
    (lang) => listener(lang),
  );
}

/**
 * Translates a key with optional `{placeholder}` values.
 * Falls back to English, then to the raw key (visible but never crashing).
 */
export function t(key: TranslationKey, vars?: Record<string, string | number>): string {
  const lang = getLang();
  const template = catalogs[lang][key] ?? catalogs.en[key] ?? key;
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, name: string) =>
    name in vars ? String(vars[name]) : `{${name}}`,
  );
}

/** Applies `lang`/`dir` to the document element. */
function applyDocument(lang: Lang): void {
  const root = document.documentElement;
  root.lang = lang;
  root.dir = isRTL(lang) ? 'rtl' : 'ltr';
  root.dataset.lang = lang;
}

/** Switches language, persists it and updates the document. */
export function setLang(lang: Lang): void {
  if (store.getState().lang === lang) return;
  storage.save('lang', lang);
  applyDocument(lang);
  store.setState((prev) => ({ lang, version: prev.version + 1 }));
}

/** Cycles to the next language (used by the L shortcut). */
export function cycleLang(): Lang {
  const index = LANGS.indexOf(getLang());
  const next = LANGS[(index + 1) % LANGS.length] ?? 'en';
  setLang(next);
  return next;
}

/** Runs `render` now and again whenever the language changes. */
export function bindTranslations(render: () => void, onLang?: (lang: Lang) => void): () => void {
  render();
  return onLanguageChange((lang) => {
    onLang?.(lang);
    render();
  });
}

/** Initialises the module; call once at bootstrap. */
export function initI18n(): void {
  applyDocument(getLang());
}

/** Number formatting consistent with the active language. */
export function formatNumber(value: number, fractionDigits = 0): string {
  try {
    return new Intl.NumberFormat(getLang(), {
      maximumFractionDigits: fractionDigits,
      minimumFractionDigits: fractionDigits,
    }).format(value);
  } catch {
    return value.toFixed(fractionDigits);
  }
}
