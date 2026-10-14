/**
 * Typed publish/subscribe event bus used for cross-module messaging.
 *
 * The UI never imports Three.js/MediaPipe/PeerJS directly: it emits intents on
 * the bus and core modules react. That keeps the dependency direction one-way
 * (ui → events/actions → core).
 */
import type { TranslationKey } from '../ui/i18n';
import type {
  AppMode,
  ArPhase,
  ErrorCode,
  GestureType,
  HandsStatus,
  MaterialState,
  ModalId,
  ModelMeta,
  Quality,
  SearchState,
  TabId,
  ToastKind,
  TransformState,
} from './state';

export type Handler<T> = (payload: T) => void;

export class EventBus<Events> {
  private readonly handlers = new Map<keyof Events, Set<Handler<never>>>();

  /** Subscribe to an event. Returns an unsubscribe function. */
  on<K extends keyof Events>(type: K, handler: Handler<Events[K]>): () => void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(handler as Handler<never>);
    return () => {
      set?.delete(handler as Handler<never>);
    };
  }

  /** Subscribe for exactly one delivery. */
  once<K extends keyof Events>(type: K, handler: Handler<Events[K]>): () => void {
    const off = this.on(type, (payload) => {
      off();
      handler(payload);
    });
    return off;
  }

  /** Emit an event synchronously. Errors in one handler never block the rest. */
  emit<K extends keyof Events>(type: K, payload: Events[K]): void {
    const set = this.handlers.get(type);
    if (!set) return;
    for (const handler of [...set]) {
      try {
        (handler as Handler<Events[K]>)(payload);
      } catch (err) {
        console.error(`[events] handler for "${String(type)}" failed`, err);
      }
    }
  }

  /** Removes all handlers (used on teardown). */
  clear(): void {
    this.handlers.clear();
  }
}

/** Every event flowing through the app, with its payload type. */
export interface AppEvents {
  'ar:phase': { phase: ArPhase; error?: ErrorCode | null };
  'ar:target': { found: boolean };
  'ar:targets-checked': { available: boolean };
  'mode:change': { mode: AppMode };
  'object:change': { id: string; meta?: ModelMeta | null };
  'object:loading': { loading: boolean; progress?: number };
  'material:change': Partial<MaterialState>;
  'transform:change': Partial<TransformState>;
  'transform:reset': Record<string, never>;
  'capture:request': Record<string, never>;
  'capture:ready': { blob: Blob; dataUrl: string; shareText?: string };
  'export:request': Record<string, never>;
  'export:ready': { blob: Blob; name: string };
  'camera:switch': Record<string, never>;
  'camera:switched': { isFront: boolean };
  'camera:list': { devices: { id: string; label: string }[] };
  'render:pause': { paused: boolean };
  'ui:toast': { key?: TranslationKey; message?: string; kind?: ToastKind; ttl?: number };
  'ui:modal': { modal: ModalId };
  'ui:tab': { tab: TabId };
  'ui:sheet': { open: boolean; snap?: number };
  'theme:change': { resolved: 'light' | 'dark' };
  'lang:change': { lang: string };
  'perf:fps': { fps: number };
  'perf:quality': { quality: Quality };
  'hands:status': { status: HandsStatus; gesture: GestureType };
  'hands:available': { available: boolean };
  'room:state': Record<string, never>;
  'room:toast': { key: TranslationKey; vars?: Record<string, string | number>; kind?: ToastKind };
  'search:state': Partial<SearchState>;
  'search:load-model': { url: string; meta: ModelMeta };
  'hand:cursor': { x: number; y: number; pressed: boolean; visible: boolean };
  'object:needs-refresh': Record<string, never>;
  'app:ready': Record<string, never>;
}

/** Application-wide event bus. */
export const bus = new EventBus<AppEvents>();
