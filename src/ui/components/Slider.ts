/**
 * Slider — a labelled range input with a live value readout.
 * Emits `onInput` continuously (for live material updates) and `onCommit` once
 * the user releases it (for persistence / network sync).
 */
import { el, on } from '../dom';
import { t, type TranslationKey } from '../i18n';

export interface SliderOptions {
  labelKey: TranslationKey;
  min: number;
  max: number;
  step?: number;
  value: number;
  /** Formats the numeric readout, e.g. `(v) => `${Math.round(v * 100)}%``. */
  format?: (value: number) => string;
  onInput: (value: number) => void;
  onCommit?: (value: number) => void;
}

export class Slider {
  readonly element: HTMLElement;
  private readonly input: HTMLInputElement;
  private readonly readout: HTMLSpanElement;

  constructor(private readonly options: SliderOptions) {
    this.readout = el('span', { class: 'field__value' });

    this.input = el('input', {
      class: 'slider',
      type: 'range',
      value: String(options.value),
      attrs: {
        min: options.min,
        max: options.max,
        step: options.step ?? 0.01,
        'aria-label': t(options.labelKey),
      },
      on: {
        input: () => {
          const value = Number(this.input.value);
          this.readout.textContent = this.format(value);
          options.onInput(value);
        },
        change: () => options.onCommit?.(Number(this.input.value)),
      },
    });

    this.element = el(
      'div',
      { class: 'field' },
      el(
        'div',
        { class: 'field__label' },
        el('span', { text: t(options.labelKey) }),
        this.readout,
      ),
      this.input,
    );

    this.updateReadout();
  }

  /** Programmatically updates the value (used when a peer changes it). */
  setValue(value: number): void {
    const clamped = Math.min(this.options.max, Math.max(this.options.min, value));
    this.input.value = String(clamped);
    this.updateReadout();
  }

  /** Re-renders the label after a language change. */
  refreshLabels(): void {
    const label = this.element.querySelector('.field__label span');
    if (label) label.textContent = t(this.options.labelKey);
    this.input.setAttribute('aria-label', t(this.options.labelKey));
  }

  dispose(): void {
    void on;
  }

  private updateReadout(): void {
    this.readout.textContent = this.format(Number(this.input.value));
  }

  private format(value: number): string {
    return this.options.format ? this.options.format(value) : value.toFixed(2);
  }
}
