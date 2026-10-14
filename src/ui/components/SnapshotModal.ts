/**
 * SnapshotModal — the shutter preview with download and share.
 * Uses the Web Share API when the platform supports sharing files (mobile) and
 * always offers a direct download as the fallback.
 */
import { el } from '../dom';
import { t } from '../i18n';
import { button } from './controls';
import { Modal } from './Modal';
import { downloadBlob } from '../../core/capture/Snapshot';

export interface SnapshotModalOptions {
  dataUrl: string;
  blob: Blob;
  onShare: (blob: Blob, dataUrl: string) => void;
  onClose: () => void;
}

export class SnapshotModal {
  readonly element: HTMLElement;

  constructor(options: SnapshotModalOptions) {
    const preview = el('div', { class: 'snapshot-preview' });
    preview.appendChild(el('img', { attrs: { src: options.dataUrl, alt: t('export.snapshot') } }));

    const body = el(
      'div',
      { class: 'stack' },
      preview,
      el('p', { class: 'tiny', text: t('export.snapshotDone') }),
    );

    const footer = el(
      'div',
      { class: 'row', style: { width: '100%', justifyContent: 'flex-end', flexWrap: 'wrap' } },
      button({
        label: t('export.download'),
        icon: 'Download',
        variant: 'primary',
        onClick: () => downloadBlob(options.blob, `webar-${Date.now()}.jpg`),
      }),
      button({
        label: t('export.share'),
        icon: 'Share2',
        onClick: () => options.onShare(options.blob, options.dataUrl),
      }),
      button({ label: t('common.close'), onClick: options.onClose }),
    );

    const modal = new Modal({
      title: t('export.snapshot'),
      body,
      footer,
      onClose: options.onClose,
    });
    this.element = modal.element;
  }
}
