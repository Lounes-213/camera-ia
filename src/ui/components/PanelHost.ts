/**
 * PanelHost — owns one instance of every tab panel and shows the active one.
 *
 * Panels are created lazily on first visit so heavy ones (search, room) never
 * cost anything until the user actually opens them. The sidebar and the mobile
 * sheet each get their own host, which keeps the responsive switch trivial.
 */
import { el } from '../dom';
import type { SearchResult, TabId } from '../../app/state';
import { ObjectPicker } from './ObjectPicker';
import { SearchSheet } from './SearchSheet';
import { StylePanel } from './StylePanel';
import { TransformPanel } from './TransformPanel';
import { ExportPanel } from './ExportPanel';
import { RoomPanel } from './RoomPanel';

export interface PanelHostCallbacks {
  onSelectObject: (id: string) => void;
  onImportModel: (file: File) => void;
  onMaterialChange: (patch: Record<string, unknown>) => void;
  onTransformChange: (patch: Record<string, unknown>) => void;
  onResetTransform: () => void;
  onSnapshot: () => void;
  onExportGlb: () => void;
  onFullscreen: () => void;
  onSwitchCamera: () => void;
  onToggleDebug: () => void;
  onOpenCredits: () => void;
  onSearch: (query: string) => void;
  onSearchNow: (query: string) => void;
  onLoadResult: (result: SearchResult) => void;
  onEnableSemantic: () => void;
  onCreateRoom: () => void;
  onJoinRoom: (code: string) => void;
  onLeaveRoom: () => void;
  onRequestControl: () => void;
  onReaction: (emoji: string) => void;
}

interface PanelInstance {
  element: HTMLElement;
  refresh?: () => void;
  dispose?: () => void;
}

export class PanelHost {
  readonly element: HTMLElement;
  private readonly instances = new Map<TabId, PanelInstance>();

  constructor(private readonly callbacks: PanelHostCallbacks) {
    this.element = el('div', { class: 'stack' });
  }

  /** Shows the panel for a tab, creating it on first use. */
  show(tab: TabId): void {
    const panel = this.get(tab);
    this.element.replaceChildren(panel);
  }

  /** Re-renders every already-created panel (language change). */
  refresh(): void {
    for (const instance of this.instances.values()) instance.refresh?.();
  }

  dispose(): void {
    for (const instance of this.instances.values()) instance.dispose?.();
    this.instances.clear();
  }

  private get(tab: TabId): HTMLElement {
    const existing = this.instances.get(tab);
    if (existing) return existing.element;

    const instance = this.create(tab);
    this.instances.set(tab, instance);
    return instance.element;
  }

  private create(tab: TabId): PanelInstance {
    const callbacks = this.callbacks;
    switch (tab) {
      case 'objects': {
        const panel = new ObjectPicker({
          onSelect: callbacks.onSelectObject,
          onImport: callbacks.onImportModel,
        });
        return { element: panel.element, refresh: () => panel.refresh(), dispose: () => panel.dispose() };
      }
      case 'search': {
        const panel = new SearchSheet({
          onSearch: callbacks.onSearch,
          onSearchNow: callbacks.onSearchNow,
          onLoad: callbacks.onLoadResult,
          onEnableSemantic: callbacks.onEnableSemantic,
        });
        return { element: panel.element, refresh: () => panel.refresh(), dispose: () => panel.dispose() };
      }
      case 'style': {
        const panel = new StylePanel({
          onChange: (patch) => callbacks.onMaterialChange(patch as Record<string, unknown>),
        });
        return { element: panel.element, refresh: () => panel.refresh(), dispose: () => panel.dispose() };
      }
      case 'transform': {
        const panel = new TransformPanel({
          onChange: (patch) => callbacks.onTransformChange(patch as Record<string, unknown>),
          onReset: callbacks.onResetTransform,
        });
        return { element: panel.element, refresh: () => panel.refresh(), dispose: () => panel.dispose() };
      }
      case 'room': {
        const panel = new RoomPanel({
          onCreate: callbacks.onCreateRoom,
          onJoin: callbacks.onJoinRoom,
          onLeave: callbacks.onLeaveRoom,
          onRequestControl: callbacks.onRequestControl,
          onReaction: callbacks.onReaction,
        });
        return { element: panel.element, refresh: () => panel.refresh(), dispose: () => panel.dispose() };
      }
      case 'export':
      default: {
        const panel = new ExportPanel({
          onSnapshot: callbacks.onSnapshot,
          onExportGlb: callbacks.onExportGlb,
          onFullscreen: callbacks.onFullscreen,
          onSwitchCamera: callbacks.onSwitchCamera,
          onToggleDebug: callbacks.onToggleDebug,
          onOpenCredits: callbacks.onOpenCredits,
        });
        return { element: panel.element, dispose: () => panel.dispose() };
      }
    }
  }
}
