/**
 * Sidebar — the docked desktop control surface.
 *
 * Hosts the mode switch, the tab strip and the active panel, plus a keyboard
 * shortcut cheat sheet. It collapses to a slim rail so the AR view can fill the
 * screen. Mirrors in RTL because every offset is logical.
 */
import { appStore } from '../../app/appStore';
import { el } from '../dom';
import { iconElement } from '../icon';
import { t } from '../i18n';
import { Tabs, type TabDefinition } from './Tabs';
import { PanelHost, type PanelHostCallbacks } from './PanelHost';
import { HandModeToggle } from './HandModeToggle';
import { iconButton } from './controls';
import type { AppMode, TabId } from '../../app/state';

export interface SidebarOptions extends PanelHostCallbacks {
  onModeChange: (mode: AppMode) => void;
  onOpenHelp: () => void;
}

const TABS: TabDefinition[] = [
  { id: 'objects', labelKey: 'tabs.objects', icon: 'Shapes' },
  { id: 'search', labelKey: 'tabs.search', icon: 'Sparkles' },
  { id: 'style', labelKey: 'tabs.style', icon: 'Palette' },
  { id: 'transform', labelKey: 'tabs.transform', icon: 'Move3d' },
  { id: 'room', labelKey: 'tabs.room', icon: 'Users' },
  { id: 'export', labelKey: 'tabs.export', icon: 'Download' },
];

const SHORTCUTS: { keys: string; key: string }[] = [
  { keys: 'R', key: 'shortcuts.reset' },
  { keys: 'S', key: 'shortcuts.snapshot' },
  { keys: 'T', key: 'shortcuts.theme' },
  { keys: 'L', key: 'shortcuts.language' },
  { keys: 'Space', key: 'shortcuts.autoRotate' },
  { keys: '1-7', key: 'shortcuts.objects' },
  { keys: 'H', key: 'shortcuts.hands' },
  { keys: 'F', key: 'shortcuts.search' },
  { keys: 'M', key: 'shortcuts.room' },
  { keys: 'D', key: 'shortcuts.debug' },
];

export class Sidebar {
  readonly element: HTMLElement;
  private readonly tabs: Tabs;
  private readonly host: PanelHost;
  private readonly modeToggle: HandModeToggle;
  private readonly unsubscribe: () => void;
  private readonly shortcutsCard: HTMLElement;

  constructor(options: SidebarOptions) {
    this.modeToggle = new HandModeToggle({ onChange: (mode) => options.onModeChange(mode) });
    this.host = new PanelHost(options);
    this.tabs = new Tabs(TABS, appStore.getState().ui.tab, (tab) => this.select(tab));

    const collapse = iconButton('ChevronLeft', t('a11y.closePanel'), () => {
      const ui = appStore.getState().ui;
      appStore.setState({ ui: { ...ui, sidebarCollapsed: !ui.sidebarCollapsed } });
    });
    collapse.classList.add('sidebar__collapse');

    this.shortcutsCard = el(
      'section',
      { class: 'glass panel' },
      el(
        'h2',
        { class: 'panel__title' },
        el('span', { text: t('shortcuts.title') }),
        el('span', { class: 'grow' }),
        el('button', {
          class: 'tiny',
          type: 'button',
          text: '?',
          on: { click: () => options.onOpenHelp() },
        }),
      ),
      el(
        'div',
        { class: 'shortcuts' },
        ...SHORTCUTS.map((shortcut) =>
          el(
            'div',
            { class: 'shortcut' },
            el('span', { class: 'muted', text: t(shortcut.key as 'shortcuts.reset') }),
            el('kbd', { text: shortcut.keys }),
          ),
        ),
      ),
    );

    this.element = el(
      'aside',
      { class: 'sidebar', attrs: { 'aria-label': t('a11y.openPanel') } },
      collapse,
      this.modeToggle.element,
      el('div', { class: 'glass panel' }, this.tabs.element, this.host.element),
      this.shortcutsCard,
    );

    this.host.show(appStore.getState().ui.tab);
    this.unsubscribe = appStore.subscribe(() => this.sync());
    this.sync();
  }

  private select(tab: TabId): void {
    appStore.setState({ ui: { ...appStore.getState().ui, tab } });
    this.tabs.setActive(tab);
    this.host.show(tab);
  }

  private sync(): void {
    const ui = appStore.getState().ui;
    this.tabs.setActive(ui.tab);
    this.host.show(ui.tab);
    this.element.classList.toggle('sidebar--collapsed', ui.sidebarCollapsed);
    void iconElement;
  }

  /** Re-renders after a language change. */
  refresh(): void {
    this.tabs.refresh();
    this.host.refresh();
  }

  dispose(): void {
    this.unsubscribe();
    this.host.dispose();
    this.modeToggle.dispose();
  }
}
