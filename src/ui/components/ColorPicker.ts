/**
 * ColorPicker — a native colour input plus the orange-first preset swatches.
 * Persists through the actions layer, so the choice survives reloads and is
 * shared with everyone in a room.
 */
import { el } from '../dom';
import { t } from '../i18n';
import { ORANGE_PRESETS } from '../../app/state';

export interface ColorPickerOptions {
  value: string;
  presets?: readonly string[];
  onChange: (color: string) => void;
}

export class ColorPicker {
  readonly element: HTMLElement;
  private readonly input: HTMLInputElement;
  private readonly swatches: HTMLButtonElement[] = [];

  constructor(private readonly options: ColorPickerOptions) {
    this.input = el('input', {
      type: 'color',
      value: options.value,
      attrs: { 'aria-label': t('a11y.colorPicker') },
    });

    this.input.addEventListener('input', () => {
      this.setActive(this.input.value);
      this.options.onChange(this.input.value);
    });

    const presetRow = el('div', { class: 'swatches' });
    for (const preset of options.presets ?? ORANGE_PRESETS) {
      const button = el('button', {
        class: 'swatch',
        type: 'button',
        title: preset,
        attrs: {
          'aria-label': `${t('a11y.colorPicker')} ${preset}`,
          'aria-pressed': String(preset.toLowerCase() === options.value.toLowerCase()),
          style: `background:${preset}`,
        },
        on: {
          click: () => {
            this.input.value = preset;
            this.setActive(preset);
            this.options.onChange(preset);
          },
        },
      });
      this.swatches.push(button);
      presetRow.appendChild(button);
    }

    this.element = el(
      'div',
      { class: 'stack' },
      el(
        'div',
        { class: 'field__label' },
        el('span', { text: t('style.color') }),
      ),
      el('div', { class: 'color-field' }, this.input),
      el('div', { class: 'field__label' }, el('span', { text: t('style.presets') })),
      presetRow,
    );

    this.setActive(options.value);
  }

  /** Updates the selected colour (e.g. when a peer changes it). */
  setValue(color: string): void {
    this.input.value = color;
    this.setActive(color);
  }

  private setActive(color: string): void {
    for (const swatch of this.swatches) {
      swatch.setAttribute('aria-pressed', String(swatch.title.toLowerCase() === color.toLowerCase()));
    }
  }
}
