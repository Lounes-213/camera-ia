/**
 * The single application store instance.
 *
 * Everything the UI reads lives here. Nothing outside `actions.ts` should call
 * `setState` directly.
 */
import { createStore } from './store';
import { createInitialState, type AppState } from './state';

export const appStore = createStore<AppState>(createInitialState(), 'app');

export type AppStore = typeof appStore;
