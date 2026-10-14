/**
 * StatusChip — the animated "Target found / lost" indicator.
 *
 * It reacts to AR, hand-tracking and room state and always shows one concise,
 * translated message. The dot pulses while searching and turns green/red as the
 * target is found or lost.
 */
import { appStore } from '../../app/appStore';
import { el, replace } from '../dom';
import { t, type TranslationKey } from '../i18n';
import type { AppState } from '../../app/state';

type ChipState = 'searching' | 'found' | 'lost' | 'paused' | 'hands-searching' | 'hand-found' | 'hand-lost';

export class StatusChip {
  readonly element: HTMLElement;
  private readonly dot: HTMLSpanElement;
  private readonly label: HTMLSpanElement;
  private readonly unsubscribe: () => void;

  constructor() {
    this.dot = el('span', { class: 'status-chip__dot' });
    this.label = el('span', { class: 'status-chip__text' });
    this.element = el(
      'div',
      { class: 'status-chip', role: 'status', attrs: { 'aria-live': 'polite' } },
      this.dot,
      this.label,
    );
    this.unsubscribe = appStore.subscribe(() => this.render());
    this.render();
  }

  /** Subscribes to store + language changes. */
  private render(): void {
    const { state, labelKey } = describe(appStore.getState());
    this.element.dataset.state = state;
    replace(this.label, t(labelKey));
  }

  dispose(): void {
    this.unsubscribe();
  }
}

/** Maps the app state to a chip state + translation key. */
function describe(state: Readonly<AppState>): { state: ChipState; labelKey: TranslationKey } {
  if (state.phase === 'error') return { state: 'lost', labelKey: 'errors.title' };
  if (state.phase === 'paused') return { state: 'paused', labelKey: 'status.paused' };
  if (state.phase === 'boot' || state.phase === 'loading') {
    return { state: 'searching', labelKey: 'status.initializing' };
  }

  if (state.mode === 'hands') {
    switch (state.hands.status) {
      case 'found':
        return {
          state: 'hand-found',
          labelKey: state.hands.gesture === 'none' ? 'status.handFound' : gestureKey(state.hands.gesture),
        };
      case 'lost':
        return { state: 'hand-lost', labelKey: 'status.handLost' };
      case 'error':
        return { state: 'lost', labelKey: 'hands.unavailable' };
      case 'off':
        return { state: 'paused', labelKey: 'status.paused' };
      default:
        return { state: 'hands-searching', labelKey: 'status.handSearching' };
    }
  }

  return state.targetFound
    ? { state: 'found', labelKey: 'status.found' }
    : { state: 'searching', labelKey: 'status.searching' };
}

/** Gesture-specific chip labels keep the feedback actionable. */
function gestureKey(gesture: AppState['hands']['gesture']): TranslationKey {
  switch (gesture) {
    case 'pinch':
      return 'hands.gesturePinch';
    case 'palm':
      return 'hands.gesturePalm';
    case 'two-hands':
      return 'hands.gestureTwoHands';
    case 'fist':
      return 'hands.gestureFist';
    case 'point':
      return 'hands.gesturePoint';
    default:
      return 'status.handFound';
  }
}
