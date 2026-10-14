/**
 * SearchSheet — "ask for an object" in any language.
 *
 * Text field + optional microphone (Web Speech API) + suggestion chips, backed
 * by the offline index first and the free online provider second. Results show
 * thumbnails, author and licence, and loading a model works with every other
 * feature (transform, glow, snapshot, export, hands mode, shared rooms).
 */
import { appStore } from '../../app/appStore';
import { CONFIG } from '../../app/config';
import { el, replace } from '../dom';
import { iconElement } from '../icon';
import { t } from '../i18n';
import { button, emptyState, switchRow } from './controls';
import { SUGGESTIONS } from '../../core/search/QueryParser';
import type { SearchResult } from '../../app/state';

export interface SearchSheetOptions {
  onSearch: (query: string) => void;
  onSearchNow: (query: string) => void;
  onLoad: (result: SearchResult) => void;
  onEnableSemantic: () => void;
}

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
}

export class SearchSheet {
  readonly element: HTMLElement;
  private readonly input: HTMLInputElement;
  private readonly micButton: HTMLButtonElement;
  private readonly results: HTMLElement;
  private readonly status: HTMLElement;
  private readonly suggestions: HTMLElement;
  private recognition: SpeechRecognitionLike | null = null;
  private listening = false;
  private readonly unsubscribe: () => void;

  constructor(private readonly options: SearchSheetOptions) {
    this.input = el('input', {
      class: 'search-input',
      type: 'search',
      placeholder: t('search.placeholder'),
      attrs: {
        'aria-label': t('search.title'),
        enterkeyhint: 'search',
        autocapitalize: 'off',
        autocomplete: 'off',
        spellcheck: 'false',
      },
    }) as HTMLInputElement;

    this.input.addEventListener('input', () => options.onSearch(this.input.value));
    this.input.addEventListener('keydown', (event) => {
      if ((event as KeyboardEvent).key === 'Enter') options.onSearchNow(this.input.value);
    });

    this.micButton = el(
      'button',
      {
        class: 'icon-btn',
        type: 'button',
        attrs: { 'aria-label': t('search.voice'), 'aria-pressed': 'false', 'data-hand-clickable': '' },
        on: { click: () => this.toggleVoice() },
      },
      iconElement('Mic', { size: 20 }),
    );

    this.status = el('p', { class: 'tiny' });
    this.results = el('div', { class: 'grid-tiles' });
    this.suggestions = el(
      'div',
      { class: 'row', style: { flexWrap: 'wrap', gap: 'var(--space-2)' } },
      ...SUGGESTIONS.map((suggestion) =>
        el('button', {
          class: 'chip',
          type: 'button',
          text: suggestion,
          on: {
            click: () => {
              this.input.value = suggestion;
              options.onSearchNow(suggestion);
            },
          },
        }),
      ),
    );

    const semanticRow = CONFIG.features.semanticSearch
      ? switchRow(t('search.semantic'), appStore.getState().search.semantic, (value) => {
          if (value) options.onEnableSemantic();
        })
      : null;

    this.element = el(
      'section',
      { class: 'stack' },
      el(
        'div',
        { class: 'stack', style: { gap: '2px' } },
        el('h2', { class: 'panel__title', text: t('search.title') }),
        el('p', { class: 'tiny', text: t('search.subtitle') }),
      ),
      el(
        'div',
        { class: 'row' },
        el('span', { class: 'grow search-field' }, this.input),
        this.micButton,
        button({
          label: '',
          icon: 'Search',
          variant: 'primary',
          onClick: () => options.onSearchNow(this.input.value),
        }),
      ),
      el('p', { class: 'tiny', text: t('search.suggestions') }),
      this.suggestions,
      semanticRow,
      this.status,
      this.results,
    );

    this.unsubscribe = appStore.subscribe(() => this.render());
    this.render();
  }

  private render(): void {
    const { search } = appStore.getState();
    if (document.activeElement !== this.input && search.query !== this.input.value) {
      this.input.value = search.query;
    }

    const offline = !navigator.onLine;
    this.status.textContent = offline
      ? t('search.offline')
      : search.errorKind === 'quota'
        ? t('search.quota')
        : search.errorKind === 'error'
          ? t('search.error')
          : search.status === 'searching'
            ? t('search.searching')
            : search.results.length > 0
              ? t('search.results', { count: search.results.length })
              : '';

    if (search.semanticProgress > 0 && search.semanticProgress < 1) {
      this.status.textContent = `${t('search.semanticLoading')} ${Math.round(search.semanticProgress * 100)}%`;
    }

    if (search.status === 'searching' && search.results.length === 0) {
      replace(
        this.results,
        ...Array.from({ length: 6 }, () =>
          el('div', { class: 'skeleton', style: { aspectRatio: '1', borderRadius: 'var(--radius-md)' } }),
        ),
      );
      return;
    }

    if (search.results.length === 0) {
      replace(this.results, el('div', { style: { gridColumn: '1 / -1' } }, emptyState('SearchX', t('search.noResults'))));
      return;
    }

    replace(
      this.results,
      ...search.results.map((result) => this.resultTile(result)),
    );
  }

  private resultTile(result: SearchResult): HTMLElement {
    const preview = el('span', { class: 'tile__preview' });
    if (result.thumbnail) {
      const image = el('img', {
        attrs: { src: result.thumbnail, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' },
      });
      image.addEventListener('error', () => {
        replace(preview, iconElement('Box', { size: 30 }));
      });
      preview.appendChild(image);
    } else {
      preview.appendChild(iconElement('Box', { size: 30 }));
    }

    const meta = [result.author, result.license].filter(Boolean).join(' • ');

    return el(
      'button',
      {
        class: 'tile',
        type: 'button',
        attrs: { 'data-hand-clickable': '', title: `${result.title} — ${meta}` },
        on: { click: () => this.options.onLoad(result) },
      },
      preview,
      el('span', { class: 'tile__label truncate', text: result.title }),
      el('span', { class: 'tile__meta truncate', text: meta }),
    );
  }

  /** Starts or stops dictation. */
  private toggleVoice(): void {
    const scope = window as unknown as {
      SpeechRecognition?: new () => SpeechRecognitionLike;
      webkitSpeechRecognition?: new () => SpeechRecognitionLike;
    };
    const Recognition = scope.SpeechRecognition ?? scope.webkitSpeechRecognition;
    if (!Recognition) {
      this.status.textContent = t('search.voiceUnsupported');
      return;
    }

    if (this.listening) {
      this.recognition?.stop();
      return;
    }

    const recognition = new Recognition();
    recognition.lang = appStore.getState().lang === 'ar' ? 'ar-MA' : appStore.getState().lang === 'fr' ? 'fr-FR' : 'en-US';
    recognition.continuous = false;
    recognition.interimResults = false;

    recognition.onresult = (event) => {
      const first = event.results[0]?.[0];
      const transcript = first?.transcript ?? '';
      if (transcript) {
        this.input.value = transcript;
        this.options.onSearchNow(transcript);
      }
    };
    recognition.onerror = () => this.stopVoice(recognition);
    recognition.onend = () => this.stopVoice(recognition);

    this.recognition = recognition;
    try {
      recognition.start();
      this.listening = true;
      this.micButton.setAttribute('aria-pressed', 'true');
      this.status.textContent = t('search.listening');
    } catch {
      this.status.textContent = t('search.voiceUnsupported');
    }
  }

  private stopVoice(recognition: SpeechRecognitionLike): void {
    if (this.recognition === recognition) this.recognition = null;
    this.listening = false;
    this.micButton.setAttribute('aria-pressed', 'false');
  }

  /** Re-renders labels after a language change. */
  refresh(): void {
    this.input.placeholder = t('search.placeholder');
    this.micButton.setAttribute('aria-label', t('search.voice'));
    this.render();
  }

  dispose(): void {
    this.recognition?.stop();
    this.unsubscribe();
  }
}
