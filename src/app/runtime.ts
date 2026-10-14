/**
 * Runtime registry.
 *
 * `App` fills these in during boot; `actions.ts` reads them. Keeping the
 * instances in one place means the UI layer never has to import a core module
 * and the heavy V2 modules can be created lazily and dropped when unused.
 */
import type { ARManager } from '../core/ar/ARManager';
import type { SceneManager } from '../core/scene/SceneManager';
import type { HandTracker } from '../core/hands/HandTracker';
import type { HandCursor } from '../core/hands/HandCursor';
import type { RoomManager } from '../core/network/RoomManager';
import type { ModelSearch } from '../core/search/ModelSearch';

export interface Runtime {
  ar: ARManager | null;
  scene: SceneManager | null;
  hands: HandTracker | null;
  cursor: HandCursor | null;
  room: RoomManager | null;
  search: ModelSearch | null;
}

export const runtime: Runtime = {
  ar: null,
  scene: null,
  hands: null,
  cursor: null,
  room: null,
  search: null,
};

/** True when the 3D scene and AR manager are both up. */
export function isSceneReady(): boolean {
  return runtime.ar !== null && runtime.scene !== null;
}
