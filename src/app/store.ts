/**
 * Typed, dependency-free reactive store.
 *
 * A single mutable state object lives here; the rest of the app reads it through
 * `getState()`/`select()` and mutates it only through `setState()`. Subscribers
 * are notified per top-level key so components stay cheap.
 */

export type Listener<T> = (value: T, previous: T) => void;
export type Unsubscribe = () => void;

export interface Store<S extends object> {
  /** Current immutable snapshot (do not mutate). */
  getState(): Readonly<S>;
  /** Shallow-merge a patch, or derive one from the previous state. */
  setState(patch: Partial<S> | ((prev: Readonly<S>) => Partial<S>)): void;
  /** Read a derived slice. */
  select<T>(selector: (state: Readonly<S>) => T): T;
  /** Subscribe to any state change. Returns an unsubscribe function. */
  subscribe(listener: Listener<S>): Unsubscribe;
  /** Subscribe to a derived slice; fires only when the slice changes. */
  watch<T>(selector: (state: Readonly<S>) => T, listener: Listener<T>, equals?: (a: T, b: T) => boolean): Unsubscribe;
}

/**
 * Creates a tiny reactive store.
 * @param initial Initial state object.
 * @param name Optional name used in dev warnings.
 */
export function createStore<S extends object>(initial: S, name = 'store'): Store<S> {
  let state = initial;
  const listeners = new Set<Listener<S>>();

  const getState = (): Readonly<S> => state;

  const setState: Store<S>['setState'] = (patch) => {
    const delta = typeof patch === 'function' ? patch(state) : patch;
    const keys = Object.keys(delta) as (keyof S)[];
    if (keys.length === 0) return;

    let changed = false;
    for (const key of keys) {
      if (!Object.is(state[key], (delta as S)[key])) {
        changed = true;
        break;
      }
    }
    if (!changed) return;

    const previous = state;
    state = { ...state, ...delta };
    for (const listener of listeners) {
      try {
        listener(state, previous);
      } catch (err) {
        // A broken subscriber must never take down the render loop.
        console.error(`[${name}] subscriber failed`, err);
      }
    }
  };

  const select = <T,>(selector: (s: Readonly<S>) => T): T => selector(state);

  const subscribe: Store<S>['subscribe'] = (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };

  const watch: Store<S>['watch'] = (selector, listener, equals = Object.is) => {
    let current = selector(state);
    return subscribe((next) => {
      const value = selector(next);
      if (!equals(value, current)) {
        const previous = current;
        current = value;
        listener(value, previous);
      }
    });
  };

  return { getState, setState, select, subscribe, watch };
}
