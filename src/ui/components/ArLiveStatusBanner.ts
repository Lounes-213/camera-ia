/**
 * ArLiveStatusBanner — prominent floating on-screen HUD status banner.
 *
 * Displays live feedback so the user always sees what the AI is doing:
 *  - 🖐️ رصد اليد (Hand Connected)
 *  - ⚡ تم الإمساك بالمجسم! (OBJET SAISI / GRABBED)
 *  - ✍️ جاري الرسم ثلاثي الأبعاد (Air Writing Active)
 *  - 🧼 جاري مسح الخطوط (Gomme / Erasing)
 *  - ☝️ توجيه السبابة (Pointing with Sababa)
 */
import { el } from '../dom';

export class ArLiveStatusBanner {
  readonly element: HTMLElement;
  private readonly textNode: HTMLElement;
  private currentStatus = '';

  constructor(container: HTMLElement) {
    this.textNode = el('span', { class: 'ar-live-banner__text', text: '🖐️ وجّه يدك نحو الكاميرا (Montrez votre main)' });
    this.element = el(
      'div',
      { class: 'ar-live-banner glass' },
      this.textNode,
    );

    container.appendChild(this.element);
  }

  setStatus(text: string, kind: 'idle' | 'seized' | 'draw' | 'erase' | 'point' | 'warning' = 'idle'): void {
    if (this.currentStatus === text) return;
    this.currentStatus = text;
    this.textNode.textContent = text;

    this.element.className = `ar-live-banner glass ar-live-banner--${kind}`;
  }

  dispose(): void {
    this.element.remove();
  }
}
