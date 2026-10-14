/**
 * TransformPanel — scale, height, rotation and the reset action.
 * On touch devices the same values are reachable directly with gestures, so the
 * panel doubles as a cheat sheet.
 */
import { appStore } from '../../app/appStore';
import { el } from '../dom';
import { t } from '../i18n';
import { isTouch } from '../../utils/device';
import { Slider } from './Slider';
import { button, switchRow } from './controls';
import type { TransformState } from '../../app/state';

export interface TransformPanelOptions {
  onChange: (patch: Partial<TransformState>) => void;
  onReset: () => void;
}

export class TransformPanel {
  readonly element: HTMLElement;
  private readonly sliders: Slider[];
  private readonly autoRotateRow: HTMLElement;
  private readonly unsubscribe: () => void;

  constructor(options: TransformPanelOptions) {
    const transform = appStore.getState().transform;

    const scale = new Slider({
      labelKey: 'transform.scale',
      min: 0.15,
      max: 3.5,
      value: transform.scale,
      format: (v) => `${v.toFixed(2)}×`,
      onInput: (scale) => options.onChange({ scale }),
    });

    const height = new Slider({
      labelKey: 'transform.height',
      min: -0.4,
      max: 2.5,
      value: transform.height,
      format: (v) => `${v.toFixed(2)}`,
      onInput: (height) => options.onChange({ height }),
    });

    const spin = new Slider({
      labelKey: 'transform.spin',
      min: 0,
      max: 4,
      value: transform.spinSpeed,
      format: (v) => `${v.toFixed(1)}×`,
      onInput: (spinSpeed) => options.onChange({ spinSpeed }),
    });

    const rotateY = new Slider({
      labelKey: 'transform.rotation',
      min: -Math.PI * 2,
      max: Math.PI * 2,
      value: transform.rotation.y,
      format: (v) => `${Math.round((v * 180) / Math.PI)}°`,
      onInput: (y) => options.onChange({ rotation: { ...appStore.getState().transform.rotation, y } }),
    });

    this.sliders = [scale, height, spin, rotateY];

    this.autoRotateRow = switchRow(t('transform.autoRotate'), transform.autoRotate, (autoRotate) =>
      options.onChange({ autoRotate }),
    );

    this.element = el(
      'section',
      { class: 'stack' },
      el('h2', { class: 'panel__title', text: t('transform.title') }),
      this.autoRotateRow,
      ...this.sliders.map((slider) => slider.element),
      button({
        label: t('transform.reset'),
        icon: 'RotateCcw',
        block: true,
        onClick: () => options.onReset(),
      }),
      el('p', { class: 'panel__hint', text: hintText() }),
    );

    this.unsubscribe = appStore.subscribe(() => this.syncFromState());
  }

  private syncFromState(): void {
    const transform = appStore.getState().transform;
    this.sliders[0]?.setValue(transform.scale);
    this.sliders[1]?.setValue(transform.height);
    this.sliders[2]?.setValue(transform.spinSpeed);
    this.sliders[3]?.setValue(transform.rotation.y);
  }

  /** Re-renders translated labels. */
  refresh(): void {
    for (const slider of this.sliders) slider.refreshLabels();
  }

  dispose(): void {
    this.unsubscribe();
  }
}

/** Platform-specific gesture hint. */
function hintText(): string {
  return isTouch()
    ? '1 finger = rotate • pinch = scale • 2 fingers = height • double tap = reset'
    : 'Drag = rotate • wheel = scale • R = reset • Space = auto-rotate';
}
