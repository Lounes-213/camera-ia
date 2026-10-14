/**
 * Tabs — the mobile/desktop section switcher (Objects / Search / Style /
 * Transform / Room / Export). Horizontally scrollable on phones and mirrored
 * automatically in RTL layouts.
 */
import { el } from '../dom';
import { iconElement, type IconName } from '../icon';
import { t, type TranslationKey } from '../i18n';
import type { TabId } from '../../app/state';

export interface TabDefinition {
  id: TabId;
  labelKey: TranslationKey;
  icon: IconName;
}

export class Tabs {
  readonly element: HTMLElement;
  private readonly buttons = new Map<TabId, HTMLButtonElement>();

  constructor(
    private readonly tabs: TabDefinition[],
    current: TabId,
    private readonly onSelect: (tab: TabId) => void,
  ) {
    this.element = el('div', { class: 'sheet__tabs', role: 'tablist' });
    for (const tab of this.tabs) {
      const button = el(
        'button',
        {
          class: 'tab',
          type: 'button',
          role: 'tab',
          attrs: {
            'aria-selected': String(tab.id === current),
            'aria-label': t(tab.labelKey),
            'data-hand-clickable': '',
          },
          on: { click: () => this.onSelect(tab.id) },
        },
        iconElement(tab.icon, { size: 16 }),
        el('span', { text: t(tab.labelKey) }),
      );
      this.buttons.set(tab.id, button);
      this.element.appendChild(button);
    }
    this.setActive(current);
  }

  /** Highlights the given tab. */
  setActive(tab: TabId): void {
    for (const [id, button] of this.buttons) {
      button.setAttribute('aria-selected', String(id === tab));
    }
  }

  /** Re-renders labels after a language change. */
  refresh(): void {
    for (const tab of this.tabs) {
      const button = this.buttons.get(tab.id);
      const label = button?.querySelector('span');
      if (label) label.textContent = t(tab.labelKey);
      button?.setAttribute('aria-label', t(tab.labelKey));
    }
  }
}
