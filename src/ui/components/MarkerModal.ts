/**
 * MarkerModal — "Get the marker".
 *
 * The user can download the printable A4 sheet or the square marker, or show the
 * marker full-screen on a second device so they can start tracking immediately.
 */
import { el } from '../dom';
import { iconElement } from '../icon';
import { t } from '../i18n';
import { button } from './controls';
import { Modal } from './Modal';
import { CONFIG } from '../../app/config';
import { assetUrl } from '../../utils/assets';
import { downloadBlob } from '../../core/capture/Snapshot';

export interface MarkerModalOptions {
  onClose: () => void;
}

export class MarkerModal {
  readonly element: HTMLElement;

  constructor(options: MarkerModalOptions) {
    const markerUrl = assetUrl(CONFIG.urls.markerPng);
    const sheetUrl = assetUrl(CONFIG.urls.markerA4);

    const preview = el('img', {
      class: 'marker-preview',
      attrs: { src: markerUrl, alt: t('tutorial.getMarker'), loading: 'lazy' },
    });

    const body = el(
      'div',
      { class: 'stack' },
      el('p', { class: 'muted', text: t('tutorial.step1Body') }),
      preview,
      el(
        'div',
        { class: 'stack', style: { gap: 'var(--space-2)' } },
        button({
          label: t('tutorial.downloadMarker'),
          icon: 'Download',
          variant: 'primary',
          block: true,
          onClick: () => void download(sheetUrl, 'webar-marker-a4.png'),
        }),
        button({
          label: t('objects.import'),
          icon: 'Image',
          block: true,
          onClick: () => void download(markerUrl, 'webar-marker.png'),
        }),
        button({
          label: t('tutorial.showOnScreen'),
          icon: 'Monitor',
          block: true,
          onClick: () => showFullscreen(markerUrl),
        }),
      ),
      el(
        'p',
        { class: 'tiny' },
        el('span', { text: t('tutorial.step2Body') }),
      ),
    );

    const modal = new Modal({
      title: t('tutorial.getMarker'),
      body,
      footer: button({ label: t('common.close'), icon: 'X', onClick: options.onClose }),
      onClose: options.onClose,
    });
    this.element = modal.element;
    void iconElement;
  }
}

/** Downloads an asset, falling back to opening it in a new tab. */
async function download(url: string, filename: string): Promise<void> {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const blob = await response.blob();
    downloadBlob(blob, filename);
  } catch {
    window.open(url, '_blank', 'noopener');
  }
}

/** Opens the marker full-screen and requests the lock in landscape. */
async function showFullscreen(url: string): Promise<void> {
  const overlay = el(
    'div',
    {
      style: {
        position: 'fixed',
        inset: '0',
        zIndex: '200',
        background: '#fff',
        display: 'grid',
        placeItems: 'center',
        padding: '4vmin',
      },
      on: { click: () => void document.exitFullscreen?.().catch(() => undefined) },
    },
    el('img', { attrs: { src: url, alt: '', style: 'max-width:100%;max-height:100%' } }),
  );
  document.body.appendChild(overlay);
  try {
    await overlay.requestFullscreen?.();
  } catch {
    /* fullscreen optional */
  }
  document.addEventListener('fullscreenchange', function handler() {
    if (!document.fullscreenElement) {
      overlay.remove();
      document.removeEventListener('fullscreenchange', handler);
    }
  });
}
