/**
 * HandModeToggle — the [Marker] [Hands] switch.
 *
 * Switching modes pauses MindAR's detector and reuses the same MediaStream, so
 * the browser never asks for the camera twice. When hand tracking is unavailable
 * (no model file, old device) the option is disabled with a clear reason.
 */
import { appStore } from '../../app/appStore';
import { CONFIG } from '../../app/config';
import { el } from '../dom';
import { t } from '../i18n';
import { segmented } from './controls';
import type { AppMode } from '../../app/state';

export interface HandModeToggleOptions {
  onChange: (mode: AppMode) => void;
}

export class HandModeToggle {
  readonly element: HTMLElement;
  private readonly container: HTMLElement;
  private readonly unsubscribe: () => void;

  constructor(private readonly options: HandModeToggleOptions) {
    this.container = el('div', { class: 'stack', style: { gap: 'var(--space-2)' } });
    this.element = el(
      'section',
      { class: 'glass panel' },
      el('h2', { class: 'panel__title' }, el('span', { text: t('mode.label') })),
      this.container,
    );
    this.unsubscribe = appStore.subscribe(() => this.render());
    this.render();
  }

  private render(): void {
    const { mode, hands } = appStore.getState();
    const available = CONFIG.features.hands && (hands.available || hands.status !== 'error');

    const nodes: HTMLElement[] = [
      segmented<AppMode>(
        [
          { value: 'marker', label: t('mode.marker'), icon: 'QrCode' },
          { value: 'hands', label: t('mode.hands'), icon: 'Hand' },
        ],
        mode,
        (next) => this.options.onChange(next),
      ),
      el('p', {
        class: 'panel__hint',
        text: mode === 'marker' ? t('mode.markerHint') : t('mode.handsHint'),
      }),
    ];
    if (!CONFIG.features.hands) {
      nodes.push(el('p', { class: 'panel__hint', text: t('hands.disabled') }));
    } else if (!available) {
      nodes.push(el('p', { class: 'panel__hint', text: t('hands.modelMissing') }));
    }
    this.container.replaceChildren(...nodes);
  }

  dispose(): void {
    this.unsubscribe();
  }
}
