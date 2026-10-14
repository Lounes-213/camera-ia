/**
 * Theme manager: light / dark / system with persistence and live system
 * tracking. It writes `data-theme` on <html>, which the CSS tokens react to, and
 * exposes a tiny subscribe API so components can re-render icons.
 */
import { storage } from '../../utils/storage';
import { createStore } from '../../app/store';

export type ThemeMode = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

const MODES: readonly ThemeMode[] = ['light', 'dark', 'system'] as const;
const isMode = (v: unknown): v is ThemeMode => MODES.includes(v as ThemeMode);

interface ThemeState {
  mode: ThemeMode;
  resolved: ResolvedTheme;
}

const media =
  typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)') : null;

const storedMode = storage.load<string | null>('theme', null);

const store = createStore<ThemeState>(
  {
    mode: isMode(storedMode) ? storedMode : 'system',
    resolved: media?.matches ? 'dark' : 'light',
  },
  'theme',
);

/** Resolves a mode to the concrete theme actually applied. */
function resolve(mode: ThemeMode): ResolvedTheme {
  if (mode === 'system') return media?.matches ? 'dark' : 'light';
  return mode;
}

function apply(): void {
  const { mode } = store.getState();
  const resolved = resolve(mode);
  const root = document.documentElement;
  root.dataset.theme = resolved;
  root.style.colorScheme = resolved;
  // Lets the browser tint form controls & the address bar.
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta) meta.content = resolved === 'dark' ? '#0e0b09' : '#ffffff';
  store.setState({ resolved });
}

/** Current resolved theme. */
export const getResolvedTheme = (): ResolvedTheme => store.getState().resolved;

/** Current user preference (may be 'system'). */
export const getThemeMode = (): ThemeMode => store.getState().mode;

/** Sets the theme mode explicitly and persists it. */
export function setThemeMode(mode: ThemeMode): void {
  storage.save('theme', mode);
  store.setState({ mode });
  apply();
}

/** Cycles light → dark → system. Returns the new mode. */
export function cycleTheme(): ThemeMode {
  const order: ThemeMode[] = ['light', 'dark', 'system'];
  const index = order.indexOf(store.getState().mode);
  const next = order[(index + 1) % order.length] ?? 'system';
  setThemeMode(next);
  return next;
}

/** Subscribes to resolved-theme changes. */
export function onThemeChange(listener: (theme: ResolvedTheme) => void): () => void {
  return store.watch(
    (s) => s.resolved,
    (theme) => listener(theme),
  );
}

/** Initialises the manager; call once at bootstrap. */
export function initTheme(): void {
  apply();
  media?.addEventListener?.('change', () => {
    if (store.getState().mode === 'system') apply();
  });
}
