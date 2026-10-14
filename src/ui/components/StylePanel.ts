/**
 * StylePanel — material, glow and lighting controls.
 * Every change is throttled through the actions layer, which also mirrors it to
 * the room when one is active.
 */
import { appStore } from '../../app/appStore';
import { el } from '../dom';
import { t } from '../i18n';
import { ColorPicker } from './ColorPicker';
import { Slider } from './Slider';
import { switchRow } from './controls';
import type { MaterialState } from '../../app/state';

export interface StylePanelOptions {
  onChange: (patch: Partial<MaterialState>) => void;
}

export class StylePanel {
  readonly element: HTMLElement;
  private readonly color: ColorPicker;
  private readonly sliders: Slider[];
  private readonly toggles: HTMLElement;
  private readonly unsubscribe: () => void;

  constructor(options: StylePanelOptions) {
    const material = appStore.getState().material;

    this.color = new ColorPicker({
      value: material.color,
      onChange: (color) => options.onChange({ color }),
    });

    const metalness = new Slider({
      labelKey: 'style.metalness',
      min: 0,
      max: 1,
      value: material.metalness,
      format: (v) => `${Math.round(v * 100)}%`,
      onInput: (metalness) => options.onChange({ metalness }),
    });

    const roughness = new Slider({
      labelKey: 'style.roughness',
      min: 0,
      max: 1,
      value: material.roughness,
      format: (v) => `${Math.round(v * 100)}%`,
      onInput: (roughness) => options.onChange({ roughness }),
    });

    const glow = new Slider({
      labelKey: 'style.glowIntensity',
      min: 0,
      max: 2,
      value: material.glowStrength,
      format: (v) => `${v.toFixed(1)}×`,
      onInput: (glowStrength) => options.onChange({ glowStrength, glow: glowStrength > 0 }),
    });

    const emissive = new Slider({
      labelKey: 'style.emissive',
      min: 0,
      max: 2,
      value: material.emissiveIntensity,
      format: (v) => `${v.toFixed(1)}×`,
      onInput: (emissiveIntensity) => options.onChange({ emissiveIntensity }),
    });

    const light = new Slider({
      labelKey: 'style.light',
      min: 0,
      max: 2,
      value: material.lightIntensity,
      format: (v) => `${Math.round(v * 100)}%`,
      onInput: (lightIntensity) => options.onChange({ lightIntensity }),
    });

    this.sliders = [metalness, roughness, glow, emissive, light];

    this.toggles = el(
      'div',
      { class: 'stack', style: { gap: 'var(--space-1)' } },
      switchRow(t('style.glow'), material.glow, (value) => options.onChange({ glow: value })),
      switchRow(t('style.contactShadow'), material.contactShadow, (value) =>
        options.onChange({ contactShadow: value }),
      ),
      switchRow(t('style.animation'), material.animation, (value) => options.onChange({ animation: value })),
      switchRow(t('style.wireframe'), material.wireframe, (value) => options.onChange({ wireframe: value })),
    );

    this.element = el(
      'section',
      { class: 'stack' },
      el('h2', { class: 'panel__title', text: t('style.title') }),
      this.color.element,
      ...this.sliders.map((slider) => slider.element),
      this.toggles,
    );

    this.unsubscribe = appStore.subscribe(() => this.syncFromState());
  }

  /** Mirrors remote changes back into the controls. */
  private syncFromState(): void {
    const material = appStore.getState().material;
    this.color.setValue(material.color);

    const values = [
      material.metalness,
      material.roughness,
      material.glowStrength,
      material.emissiveIntensity,
      material.lightIntensity,
    ];
    this.sliders.forEach((slider, index) => slider.setValue(values[index] ?? 0));
  }

  /** Re-renders translated labels. */
  refresh(): void {
    for (const slider of this.sliders) slider.refreshLabels();
  }

  dispose(): void {
    this.unsubscribe();
  }
}
