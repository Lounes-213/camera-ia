/**
 * Modal — a focus-trapped, dismissible dialog on a glass scrim.
 *
 * Escape closes it, the scrim is inert to clicks *behind* it, focus moves to the
 * panel and returns to the trigger on close. Content is provided by the caller so
 * every modal (onboarding, snapshot, credits, marker…) reuses one shell.
 */
import { el, on } from '../dom';
import { iconElement } from '../icon';
import { t } from '../i18n';

export interface ModalOptions {
  title: string;
  wide?: boolean;
  body: HTMLElement;
  footer?: HTMLElement;
  onClose: () => void;
}

export class Modal {
  readonly element: HTMLElement;
  private detachKey: () => void;

  constructor(private readonly options: ModalOptions) {
    const closeButton = el(
      'button',
      {
        class: 'icon-btn',
        type: 'button',
        attrs: { 'aria-label': t('common.close'), 'data-hand-clickable': '' },
        on: { click: () => this.options.onClose() },
      },
      iconElement('X', { size: 20 }),
    );

    const panel = el(
      'div',
      {
        class: `modal ${options.wide ? 'modal--wide' : ''}`.trim(),
        role: 'dialog',
        attrs: { 'aria-modal': 'true', 'aria-label': options.title },
      },
      el(
        'header',
        { class: 'modal__header' },
        el('h2', { class: 'modal__title', text: options.title }),
        el('span', { class: 'grow' }),
        closeButton,
      ),
      el('div', { class: 'modal__body' }, options.body),
      options.footer ? el('footer', { class: 'modal__footer' }, options.footer) : null,
    );

    this.element = el(
      'div',
      {
        class: 'scrim',
        on: {
          pointerdown: (event) => {
            if (event.target === this.element) this.options.onClose();
          },
        },
      },
      panel,
    );

    this.detachKey = on(window, 'keydown', (event) => {
      if (event.key === 'Escape') this.options.onClose();
    });

    // Move focus inside for keyboard and screen-reader users.
    window.setTimeout(() => {
      const focusable = panel.querySelector<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      focusable?.focus();
    }, 30);
  }

  /** The dialog panel element (for focus management / updates). */
  get panel(): HTMLElement {
    return this.element.querySelector('.modal') as HTMLElement;
  }

  dispose(): void {
    this.detachKey();
    this.element.remove();
  }
}
