/**
 * ArControlDock — state-of-the-art floating glassmorphism control dock for WebAR.
 *
 * Provides immediate one-touch switching between:
 *  - 🖐️ Hand AR (Gesture control & manipulation)
 *  - ✏️ 3D Air Draw (Writing and sculpting in space)
 *  - 📍 Spatial Placement (Drag & drop anywhere)
 *  - 🔲 Marker AR (Physical target card)
 *
 * Plus instant access to hand skeleton points toggle, color swatches, 3D object switcher,
 * undo/clear, and snapshot.
 */
import { el } from '../dom';
import { iconElement } from '../icon';
import { t } from '../i18n';
import { DRAW_PRESET_COLORS } from '../../core/drawing/AirDrawManager';
import { OBJECT_DEFINITIONS } from '../../core/objects/ObjectRegistry';

export type ArInteractionMode = 'hands' | 'draw' | 'place' | 'marker';

export interface ArControlDockOptions {
  currentMode: ArInteractionMode;
  skeletonEnabled: boolean;
  currentColor: string;
  currentObjectId: string;
  onModeChange: (mode: ArInteractionMode) => void;
  onToggleSkeleton: (enabled: boolean) => void;
  onColorChange: (color: string) => void;
  onUndoDraw: () => void;
  onClearDraw: () => void;
  onSelectObject: (id: string) => void;
  onSnapshot: () => void;
}

export class ArControlDock {
  readonly element: HTMLElement;
  private readonly modeBar: HTMLElement;
  private readonly subBar: HTMLElement;
  private currentMode: ArInteractionMode;
  private skeletonEnabled: boolean;
  private currentColor: string;
  private currentObjectId: string;

  constructor(private readonly options: ArControlDockOptions) {
    this.currentMode = options.currentMode;
    this.skeletonEnabled = options.skeletonEnabled;
    this.currentColor = options.currentColor;
    this.currentObjectId = options.currentObjectId;

    this.modeBar = el('div', { class: 'ar-dock__mode-bar' });
    this.subBar = el('div', { class: 'ar-dock__sub-bar' });

    this.element = el(
      'div',
      { class: 'ar-dock glass' },
      this.modeBar,
      this.subBar,
    );

    this.render();
  }

  setMode(mode: ArInteractionMode): void {
    if (this.currentMode === mode) return;
    this.currentMode = mode;
    this.render();
  }

  setSkeletonEnabled(enabled: boolean): void {
    this.skeletonEnabled = enabled;
    this.render();
  }

  setColor(color: string): void {
    this.currentColor = color;
    this.render();
  }

  setObjectId(id: string): void {
    this.currentObjectId = id;
    this.render();
  }

  render(): void {
    this.renderModeBar();
    this.renderSubBar();
  }

  private renderModeBar(): void {
    const modes: { id: ArInteractionMode; icon: 'Hand' | 'Pencil' | 'Move3d' | 'QrCode'; label: string }[] = [
      { id: 'hands', icon: 'Hand', label: '🖐️ Hand AR' },
      { id: 'draw', icon: 'Pencil', label: '✏️ 3D Draw' },
      { id: 'place', icon: 'Move3d', label: '📍 Place 3D' },
      { id: 'marker', icon: 'QrCode', label: '🔲 Marker' },
    ];

    const buttons = modes.map((m) => {
      const active = this.currentMode === m.id;
      const btn = el(
        'button',
        {
          class: `ar-dock__btn ${active ? 'is-active' : ''}`,
          type: 'button',
          attrs: { 'aria-pressed': active ? 'true' : 'false' },
          on: {
            click: () => {
              this.currentMode = m.id;
              this.options.onModeChange(m.id);
              this.render();
            },
          },
        },
        iconElement(m.icon, { size: 16 }),
        el('span', { class: 'ar-dock__label', text: m.label }),
      );
      return btn;
    });

    this.modeBar.replaceChildren(...buttons);
  }

  private renderSubBar(): void {
    const children: HTMLElement[] = [];

    // Skeleton points toggle (Available in hands, draw, place modes)
    if (this.currentMode !== 'marker') {
      const skelBtn = el(
        'button',
        {
          class: `ar-dock__sub-btn ${this.skeletonEnabled ? 'is-glow' : ''}`,
          type: 'button',
          attrs: {
            title: this.skeletonEnabled ? 'نقاط اليد: مفعّلة' : 'نقاط اليد: معطّلة',
          },
          on: {
            click: () => {
              this.skeletonEnabled = !this.skeletonEnabled;
              this.options.onToggleSkeleton(this.skeletonEnabled);
              this.render();
            },
          },
        },
        iconElement('Sparkles', { size: 15 }),
        el('span', { text: this.skeletonEnabled ? '🦴 Hand Points ON' : '🦴 Points OFF' }),
      );
      children.push(skelBtn);
    }

    // Controls for Draw mode: Colors, Undo, Clear
    if (this.currentMode === 'draw') {
      const swatches = el('div', { class: 'ar-dock__swatches' });
      for (const color of DRAW_PRESET_COLORS) {
        const isSelected = this.currentColor === color;
        const swatch = el('button', {
          class: `ar-dock__swatch ${isSelected ? 'is-selected' : ''}`,
          type: 'button',
          style: { backgroundColor: color },
          attrs: { 'aria-label': color },
          on: {
            click: () => {
              this.currentColor = color;
              this.options.onColorChange(color);
              this.render();
            },
          },
        });
        swatches.appendChild(swatch);
      }
      children.push(swatches);

      const undoBtn = el(
        'button',
        {
          class: 'ar-dock__sub-btn',
          type: 'button',
          attrs: { title: 'تراجع (Undo)' },
          on: { click: () => this.options.onUndoDraw() },
        },
        iconElement('Undo2', { size: 15 }),
        el('span', { text: 'Undo' }),
      );
      children.push(undoBtn);

      const clearBtn = el(
        'button',
        {
          class: 'ar-dock__sub-btn ar-dock__sub-btn--danger',
          type: 'button',
          attrs: { title: 'مسح الكل (Clear)' },
          on: { click: () => this.options.onClearDraw() },
        },
        iconElement('Trash2', { size: 15 }),
        el('span', { text: 'Clear' }),
      );
      children.push(clearBtn);
    }

    // Controls for Hands or Place mode: Object quick selector
    if (this.currentMode === 'hands' || this.currentMode === 'place') {
      const pickerContainer = el('div', { class: 'ar-dock__objects' });
      for (const def of OBJECT_DEFINITIONS.slice(0, 6)) {
        const isSelected = this.currentObjectId === def.id;
        const objBtn = el(
          'button',
          {
            class: `ar-dock__obj-chip ${isSelected ? 'is-selected' : ''}`,
            type: 'button',
            on: {
              click: () => {
                this.currentObjectId = def.id;
                this.options.onSelectObject(def.id);
                this.render();
              },
            },
          },
          el('span', { text: t(def.labelKey) }),
        );
        pickerContainer.appendChild(objBtn);
      }
      children.push(pickerContainer);
    }

    // Marker mode: Quick link to open marker modal
    if (this.currentMode === 'marker') {
      const hint = el('span', {
        class: 'ar-dock__hint',
        text: 'وجّه الكاميرا نحو الكارت أو الورقة المطبوعة',
      });
      children.push(hint);
    }

    // Quick Snapshot button
    const snapBtn = el(
      'button',
      {
        class: 'ar-dock__sub-btn ar-dock__sub-btn--primary',
        type: 'button',
        attrs: { title: 'التقاط صورة (Snapshot)' },
        on: { click: () => this.options.onSnapshot() },
      },
      iconElement('Camera', { size: 15 }),
      el('span', { text: 'Snap' }),
    );
    children.push(snapBtn);

    this.subBar.replaceChildren(...children);
  }
}
