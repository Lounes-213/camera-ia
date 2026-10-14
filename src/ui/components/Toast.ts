/**
 * ToastStack — glass notifications with an icon per kind, auto-dismiss and a
 * reduced-motion friendly animation. Mounted once and fed by the event bus.
 */
import { bus } from '../../app/events';
import { el } from '../dom';
import { iconElement, type IconName } from '../icon';

const ICONS: Record<string, IconName> = {
  info: 'Info',
  success: 'CheckCircle2',
  warn: 'AlertTriangle',
  error: 'XCircle',
};

const DEFAULT_TTL = 2800;

export class ToastStack {
  readonly element: HTMLElement;
  private readonly unsubscribe: () => void;
  private readonly timers = new Set<number>();

  constructor() {
    this.element = el('div', {
      class: 'toast-stack',
      attrs: { 'aria-live': 'polite', 'aria-atomic': 'false' },
    });
    this.unsubscribe = bus.on('ui:toast', ({ message, kind = 'info', ttl }) => {
      if (!message) return;
      this.push(message, kind, ttl ?? DEFAULT_TTL);
    });
  }

  /** Adds a toast to the stack. */
  push(message: string, kind: string = 'info', ttl = DEFAULT_TTL): void {
    const icon = iconElement(ICONS[kind] ?? 'Info', { size: 16 });
    const toast = el(
      'div',
      { class: 'toast', role: 'status', dataset: { kind } },
      el('span', { class: 'toast__icon' }, icon),
      el('span', { class: 'toast__message', text: message }),
    );
    this.element.appendChild(toast);

    // Keep at most four visible; the oldest leaves early.
    while (this.element.childElementCount > 4) {
      const first = this.element.firstElementChild as HTMLElement | null;
      if (first) this.dismiss(first);
      else break;
    }

    const timer = window.setTimeout(() => this.dismiss(toast), ttl);
    this.timers.add(timer);
  }

  private dismiss(toast: HTMLElement): void {
    if (!toast.isConnected || toast.classList.contains('is-leaving')) return;
    toast.classList.add('is-leaving');
    window.setTimeout(() => toast.remove(), 180);
  }

  dispose(): void {
    this.unsubscribe();
    for (const timer of this.timers) window.clearTimeout(timer);
    this.timers.clear();
    this.element.remove();
  }
}
