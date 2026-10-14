/**
 * HandsTutorial — the first-use gesture guide (translated, mirrored in RTL).
 * Shown the first time hands mode starts, with a compact gesture cheat-sheet.
 */
import { el } from '../dom';
import { iconElement, type IconName } from '../icon';
import { t, type TranslationKey } from '../i18n';
import { button, switchRow } from './controls';
import { Modal } from './Modal';

interface GestureRow {
  icon: IconName;
  key: TranslationKey;
}

const GESTURES: GestureRow[] = [
  { icon: 'Scan', key: 'hands.gesturePinch' },
  { icon: 'Hand', key: 'hands.gesturePalm' },
  { icon: 'MoveHorizontal', key: 'hands.gestureTwoHands' },
  { icon: 'CircleSlash2', key: 'hands.gestureFist' },
  { icon: 'MousePointer2', key: 'hands.gesturePoint' },
];

export interface HandsTutorialOptions {
  onDone: () => void;
  onToggleSkeleton: (show: boolean) => void;
  skeletonVisible: boolean;
}

export class HandsTutorial {
  readonly element: HTMLElement;

  constructor(options: HandsTutorialOptions) {
    const body = el(
      'div',
      { class: 'stack', style: { gap: 'var(--space-5)' } },
      el('p', { class: 'muted', text: t('hands.intro') }),
      el(
        'div',
        { class: 'steps' },
        ...(
          [
            ['hands.step1Title', 'hands.step1Body'],
            ['hands.step2Title', 'hands.step2Body'],
            ['hands.step3Title', 'hands.step3Body'],
          ] as [TranslationKey, TranslationKey][]
        ).map(([title, bodyKey], index) =>
          el(
            'div',
            { class: 'step' },
            el('span', { class: 'step__index', text: String(index + 1) }),
            el(
              'div',
              { class: 'stack', style: { gap: '2px' } },
              el('h3', { class: 'step__title', text: t(title) }),
              el('p', { class: 'step__body', text: t(bodyKey) }),
            ),
          ),
        ),
      ),
      el(
        'div',
        { class: 'card' },
        el('h3', { class: 'panel__title' }, el('span', { text: t('hands.more') })),
        ...GESTURES.map((gesture) =>
          el(
            'div',
            { class: 'card__row' },
            el('span', { class: 'row' }, iconElement(gesture.icon, { size: 16 }), el('span', { text: t(gesture.key) })),
          ),
        ),
      ),
      switchRow(t('hands.skeleton'), options.skeletonVisible, (value) => options.onToggleSkeleton(value)),
      el('p', { class: 'tiny', text: t('mode.needsRecentDevice') }),
    );

    const modal = new Modal({
      title: t('hands.title'),
      body,
      footer: button({
        label: t('common.done'),
        icon: 'Check',
        variant: 'primary',
        onClick: options.onDone,
      }),
      onClose: options.onDone,
    });
    this.element = modal.element;
  }
}
