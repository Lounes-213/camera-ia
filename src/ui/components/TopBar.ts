/**
 * TopBar — the floating glass header.
 *
 * Mobile   : logo + status chip, then theme / language / more.
 * Desktop  : adds the mode switch and the sidebar toggle.
 * Mirrors correctly in RTL because every offset is logical.
 */
import { el } from '../dom';
import { iconElement } from '../icon';
import { t } from '../i18n';
import { getThemeMode } from '../theme/ThemeManager';
import { iconButton } from './controls';
import { StatusChip } from './StatusChip';
import type { IconName } from '../icon';

export interface TopBarOptions {
  onToggleTheme: () => void;
  onCycleLanguage: () => void;
  onToggleSidebar: () => void;
  onOpenHelp: () => void;
  onOpenPrivacy: () => void;
  onOpenMarker: () => void;
}

export class TopBar {
  readonly element: HTMLElement;
  private readonly title: HTMLElement;
  private readonly status: StatusChip;
  private readonly themeButton: HTMLButtonElement;
  constructor(options: TopBarOptions) {
    this.title = el('span', { class: 'topbar__title', text: t('app.name') });
    this.status = new StatusChip();

    this.themeButton = iconButton('SunMoon', t('common.theme'), () => {
      options.onToggleTheme();
      this.refreshThemeIcon();
    });

    const brand = el(
      'div',
      { class: 'topbar__brand' },
      el('span', { class: 'topbar__logo' }, iconElement('Boxes', { size: 18 })),
      this.title,
    );

    const actions = el(
      'div',
      { class: 'topbar__actions' },
      this.themeButton,
      iconButton('Languages', t('common.language'), () => options.onCycleLanguage()),
    );

    this.element = el('header', { class: 'topbar' }, brand, this.status.element, actions);

    this.refreshThemeIcon();
    this.refreshLabels();
  }

  /** Re-renders all translated labels after a language change. */
  refreshLabels(): void {
    this.title.textContent = t('app.name');
    this.themeButton.setAttribute('aria-label', t('common.theme'));
  }

  dispose(): void {
    this.status.dispose();
  }

  private refreshThemeIcon(): void {
    const mode = getThemeMode();
    const icon = mode === 'dark' ? 'Moon' : mode === 'light' ? 'Sun' : 'SunMoon';
    this.themeButton.replaceChildren(iconElement(icon as IconName, { size: 20 }));
  }

  /** Exposed so the app can keep the chip in sync with AR state. */
  get statusChip(): StatusChip {
    return this.status;
  }
}
