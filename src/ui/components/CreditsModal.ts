/**
 * CreditsModal — CC-BY compliance.
 *
 * Lists every third-party model ever loaded (from the IndexedDB cache) with its
 * author, licence and source link, plus the attribution of the bundled index.
 * A "report / remove" action clears the cached copy and records the request.
 */
import { el, replace } from '../dom';
import { iconElement } from '../icon';
import { t } from '../i18n';
import { button, emptyState } from './controls';
import { Modal } from './Modal';
import { LocalIndexProvider } from '../../core/search/providers/LocalIndex';
import { ModelCache } from '../../core/search/ModelCache';
import { CONFIG } from '../../app/config';
import type { ModelMeta } from '../../app/state';

export interface CreditsModalOptions {
  onClose: () => void;
  onReport: (meta: ModelMeta) => void;
}

export class CreditsModal {
  readonly element: HTMLElement;
  private readonly list: HTMLElement;
  private readonly cache = new ModelCache();
  private readonly local = new LocalIndexProvider();

  constructor(private readonly options: CreditsModalOptions) {
    this.list = el('div', { class: 'list' });

    const body = el(
      'div',
      { class: 'stack' },
      el('p', { class: 'tiny', text: this.local.attribution }),
      el(
        'div',
        { class: 'card__row' },
        el('span', { class: 'muted', text: t('search.title') }),
        el('span', { class: 'badge', text: `${this.local.size} ${t('objects.title').toLowerCase()}` }),
      ),
      this.list,
      el('p', { class: 'tiny', text: t('privacy.body') }),
    );

    const modal = new Modal({
      title: t('credits.title'),
      body,
      onClose: options.onClose,
    });
    this.element = modal.element;
    void this.load();
  }

  private async load(): Promise<void> {
    let entries: ModelMeta[] = [];
    try {
      entries = await this.cache.listMeta();
    } catch {
      entries = [];
    }

    if (entries.length === 0) {
      replace(this.list, emptyState('BadgeInfo', t('credits.none')));
      return;
    }

    replace(
      this.list,
      ...entries.map((entry) =>
        el(
          'div',
          { class: 'card' },
          el(
            'div',
            { class: 'card__row' },
            el('strong', { class: 'truncate', text: entry.title }),
            el('span', { class: 'badge', text: entry.license ?? 'unknown' }),
          ),
          el(
            'div',
            { class: 'card__row' },
            el('span', { class: 'row muted' }, iconElement('User', { size: 14 }), el('span', { text: entry.author ?? '—' })),
            el('span', { class: 'tiny', text: entry.provider ?? '—' }),
          ),
          entry.sourceUrl
            ? el(
                'a',
                {
                  class: 'tiny row',
                  attrs: {
                    href: entry.sourceUrl,
                    target: '_blank',
                    rel: 'noopener noreferrer',
                  },
                },
                iconElement('ExternalLink', { size: 12 }),
                el('span', { text: entry.sourceUrl }),
              )
            : null,
          button({
            label: t('credits.report'),
            icon: 'Flag',
            size: 'sm',
            onClick: () => {
              void this.cache.remove(entry.id);
              this.options.onReport(entry);
            },
          }),
        ),
      ),
    );
  }
}

/** Public URL of the shipped credits file (see public/model-credits.json). */
export const shippedCreditsUrl = CONFIG.search.creditsPath;
