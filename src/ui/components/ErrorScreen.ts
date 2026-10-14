/**
 * ErrorScreen — friendly, translated full-screen failures.
 *
 * Every camera/WebGL/target failure maps to a title, an explanation, an icon and
 * a recovery action (reload, retry or "get the marker"). Nothing technical is
 * shown unless the user opens the details disclosure.
 */
import { el, replace } from '../dom';
import { iconElement, type IconName } from '../icon';
import { t, type TranslationKey } from '../i18n';
import { button } from './controls';
import type { ErrorCode } from '../../app/state';
import { CONFIG } from '../../app/config';

interface ErrorCopy {
  icon: IconName;
  titleKey: TranslationKey;
  bodyKey: TranslationKey;
  action: 'reload' | 'retry' | 'marker';
}

const COPY: Record<ErrorCode, ErrorCopy> = {
  'camera-denied': {
    icon: 'CameraOff',
    titleKey: 'errors.cameraDeniedTitle',
    bodyKey: 'errors.cameraDenied',
    action: 'reload',
  },
  'camera-busy': {
    icon: 'CircleSlash',
    titleKey: 'errors.cameraBusyTitle',
    bodyKey: 'errors.cameraBusy',
    action: 'retry',
  },
  'no-camera': {
    icon: 'VideoOff',
    titleKey: 'errors.noCameraTitle',
    bodyKey: 'errors.noCamera',
    action: 'reload',
  },
  unsupported: {
    icon: 'TriangleAlert',
    titleKey: 'errors.unsupportedTitle',
    bodyKey: 'errors.unsupported',
    action: 'reload',
  },
  insecure: {
    icon: 'Lock',
    titleKey: 'errors.insecureTitle',
    bodyKey: 'errors.insecure',
    action: 'reload',
  },
  webgl: {
    icon: 'Box',
    titleKey: 'errors.webglTitle',
    bodyKey: 'errors.webgl',
    action: 'reload',
  },
  'target-missing': {
    icon: 'QrCode',
    titleKey: 'errors.targetMissingTitle',
    bodyKey: 'errors.targetMissing',
    action: 'marker',
  },
  'context-lost': {
    icon: 'RefreshCw',
    titleKey: 'errors.contextLostTitle',
    bodyKey: 'errors.contextLost',
    action: 'reload',
  },
  generic: {
    icon: 'CircleAlert',
    titleKey: 'errors.title',
    bodyKey: 'errors.generic',
    action: 'reload',
  },
};

export class ErrorScreen {
  readonly element: HTMLElement;
  private readonly icon: HTMLElement;
  private readonly title: HTMLElement;
  private readonly body: HTMLElement;
  private readonly actions: HTMLElement;
  private readonly details: HTMLDetailsElement;
  private readonly detailsCode: HTMLElement;
  private code: ErrorCode = 'generic';
  private readonly onRetry: () => void;
  private readonly onMarker: () => void;

  constructor(options: { onRetry: () => void; onMarker: () => void }) {
    this.onRetry = options.onRetry;
    this.onMarker = options.onMarker;

    this.icon = el('span', { class: 'error-screen__icon' });
    this.title = el('h1', { class: 'loader-screen__title' });
    this.body = el('p', { class: 'muted', attrs: { style: 'max-width:44ch' } });
    this.actions = el('div', { class: 'row', style: { justifyContent: 'center', flexWrap: 'wrap' } });
    this.detailsCode = el('code', { class: 'tiny' });
    const summary = el('summary', { class: 'tiny', text: t('errors.details') });
    this.details = document.createElement('details');
    this.details.style.marginTop = '8px';
    this.details.append(summary, this.detailsCode);

    this.element = el(
      'div',
      { class: 'error-screen', hidden: true },
      el(
        'div',
        { class: 'error-screen__card' },
        this.icon,
        this.title,
        this.body,
        this.actions,
        this.details,
      ),
    );
    this.setCode('generic');
  }

  /** Shows the screen for a given error code. */
  show(code: ErrorCode): void {
    this.setCode(code);
    this.element.hidden = false;
  }

  /** Hides the screen. */
  hide(): void {
    this.element.hidden = true;
  }

  /** Re-renders after a language change. */
  refresh(): void {
    this.setCode(this.code);
  }

  private setCode(code: ErrorCode): void {
    this.code = code;
    const copy = COPY[code] ?? COPY.generic;

    replace(this.icon, iconElement(copy.icon, { size: 28 }));
    replace(this.title, t(copy.titleKey));
    replace(this.body, t(copy.bodyKey));

    const primary = button({
      label: t(
        copy.action === 'marker' ? 'tutorial.getMarker' : copy.action === 'retry' ? 'errors.retry' : 'errors.reload',
      ),
      icon: copy.action === 'marker' ? 'QrCode' : 'RotateCw',
      variant: 'primary',
      onClick: () => {
        if (copy.action === 'marker') this.onMarker();
        else if (copy.action === 'retry') this.onRetry();
        else window.location.reload();
      },
    });

    this.detailsCode.textContent = `${code} • webgl: ${
      typeof WebGLRenderingContext !== 'undefined' ? 'ok' : 'missing'
    } • base: ${import.meta.env.BASE_URL} • ${CONFIG.brand.name}`;

    replace(
      this.actions,
      primary,
      copy.action === 'marker'
        ? button({
            label: t('errors.reload'),
            icon: 'RotateCw',
            onClick: () => window.location.reload(),
          })
        : null,
    );
  }
}
