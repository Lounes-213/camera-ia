/**
 * ArLiveStatusBanner — prominent floating on-screen HUD status banner & bottom dock.
 *
 * Placed at the bottom of the screen ("taht"):
 *  - App Icon / Brand Pill ("icon de l'app taht")
 *  - Live Hand Gesture Indicator ("indicateur de la main")
 *  - Front/Back Camera Switch button for phones ("tbadel lcamera llqedam in kan b telephone")
 */
import { el } from '../dom';
import { iconElement } from '../icon';

export interface ArLiveStatusBannerOptions {
  container: HTMLElement;
  onSwitchCamera?: () => void;
}

export class ArLiveStatusBanner {
  readonly element: HTMLElement;
  private readonly brandNode: HTMLElement;
  private readonly textNode: HTMLElement;
  private readonly cameraBtn: HTMLButtonElement;
  private currentStatus = '';

  constructor(optionsOrContainer: HTMLElement | ArLiveStatusBannerOptions) {
    const options: ArLiveStatusBannerOptions =
      optionsOrContainer instanceof HTMLElement
        ? { container: optionsOrContainer }
        : optionsOrContainer;

    // 1. App Icon & Brand Badge at the bottom
    this.brandNode = el(
      'div',
      { class: 'ar-live-banner__brand', attrs: { title: 'WebAR Spatial Studio' } },
      el('span', { class: 'ar-live-banner__logo' }, iconElement('Boxes', { size: 16 })),
      el('span', { class: 'ar-live-banner__title', text: 'WebAR' }),
    );

    // 2. Hand Gesture Indicator at the bottom
    this.textNode = el('span', {
      class: 'ar-live-banner__text',
      text: '🖐️ وجّه يدك نحو الكاميرا (Montrez votre main)',
    });

    // 3. Fast Front/Back camera switcher button for phones
    this.cameraBtn = el(
      'button',
      {
        class: 'ar-live-banner__cam-btn',
        type: 'button',
        attrs: {
          title: 'تبديل الكاميرا للأمام / للخلف (Flip Camera)',
          'aria-label': 'تبديل الكاميرا',
          'data-hand-clickable': '',
        },
        on: {
          click: (e) => {
            e.stopPropagation();
            options.onSwitchCamera?.();
          },
        },
      },
      iconElement('SwitchCamera', { size: 15 }),
      el('span', { class: 'ar-live-banner__cam-label', text: 'Flip' }),
    ) as HTMLButtonElement;

    const divider1 = el('div', { class: 'ar-live-banner__divider' });
    const divider2 = el('div', { class: 'ar-live-banner__divider' });

    this.element = el(
      'div',
      { class: 'ar-live-banner glass ar-live-banner--idle' },
      this.brandNode,
      divider1,
      this.textNode,
      divider2,
      this.cameraBtn,
    );

    options.container.appendChild(this.element);
  }

  setStatus(
    text: string,
    kind: 'idle' | 'seized' | 'draw' | 'erase' | 'point' | 'warning' = 'idle',
  ): void {
    if (this.currentStatus === text) return;
    this.currentStatus = text;
    this.textNode.textContent = text;

    this.element.className = `ar-live-banner glass ar-live-banner--${kind}`;
  }

  dispose(): void {
    this.element.remove();
  }
}
