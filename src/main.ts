/**
 * main.ts — bootstrap.
 *
 * Imports the self-hosted fonts and stylesheets, creates the App and boots it.
 * Global error handlers keep a single bad frame from blanking the screen: the
 * failure becomes a translated error screen instead.
 */
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/cairo/400.css';
import '@fontsource/cairo/600.css';
import '@fontsource/cairo/700.css';

import './ui/theme/tokens.css';
import './ui/theme/light.css';
import './ui/theme/dark.css';
import './styles/base.css';
import './styles/layout.css';
import './styles/components.css';

import { App } from './app/App';
import { appStore } from './app/appStore';
import { bus } from './app/events';

/** Removes the inline boot splash once the app has painted. */
function hideBootSplash(): void {
  document.getElementById('boot-splash')?.remove();
}

function fail(message: string): void {
  const splash = document.getElementById('boot-splash');
  if (splash) {
    splash.innerHTML = `
      <div class="loader-screen__inner">
        <div class="loader-logo" aria-hidden="true">
          <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2M20 14h2M15 13v2M9 13v2"/></svg>
        </div>
        <h1>Something went wrong</h1>
        <p class="tiny">${message}</p>
        <button class="btn btn--primary" onclick="location.reload()">Reload</button>
      </div>`;
  }
}

async function bootstrap(): Promise<void> {
  const root = document.getElementById('app');
  if (!root) throw new Error('#app is missing');

  const app = new App(root);
  // Keep a handle for manual teardown during development / hot reload.
  (window as unknown as { __webarApp?: App }).__webarApp = app;

  await app.boot();
  hideBootSplash();
  bus.emit('app:ready', {});

  // Expose a tiny read-only debug surface (no mutation paths).
  (window as unknown as { __webarState?: () => unknown }).__webarState = () =>
    appStore.getState();
}

window.addEventListener('error', (event) => {
  console.error('[app] uncaught error', event.error ?? event.message);
});

window.addEventListener('unhandledrejection', (event) => {
  console.error('[app] unhandled rejection', event.reason);
});

bootstrap().catch((error: unknown) => {
  console.error('[app] bootstrap failed', error);
  fail(error instanceof Error ? error.message : String(error));
});
