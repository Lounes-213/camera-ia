/**
 * Device / capability detection. Every check is defensive: SSR-less browsers,
 * old Safari and exotic WebViews should all degrade gracefully.
 */

export const isTouch = (): boolean =>
  typeof window !== 'undefined' &&
  ('ontouchstart' in window || (navigator.maxTouchPoints ?? 0) > 0);

export const isIOS = (): boolean => {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  return (
    /iPad|iPhone|iPod/.test(ua) ||
    // iPadOS 13+ reports as Macintosh but has touch points.
    (navigator.platform === 'MacIntel' && (navigator.maxTouchPoints ?? 0) > 1)
  );
};

export const isAndroid = (): boolean => /Android/i.test(navigator.userAgent ?? '');

export const isSafari = (): boolean =>
  typeof navigator !== 'undefined' &&
  /^((?!chrome|android|crios|fxios).)*safari/i.test(navigator.userAgent);

export const isFirefox = (): boolean => /Firefox|FxiOS/i.test(navigator.userAgent ?? '');

export const isMobile = (): boolean =>
  isIOS() || isAndroid() || /Mobi|Tablet/i.test(navigator.userAgent ?? '');

/** True when the viewport is phone-sized (bottom-sheet layout). */
export const isPhoneLayout = (): boolean =>
  typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches;

export const isDesktopLayout = (): boolean =>
  typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches;

export const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export const prefersDarkScheme = (): boolean =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;

/** Whether the browser can access a camera at all. */
export const supportsCamera = (): boolean =>
  typeof navigator !== 'undefined' &&
  typeof navigator.mediaDevices?.getUserMedia === 'function' &&
  (typeof window !== 'undefined' && window.isSecureContext);

/** WebGL availability (used to show a friendly error instead of a white screen). */
export function supportsWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(
      canvas.getContext('webgl2') ??
        canvas.getContext('webgl') ??
        canvas.getContext('experimental-webgl'),
    );
  } catch {
    return false;
  }
}

/** Heuristic: weak device → lower quality defaults. */
export function isLowPowerDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  const cores = navigator.hardwareConcurrency ?? 4;
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4;
  return cores <= 4 || memory <= 3;
}

/** Number of logical processors (fallback 4). */
export const hardwareConcurrency = (): number => navigator.hardwareConcurrency ?? 4;

/** Navigator.language, e.g. "ar-MA" → "ar". */
export function detectLanguage(): string {
  const langs = [navigator.language, ...(navigator.languages ?? [])];
  for (const lang of langs) {
    if (lang) return lang.slice(0, 2).toLowerCase();
  }
  return 'en';
}

/** Best-effort vibration feedback (no-op where unsupported / reduced motion). */
export function haptic(pattern: number | number[] = 12): void {
  if (prefersReducedMotion()) return;
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* ignore */
  }
}

/** True when the Web Share API can share files (mobile snapshot sharing). */
export function canShareFiles(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.canShare === 'function';
}

/** Which pointer model the input layer should use. */
export type PointerMode = 'mouse' | 'touch';
export const pointerMode = (): PointerMode => (isTouch() ? 'touch' : 'mouse');
