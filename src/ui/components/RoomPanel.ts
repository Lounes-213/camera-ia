/**
 * RoomPanel — create / join a shared room.
 *
 * Shows the 5-character code, a QR code and a share link; lists connected peers
 * with their round-trip time; exposes the "control lock" and emoji reactions.
 * Only *state* is synced — video never leaves the device — and the panel says so
 * explicitly so the privacy model is obvious.
 */
import qrcode from 'qrcode-generator';
import { appStore } from '../../app/appStore';
import { CONFIG } from '../../app/config';
import { el, replace } from '../dom';
import { iconElement } from '../icon';
import { t } from '../i18n';
import { button, badges } from './controls';
import type { RoomState } from '../../app/state';

export interface RoomPanelOptions {
  onCreate: () => void;
  onJoin: (code: string) => void;
  onLeave: () => void;
  onRequestControl: () => void;
  onReaction: (emoji: string) => void;
}

const REACTIONS = ['👍', '🔥', '😮', '🎉', '👏', '💡'];

export class RoomPanel {
  readonly element: HTMLElement;
  private readonly body: HTMLElement;
  private readonly codeInput: HTMLInputElement;
  private readonly unsubscribe: () => void;

  constructor(private readonly options: RoomPanelOptions) {
    this.body = el('div', { class: 'stack' });
    this.codeInput = el('input', {
      class: 'search-input',
      placeholder: t('room.joinPlaceholder'),
      attrs: {
        'aria-label': t('room.joinCode'),
        maxlength: '5',
        autocapitalize: 'characters',
        autocomplete: 'off',
        spellcheck: 'false',
      },
    }) as HTMLInputElement;
    this.codeInput.addEventListener('input', () => {
      this.codeInput.value = this.codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    });
    this.codeInput.addEventListener('keydown', (event) => {
      if ((event as KeyboardEvent).key === 'Enter') options.onJoin(this.codeInput.value);
    });

    this.element = el(
      'section',
      { class: 'stack' },
      el(
        'div',
        { class: 'stack', style: { gap: '2px' } },
        el('h2', { class: 'panel__title', text: t('room.title') }),
        el('p', { class: 'tiny', text: t('room.subtitle') }),
      ),
      CONFIG.features.rooms ? null : el('p', { class: 'panel__hint', text: t('hands.disabled') }),
      this.body,
    );

    this.unsubscribe = appStore.subscribe(() => this.render());
    this.render();
  }

  private render(): void {
    const state = appStore.getState().room;
    replace(this.body, state.code ? this.connectedView(state) : this.lobbyView());
  }

  private lobbyView(): HTMLElement {
    return el(
      'div',
      { class: 'stack' },
      button({
        label: t('room.create'),
        icon: 'Plus',
        variant: 'primary',
        block: true,
        onClick: () => this.options.onCreate(),
      }),
      el(
        'div',
        { class: 'row' },
        el('span', { class: 'grow search-field' }, this.codeInput),
        button({
          label: t('room.join'),
          icon: 'LogIn',
          onClick: () => this.options.onJoin(this.codeInput.value),
        }),
      ),
      el('p', { class: 'panel__hint', text: t('room.tryWifi') }),
      el('p', { class: 'tiny', text: t('privacy.sharedRoom') }),
    );
  }

  private connectedView(state: RoomState): HTMLElement {
    const shareLink = `${window.location.origin}${window.location.pathname}?room=${state.code}`;
    const qr = el('div', { class: 'qr' });
    try {
      const code = qrcode(0, 'M');
      code.addData(shareLink);
      code.make();
      qr.innerHTML = code.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
    } catch (err) {
      console.warn('[room] QR generation failed', err);
    }

    const statusKey =
      state.status === 'connected'
        ? 'room.connected'
        : state.status === 'reconnecting'
          ? 'room.reconnecting'
          : state.status === 'failed'
            ? 'room.failed'
            : 'room.connecting';

    const peers = el(
      'div',
      { class: 'list' },
      ...state.peers.map((peer) =>
        el(
          'div',
          { class: 'card__row' },
          el(
            'span',
            { class: 'row' },
            iconElement(peer.isHost ? 'Crown' : 'User', { size: 14 }),
            el('span', { class: 'truncate', text: peer.name }),
          ),
          el('span', { class: 'tiny', text: peer.latency ? t('room.latency', { ms: peer.latency }) : '' }),
        ),
      ),
    );

    return el(
      'div',
      { class: 'stack' },
      el('span', { class: 'badge badge--accent', text: t('room.youAreInRoom') }),
      el('p', { class: 'code-display', text: state.code ?? '' }),
      qr,
      el('p', { class: 'tiny', text: t('room.scanQr') }),
      el(
        'div',
        { class: 'row' },
        button({
          label: t('room.copy'),
          icon: 'Copy',
          block: true,
          onClick: async () => {
            try {
              await navigator.clipboard.writeText(shareLink);
            } catch {
              /* clipboard denied */
            }
          },
        }),
        button({
          label: t('room.share'),
          icon: 'Share2',
          block: true,
          onClick: async () => {
            if (navigator.share) {
              await navigator.share({ title: t('room.title'), text: state.code ?? '', url: shareLink }).catch(() => undefined);
            } else {
              await navigator.clipboard?.writeText(shareLink).catch(() => undefined);
            }
          },
        }),
      ),
      el('p', { class: 'tiny', text: t(statusKey as 'room.connected') }),
      state.peers.length > 0 ? peers : el('p', { class: 'tiny', text: t('room.waiting') }),
      badges([t('room.peers', { count: state.peers.length }), `max ${CONFIG.room.maxPeers}`]),
      state.controlHolder && state.controlHolder !== 'me'
        ? el(
            'p',
            { class: 'tiny' },
            el('span', { text: t('room.controlBusy', { name: state.controlHolder }) }),
          )
        : null,
      button({
        label: t('room.control'),
        icon: 'Pointer',
        block: true,
        onClick: () => this.options.onRequestControl(),
      }),
      el('p', { class: 'panel__hint', text: t('room.reactions') }),
      el(
        'div',
        { class: 'reactions' },
        ...REACTIONS.map((emoji) =>
          el('button', {
            class: 'reaction',
            type: 'button',
            text: emoji,
            attrs: { 'aria-label': emoji, 'data-hand-clickable': '' },
            on: { click: () => this.options.onReaction(emoji) },
          }),
        ),
      ),
      button({
        label: t('room.leave'),
        icon: 'LogOut',
        variant: 'danger',
        block: true,
        onClick: () => this.options.onLeave(),
      }),
    );
  }

  /** Re-renders after a language change. */
  refresh(): void {
    this.codeInput.placeholder = t('room.joinPlaceholder');
    this.render();
  }

  dispose(): void {
    this.unsubscribe();
  }
}
