/**
 * ObjectPicker — the procedural object library plus .glb import.
 *
 * Procedural objects need zero downloads, so they are always available offline.
 * Imported models are drag-and-dropped (desktop) or picked (mobile) and then
 * normalised by ModelNormalizer.
 */
import { el } from '../dom';
import { iconElement, type IconName } from '../icon';
import { t, type TranslationKey } from '../i18n';
import { button, progressBar } from './controls';
import { OBJECT_DEFINITIONS } from '../../core/objects/ObjectRegistry';
import { appStore } from '../../app/appStore';

const PREVIEW_ICONS: Record<string, IconName> = {
  torusKnot: 'Infinity',
  icosahedron: 'Box',
  crystal: 'Gem',
  cubeGrid: 'Grid3x3',
  orbitSphere: 'Orbit',
  rocket: 'Rocket',
  robot: 'Bot',
};

export interface ObjectPickerOptions {
  onSelect: (id: string) => void;
  onImport: (file: File) => void;
}

export class ObjectPicker {
  readonly element: HTMLElement;
  private readonly grid: HTMLElement;
  private readonly tiles = new Map<string, HTMLButtonElement>();
  private readonly progress: HTMLElement;
  private readonly loadingLabel: HTMLElement;
  private readonly unsubscribe: () => void;

  constructor(private readonly options: ObjectPickerOptions) {
    this.grid = el('div', { class: 'grid-tiles' });
    this.progress = progressBar(0);
    this.loadingLabel = el('p', { class: 'tiny', text: t('objects.loading') });

    const fileInput = el('input', {
      type: 'file',
      attrs: { accept: '.glb,.gltf,model/gltf-binary,model/gltf+json' },
      style: { display: 'none' },
      on: {
        change: () => {
          const file = fileInput.files?.[0];
          if (file) options.onImport(file);
          fileInput.value = '';
        },
      },
    }) as HTMLInputElement;

    const dropzone = el(
      'div',
      {
        class: 'dropzone',
        on: {
          dragover: (event) => {
            event.preventDefault();
            dropzone.classList.add('is-over');
          },
          dragleave: () => dropzone.classList.remove('is-over'),
          drop: (event) => {
            event.preventDefault();
            dropzone.classList.remove('is-over');
            const file = (event as DragEvent).dataTransfer?.files?.[0];
            if (file) options.onImport(file);
          },
          click: () => fileInput.click(),
        },
      },
      el('p', { text: t('objects.dropHere') }),
      el('p', { class: 'tiny', text: t('objects.importHint') }),
    );

    this.element = el(
      'section',
      { class: 'stack' },
      el(
        'div',
        { class: 'stack', style: { gap: '2px' } },
        el('h2', { class: 'panel__title', text: t('objects.title') }),
        el('p', { class: 'tiny', text: t('objects.subtitle') }),
      ),
      this.grid,
      dropzone,
      fileInput,
      el('div', { class: 'stack', style: { gap: '4px' } }, this.loadingLabel, this.progress),
    );

    this.buildTiles();
    this.unsubscribe = appStore.subscribe(() => this.render());
    this.render();
  }

  private buildTiles(): void {
    for (const definition of OBJECT_DEFINITIONS) {
      const icon = PREVIEW_ICONS[definition.id] ?? 'Box';
      const tile = el(
        'button',
        {
          class: 'tile',
          type: 'button',
          attrs: {
            'aria-pressed': 'false',
            'data-hand-clickable': '',
            title: t(definition.labelKey),
          },
          on: { click: () => this.options.onSelect(definition.id) },
        },
        el('span', { class: 'tile__preview' }, iconElement(icon, { size: 34 })),
        el('span', { class: 'tile__label', text: t(definition.labelKey) }),
        el('span', { class: 'tile__meta', text: `${(definition.triangles / 1000).toFixed(1)}k △` }),
      );
      this.tiles.set(definition.id, tile);
      this.grid.appendChild(tile);
    }
  }

  /** Highlights the active object and shows load progress. */
  private render(): void {
    const { objectId, ui, modelMeta } = appStore.getState();
    for (const [id, tile] of this.tiles) {
      tile.setAttribute('aria-pressed', String(id === objectId));
    }

    const loading = ui.loading;
    this.progress.parentElement?.toggleAttribute('hidden', loading === null);
    this.loadingLabel.hidden = loading === null;
    if (loading !== null) {
      const fill = this.progress.querySelector<HTMLElement>('.progress__fill');
      if (fill) fill.style.width = `${Math.round(Math.max(0, Math.min(1, loading)) * 100)}%`;
    }

    if (modelMeta && !modelMeta.builtin) {
      this.loadingLabel.textContent = `${t('objects.custom')}: ${modelMeta.title}`;
      this.loadingLabel.hidden = false;
    } else if (loading === null) {
      this.loadingLabel.textContent = t('objects.loading');
    }
  }

  /** Re-renders labels after a language change. */
  refresh(): void {
    for (const definition of OBJECT_DEFINITIONS) {
      const tile = this.tiles.get(definition.id);
      const label = tile?.querySelector('.tile__label');
      if (label) label.textContent = t(definition.labelKey);
    }
  }

  dispose(): void {
    this.unsubscribe();
  }
}

/** Convenience export so the app can reuse the definition list. */
export const objectDefinitions = OBJECT_DEFINITIONS;
export type { TranslationKey };
export { button };
