/**
 * DebugOverlay — a compact diagnostics readout behind the debug toggle (D).
 *
 * It reports frame rate, the 3D quality level, tracking mode, gesture, room
 * latency and the model cache state — everything needed to diagnose a slow
 * device or a failed connection without opening devtools.
 */
import { appStore } from '../../app/appStore';
import { runtime } from '../../app/runtime';
import { el, replace } from '../dom';

export class DebugOverlay {
  readonly element: HTMLElement;
  private readonly unsubscribe: () => void;

  constructor() {
    this.element = el('div', { class: 'debug-overlay', hidden: true });
    this.unsubscribe = appStore.subscribe(() => this.render());
    this.render();
  }

  /** Called every frame with the smoothed frame rate. */
  setFps(fps: number): void {
    if (this.element.hidden) return;
    const line = this.element.querySelector('[data-metric="fps"]');
    if (line) line.textContent = `fps ${fps.toFixed(0)}`;
  }

  private render(): void {
    const state = appStore.getState();
    this.element.hidden = !state.ui.debug;
    if (this.element.hidden) return;

    const peers = state.room.peers.length;
    const latency = state.room.peers[0]?.latency ?? 0;

    replace(
      this.element,
      el('span', { dataset: { metric: 'fps' }, text: `fps ${state.perf.fps.toFixed(0)}` }),
      el('span', { text: `quality ${state.perf.quality}` }),
      el('span', { text: `mode ${state.mode}` }),
      el('span', { text: `phase ${state.phase}` }),
      el('span', { text: `target ${state.targetFound ? 'found' : 'lost'}` }),
      el('span', { text: `object ${state.modelMeta?.triangles ?? '—'} △` }),
      state.mode === 'hands'
        ? el('span', { text: `gesture ${state.hands.gesture}` })
        : null,
      el('span', { text: `hands ${state.hands.status}` }),
      el('span', { text: `delegate ${runtime.hands?.activeDelegate ?? '—'}` }),
      state.room.code
        ? el('span', { text: `room ${state.room.code} • ${peers}p • ${latency}ms` })
        : null,
      el('span', { text: `cursors ${runtime.room?.remoteCursorCount ?? 0}` }),
      el('span', { text: `dpr ${(window.devicePixelRatio || 1).toFixed(2)}` }),
    );
  }

  dispose(): void {
    this.unsubscribe();
  }
}
