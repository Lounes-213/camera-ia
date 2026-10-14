/**
 * ExportPanel — snapshot, GLB export, fullscreen, camera switch and debug.
 * Also hosts the credits entry point so CC-BY attribution is one tap away.
 */
import { appStore } from '../../app/appStore';
import { el } from '../dom';
import { iconElement } from '../icon';
import { t } from '../i18n';
import { button, switchRow } from './controls';

export interface ExportPanelOptions {
  onSnapshot: () => void;
  onExportGlb: () => void;
  onFullscreen: () => void;
  onSwitchCamera: () => void;
  onToggleDebug: () => void;
  onOpenCredits: () => void;
}

export class ExportPanel {
  readonly element: HTMLElement;
  private readonly meta: HTMLElement;
  private readonly unsubscribe: () => void;

  constructor(options: ExportPanelOptions) {
    this.meta = el('div', { class: 'card' });

    this.element = el(
      'section',
      { class: 'stack' },
      el('h2', { class: 'panel__title', text: t('export.title') }),
      button({
        label: t('export.snapshot'),
        icon: 'Camera',
        variant: 'primary',
        block: true,
        onClick: () => options.onSnapshot(),
      }),
      el(
        'div',
        { class: 'row', style: { gap: 'var(--space-2)' } },
        button({
          label: t('export.exportGlb'),
          icon: 'Download',
          block: true,
          onClick: () => options.onExportGlb(),
        }),
      ),
      el(
        'div',
        { class: 'row', style: { gap: 'var(--space-2)' } },
        button({
          label: t('export.fullscreen'),
          icon: 'Maximize',
          block: true,
          onClick: () => options.onFullscreen(),
        }),
        button({
          label: t('export.camera'),
          icon: 'SwitchCamera',
          block: true,
          onClick: () => options.onSwitchCamera(),
        }),
      ),
      this.meta,
      switchRow(t('common.debug'), appStore.getState().ui.debug, () => options.onToggleDebug()),
      button({
        label: t('credits.title'),
        icon: 'BadgeInfo',
        block: true,
        onClick: () => options.onOpenCredits(),
      }),
      el('p', { class: 'panel__hint', text: t('privacy.body') }),
    );

    this.unsubscribe = appStore.subscribe(() => this.renderMeta());
    this.renderMeta();
  }

  private renderMeta(): void {
    const { objectId, modelMeta } = appStore.getState();
    const rows: HTMLElement[] = [
      el(
        'div',
        { class: 'card__row' },
        el('span', { class: 'muted', text: 'ID' }),
        el('span', { class: 'truncate', text: objectId }),
      ),
    ];

    if (modelMeta) {
      if (modelMeta.triangles) {
        rows.push(
          el(
            'div',
            { class: 'card__row' },
            el('span', { class: 'muted', text: '△' }),
            el('span', { text: modelMeta.triangles.toLocaleString() }),
          ),
        );
      }
      if (modelMeta.license) {
        rows.push(
          el(
            'div',
            { class: 'card__row' },
            el('span', { class: 'muted', text: t('credits.license') }),
            el('span', { text: modelMeta.license }),
          ),
        );
      }
      if (modelMeta.author) {
        rows.push(
          el(
            'div',
            { class: 'card__row' },
            el('span', { class: 'muted', text: t('credits.author') }),
            el('span', { class: 'truncate', text: modelMeta.author }),
          ),
        );
      }
    }

    this.meta.replaceChildren(
      el(
        'div',
        { class: 'card__row' },
        el('span', { class: 'row muted' }, iconElement('Box', { size: 14 }), el('span', { text: t('objects.custom') })),
        el('span', { class: 'tiny', text: modelMeta?.builtin ? t('credits.shipped') : (modelMeta?.provider ?? '—') }),
      ),
      ...rows,
    );
  }

  dispose(): void {
    this.unsubscribe();
  }
}
