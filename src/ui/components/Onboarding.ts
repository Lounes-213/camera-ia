/**
 * Onboarding — the three-step first-run tour, plus the "Get the marker" action
 * that opens the printable sheet so the user can start immediately.
 */
import { el, replace } from '../dom';
import { iconElement, type IconName } from '../icon';
import { t, type TranslationKey } from '../i18n';
import { button } from './controls';
import { Modal } from './Modal';

interface Step {
  icon: IconName;
  titleKey: TranslationKey;
  bodyKey: TranslationKey;
}

const STEPS: Step[] = [
  { icon: 'QrCode', titleKey: 'tutorial.step1Title', bodyKey: 'tutorial.step1Body' },
  { icon: 'ScanLine', titleKey: 'tutorial.step2Title', bodyKey: 'tutorial.step2Body' },
  { icon: 'Hand', titleKey: 'tutorial.step3Title', bodyKey: 'tutorial.step3Body' },
];

export interface OnboardingOptions {
  onDone: (options: { neverShowAgain: boolean }) => void;
  onGetMarker: () => void;
}

export class Onboarding {
  readonly element: HTMLElement;
  private index = 0;
  private neverShow = false;
  private readonly body: HTMLElement;
  private readonly dots: HTMLElement;

  constructor(private readonly options: OnboardingOptions) {
    this.body = el('div', { class: 'stack' });
    this.dots = el('div', { class: 'dots' });

    const modal = new Modal({
      title: t('tutorial.welcomeTitle'),
      body: el(
        'div',
        { class: 'stack', style: { gap: 'var(--space-5)' } },
        el('p', { class: 'muted', text: t('tutorial.welcomeBody') }),
        this.body,
        this.dots,
      ),
      onClose: () => options.onDone({ neverShowAgain: this.neverShow }),
    });
    this.element = modal.element;
    this.render();
  }

  private render(): void {
    const step = STEPS[this.index]!;

    replace(
      this.body,
      el(
        'div',
        { class: 'step' },
        el('span', { class: 'step__index' }, iconElement(step.icon, { size: 20 })),
        el(
          'div',
          { class: 'stack', style: { gap: '4px' } },
          el('h3', { class: 'step__title', text: t(step.titleKey) }),
          el('p', { class: 'step__body', text: t(step.bodyKey) }),
        ),
      ),
      this.index === 0
        ? el(
            'div',
            { class: 'row', style: { flexWrap: 'wrap' } },
            button({
              label: t('tutorial.downloadMarker'),
              icon: 'Download',
              variant: 'primary',
              onClick: () => this.options.onGetMarker(),
            }),
            button({
              label: t('tutorial.showOnScreen'),
              icon: 'Monitor',
              onClick: () => this.options.onGetMarker(),
            }),
          )
        : null,
      el(
        'div',
        { class: 'row', style: { justifyContent: 'space-between', marginTop: 'var(--space-2)' } },
        el(
          'label',
          { class: 'switch', style: { width: 'auto' } },
          (() => {
            const input = el('input', { type: 'checkbox' });
            input.checked = this.neverShow;
            input.addEventListener('change', () => {
              this.neverShow = input.checked;
            });
            return input;
          })(),
          el('span', { class: 'switch__track' }, el('span', { class: 'switch__thumb' })),
          el('span', { class: 'tiny', text: t('tutorial.doNotShow') }),
        ),
        el(
          'div',
          { class: 'row' },
          this.index > 0
            ? button({ label: t('common.back'), icon: 'ChevronLeft', onClick: () => this.back() })
            : null,
          this.index < STEPS.length - 1
            ? button({
                label: t('tutorial.next'),
                icon: 'ChevronRight',
                variant: 'primary',
                onClick: () => this.next(),
              })
            : button({
                label: t('tutorial.done'),
                icon: 'Sparkles',
                variant: 'primary',
                onClick: () => this.options.onDone({ neverShowAgain: this.neverShow }),
              }),
        ),
      ),
    );

    replace(
      this.dots,
      ...STEPS.map((_, i) =>
        el('span', { class: 'dot', attrs: { 'aria-current': String(i === this.index) } }),
      ),
    );
  }

  private next(): void {
    this.index = Math.min(STEPS.length - 1, this.index + 1);
    this.render();
  }

  private back(): void {
    this.index = Math.max(0, this.index - 1);
    this.render();
  }
}
