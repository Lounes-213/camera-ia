/**
 * BottomSheet — the draggable mobile control surface.
 *
 * Three snap points (peek / half / full) driven by transform so the drag stays
 * on the compositor and never jitters. The handle supports touch and pointer
 * input, and the sheet is keyboard reachable (arrow keys move the snap point).
 * In RTL the sheet is unaffected because it is horizontally centred.
 */
import { appStore } from '../../app/appStore';
import { el, on } from '../dom';
import { t } from '../i18n';
import { Tabs, type TabDefinition } from './Tabs';
import { PanelHost, type PanelHostCallbacks } from './PanelHost';
import type { TabId } from '../../app/state';

export interface BottomSheetOptions extends PanelHostCallbacks {
  onSnapChange: (snap: number) => void;
}

const TABS: TabDefinition[] = [
  { id: 'objects', labelKey: 'tabs.objects', icon: 'Shapes' },
  { id: 'search', labelKey: 'tabs.search', icon: 'Sparkles' },
  { id: 'style', labelKey: 'tabs.style', icon: 'Palette' },
  { id: 'transform', labelKey: 'tabs.transform', icon: 'Move3d' },
  { id: 'room', labelKey: 'tabs.room', icon: 'Users' },
  { id: 'export', labelKey: 'tabs.export', icon: 'Download' },
];

/** Fraction of the sheet height visible at each snap point. */
const SNAPS = [0, 0.46, 1];

export class BottomSheet {
  readonly element: HTMLElement;
  private readonly tabs: Tabs;
  private readonly host: PanelHost;
  private readonly unsubscribe: () => void;
  private snap = 1;
  private dragging = false;
  private startY = 0;
  private startOffset = 0;
  private currentOffset = 0;
  private detachDrag: () => void;

  constructor(private readonly options: BottomSheetOptions) {
    this.host = new PanelHost(options);
    this.tabs = new Tabs(TABS, appStore.getState().ui.tab, (tab) => this.select(tab));

    const handle = el('div', {
      class: 'sheet__handle',
      attrs: { role: 'button', tabindex: '0', 'aria-label': t('common.dragHandle') },
    });

    const body = el('div', { class: 'sheet__body' }, this.host.element);

    this.element = el(
      'section',
      { class: 'sheet', attrs: { 'aria-label': t('a11y.openPanel') } },
      handle,
      this.tabs.element,
      body,
    );

    const dragHandle = handle as HTMLElement;
    this.detachDrag = on(dragHandle, 'pointerdown', (event) => this.onDragStart(event));
    const detachMove = on(window, 'pointermove', (event) => this.onDragMove(event));
    const detachUp = on(window, 'pointerup', () => this.onDragEnd());
    const previous = this.detachDrag;
    this.detachDrag = () => {
      previous();
      detachMove();
      detachUp();
    };

    handle.addEventListener('keydown', (event) => {
      const key = (event as KeyboardEvent).key;
      if (key === 'ArrowUp') this.setSnap(Math.min(2, this.snap + 1));
      if (key === 'ArrowDown') this.setSnap(Math.max(0, this.snap - 1));
    });

    this.unsubscribe = appStore.subscribe(() => this.sync());
    this.host.show(appStore.getState().ui.tab);
    this.sync();
  }

  private select(tab: TabId): void {
    appStore.setState({ ui: { ...appStore.getState().ui, tab, sheetOpen: true } });
    this.tabs.setActive(tab);
    this.host.show(tab);
    if (this.snap === 0) this.setSnap(1);
  }

  private sync(): void {
    const ui = appStore.getState().ui;
    this.tabs.setActive(ui.tab);
    this.host.show(ui.tab);
    if (ui.sheetSnap !== this.snap) this.setSnap(ui.sheetSnap);
    this.applyOffset();
  }

  /** Moves the sheet to a snap point (0/1/2). */
  setSnap(snap: number): void {
    this.snap = Math.max(0, Math.min(2, Math.round(snap)));
    this.options.onSnapChange(this.snap);
    this.applyOffset();
  }

  private applyOffset(): void {
    const height = this.element.getBoundingClientRect().height || window.innerHeight * 0.5;
    // Peek keeps the tabs visible; half/full open the body.
    const visible = SNAPS[this.snap] ?? 0;
    const hidden = height - Math.max(118, height * visible);
    this.currentOffset = hidden;
    this.element.style.transform = `translateY(${Math.max(0, hidden)}px)`;
  }

  private onDragStart(event: PointerEvent): void {
    this.dragging = true;
    this.startY = event.clientY;
    this.startOffset = this.currentOffset;
    (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
  }

  private onDragMove(event: PointerEvent): void {
    if (!this.dragging) return;
    const delta = event.clientY - this.startY;
    const height = this.element.getBoundingClientRect().height || 1;
    const next = Math.max(0, Math.min(height, this.startOffset + delta));
    this.element.style.transition = 'none';
    this.element.style.transform = `translateY(${next}px)`;
    this.currentOffset = next;
  }

  private onDragEnd(): void {
    if (!this.dragging) return;
    this.dragging = false;
    this.element.style.transition = '';
    const height = this.element.getBoundingClientRect().height || 1;
    const ratio = 1 - this.currentOffset / height;
    // Snap to the nearest of the three points.
    let best = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    SNAPS.forEach((snapValue, index) => {
      const distance = Math.abs(snapValue - ratio);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = index;
      }
    });
    this.setSnap(best);
  }

  /** Re-renders after a language change. */
  refresh(): void {
    this.tabs.refresh();
    this.host.refresh();
  }

  dispose(): void {
    this.detachDrag();
    this.unsubscribe();
    this.host.dispose();
  }
}
