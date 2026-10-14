/**
 * actions.ts — the only way the UI mutates the world.
 *
 * Components import these functions; they never import Three.js, MediaPipe,
 * PeerJS or `fetch` directly. Each action updates the store, emits the matching
 * event and, when needed, lazily loads a V2 module (hands / rooms / search) so
 * the base bundle stays small.
 */
import { CONFIG } from './config';
import { appStore } from './appStore';
import { bus } from './events';
import { isSceneReady, runtime } from './runtime';
import type {
  AppMode,
  ArPhase,
  ErrorCode,
  MaterialState,
  ModalId,
  ModelMeta,
  SearchResult,
  TabId,
  ToastKind,
  TransformState,
} from './state';
import { OBJECT_IDS } from './state';
import { cycleLang, setLang, t, type TranslationKey } from '../ui/i18n';
import { cycleTheme } from '../ui/theme/ThemeManager';
import { storage } from '../utils/storage';
import { haptic } from '../utils/device';
import { downloadBlob, captureSnapshot, shareFile } from '../core/capture/Snapshot';
import { exportFilename, exportGLB } from '../core/capture/ExportGLB';

// ---- helpers ---------------------------------------------------------------

const setState = appStore.setState;

/** Shows a translated toast. */
export function toast(key: TranslationKey, kind: ToastKind = 'info', vars?: Record<string, string | number>): void {
  bus.emit('ui:toast', { message: t(key, vars), kind });
}

/** Shows a raw (already translated) toast. */
export function toastMessage(message: string, kind: ToastKind = 'info'): void {
  bus.emit('ui:toast', { message, kind });
}

/** Forwards a room notice to the toast layer (already translated by i18n). */
export function notice(key: TranslationKey, vars?: Record<string, string | number>): void {
  bus.emit('ui:toast', { message: t(key, vars), kind: 'info' });
}

// ---- lifecycle / AR --------------------------------------------------------

/** Updates the AR phase (called by ARManager callbacks). */
export function setPhase(phase: ArPhase, error: ErrorCode | null = null): void {
  setState({ phase, arError: error });
  bus.emit('ar:phase', { phase, error });
}

/** Updates the target-found indicator and drives the object fade. */
export function setTargetFound(found: boolean): void {
  if (appStore.getState().targetFound === found) return;
  setState({ targetFound: found });
  bus.emit('ar:target', { found });
  if (found) haptic(18);
}

// ---- mode ------------------------------------------------------------------

/** Switches between marker tracking and hand tracking. */
export async function setMode(mode: AppMode, force = false): Promise<void> {
  const state = appStore.getState();
  if (state.mode === mode && !force && (mode === 'hands' ? runtime.hands !== null : true)) return;

  setState({ mode });
  storage.save('mode', mode);
  bus.emit('mode:change', { mode });

  if (!isSceneReady() || !runtime.scene || !runtime.ar) return;

  if (mode === 'hands') {
    if (!CONFIG.features.hands) {
      toast('hands.disabled', 'warn');
      setState({ mode: 'marker' });
      return;
    }
    runtime.ar.pauseDetection();
    runtime.scene.setSpace('camera', runtime.ar.scene!);
    runtime.scene.setFade(0);
    const ok = await ensureHandTracker();
    if (!ok) {
      toast('hands.unavailable', 'error');
      setState({ mode: 'marker' });
      runtime.scene.setSpace('marker', runtime.ar.scene!);
      runtime.ar.resumeDetection();
      return;
    }
    runtime.hands?.setRunning(true);
    setState({ hands: { ...appStore.getState().hands, status: 'searching' } });
    bus.emit('hands:status', { status: 'searching', gesture: 'none' });
    toast('toast.handsOn', 'success');
  } else {
    runtime.hands?.setRunning(false);
    runtime.cursor?.hide();
    runtime.scene.setSpace('marker', runtime.ar.scene!);
    runtime.ar.resumeDetection();
    bus.emit('hands:status', { status: 'off', gesture: 'none' });
    setState({ hands: { ...appStore.getState().hands, status: 'off', gesture: 'none' } });
    toast('toast.handsOff', 'success');
  }
}

/** Lazily creates and starts the hand tracker. */
export async function ensureHandTracker(): Promise<boolean> {
  if (runtime.hands) return true;
  if (!runtime.ar) return false;
  try {
    const [{ HandTracker }, { HandCursor }] = await Promise.all([
      import('../core/hands/HandTracker'),
      import('../core/hands/HandCursor'),
    ]);
    const tracker = new HandTracker({
      getVideo: () => runtime.ar?.video ?? null,
      isMirrored: () => runtime.ar?.isFrontCamera() ?? false,
      onStatus: (status) => {
        setState({ hands: { ...appStore.getState().hands, status } });
        bus.emit('hands:status', { status, gesture: appStore.getState().hands.gesture });
      },
      onAvailable: (available) => {
        setState({ hands: { ...appStore.getState().hands, available } });
        bus.emit('hands:available', { available });
      },
    });
    const ok = await tracker.init();
    runtime.hands = tracker;
    runtime.cursor = new HandCursor();
    return ok;
  } catch (err) {
    console.warn('[actions] hand tracker failed', err);
    return false;
  }
}

/** Updates the hand-derived UI state (called by the frame loop). */
export function setHandsStatus(patch: Partial<{
  status: 'off' | 'loading' | 'searching' | 'found' | 'lost' | 'error';
  gesture: 'none' | 'pinch' | 'palm' | 'two-hands' | 'fist' | 'point';
  showSkeleton: boolean;
}>): void {
  const hands = { ...appStore.getState().hands, ...patch };
  setState({ hands });
  bus.emit('hands:status', { status: hands.status, gesture: hands.gesture });
}

/** Toggles the hand skeleton overlay. */
export function toggleSkeleton(): void {
  const hands = appStore.getState().hands;
  setHandsStatus({ showSkeleton: !hands.showSkeleton });
}

// ---- objects ---------------------------------------------------------------

/** Selects a procedural object by id. */
export function selectObject(id: string): void {
  if (!isSceneReady() || !runtime.scene) return;
  const meta = runtime.scene.setBuiltinObject(id, appStore.getState().material.color);
  setState({
    objectId: id,
    modelMeta: { ...meta, title: t(`objects.${id}` as TranslationKey) },
  });
  storage.save('objectId', id);
  bus.emit('object:change', { id, meta });
  haptic(10);
}

/** Selects a procedural object by its 1-based keyboard index. */
export function selectObjectByIndex(index: number): void {
  const id = OBJECT_IDS[index];
  if (id) selectObject(id);
}

/** Imports a user .glb/.gltf file (drag & drop or file picker). */
export async function importModelFile(file: File): Promise<void> {
  if (!runtime.scene) return;
  if (!/\.(glb|gltf)$/i.test(file.name)) {
    toast('objects.unsupportedFormat', 'error');
    return;
  }

  bus.emit('object:loading', { loading: true, progress: 0 });
  setState({ ui: { ...appStore.getState().ui, loading: 0 } });

  try {
    const meta = await runtime.scene.loadFromFile(file, (progress) => {
      const ratio = progress.ratio ?? 0;
      bus.emit('object:loading', { loading: true, progress: ratio });
      setState({ ui: { ...appStore.getState().ui, loading: ratio } });
    });
    commitModel(meta);
    toast('objects.loaded', 'success');
  } catch (err) {
    const message = (err as Error).message ?? '';
    if (message.includes('model-too-large')) {
      toast('objects.tooHeavy', 'error', { details: `${CONFIG.search.maxTriangleCount / 1000}k` });
    } else {
      toastMessage(message || t('errors.generic'), 'error');
    }
  } finally {
    bus.emit('object:loading', { loading: false });
    setState({ ui: { ...appStore.getState().ui, loading: null } });
  }
}

/** Loads a model chosen in the search sheet. */
export async function loadSearchResult(result: SearchResult): Promise<void> {
  if (!runtime.scene) return;
  const search = await ensureSearch();
  setState({ ui: { ...appStore.getState().ui, loading: 0 } });
  bus.emit('object:loading', { loading: true, progress: 0 });

  try {
    const buffer = await search.fetchModel(result, (ratio) => {
      bus.emit('object:loading', { loading: true, progress: ratio ?? 0 });
      setState({ ui: { ...appStore.getState().ui, loading: ratio ?? 0 } });
    });
    const blob = new Blob([buffer], { type: 'model/gltf-binary' });
    const objectUrl = URL.createObjectURL(blob);
    let meta: ModelMeta;
    try {
      meta = await runtime.scene.loadFromUrl(objectUrl, {
        id: result.id,
        title: result.title,
        author: result.author,
        license: result.license,
        sourceUrl: result.sourceUrl,
        provider: result.provider,
        triangles: result.triangles,
        bytes: buffer.byteLength,
        thumbnail: result.thumbnail,
      });
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
    commitModel(meta);
    toast('objects.loaded', 'success');
    runtime.room?.sendObject(appStore.getState().objectId, {
      provider: result.provider,
      id: result.id,
      downloadUrl: result.downloadUrl,
      title: result.title,
      author: result.author,
      license: result.license,
      sourceUrl: result.sourceUrl,
      thumbnail: result.thumbnail,
    });
  } catch (err) {
    const message = (err as Error).message ?? '';
    if (message.includes('model-too-large')) toast('objects.tooHeavy', 'error', { details: '10 MB' });
    else toastMessage(message || t('errors.generic'), 'error');
  } finally {
    bus.emit('object:loading', { loading: false });
    setState({ ui: { ...appStore.getState().ui, loading: null } });
  }
}

/** Applies a freshly loaded model everywhere it needs to be known. */
function commitModel(meta: ModelMeta): void {
  setState({ objectId: meta.id, modelMeta: meta });
  bus.emit('object:change', { id: meta.id, meta });
}

// ---- material / transform --------------------------------------------------

/** Updates material properties and persists them. */
export function updateMaterial(patch: Partial<MaterialState>): void {
  const material = runtime.scene
    ? runtime.scene.setMaterial(patch)
    : { ...appStore.getState().material, ...patch };
  setState({ material });
  storage.save('material', material);
  bus.emit('material:change', patch);
  runtime.room?.sendMaterial(patch);
}

/** Updates transform properties and persists them. */
export function updateTransform(patch: Partial<TransformState>): void {
  const transform = runtime.scene
    ? runtime.scene.setTransform(patch)
    : { ...appStore.getState().transform, ...patch };
  setState({ transform });
  storage.save('transform', transform);
  bus.emit('transform:change', patch);
  runtime.room?.sendTransform(patch);
}

/** Rotates by a drag delta. */
export function rotateBy(dx: number, dy: number): void {
  if (!runtime.scene) return;
  runtime.scene.rotateBy(dx, dy);
  updateTransform({ rotation: runtime.scene.getTransform().rotation });
}

/** Multiplies the scale. */
export function scaleBy(factor: number): void {
  if (!runtime.scene) return;
  runtime.scene.scaleBy(factor);
  updateTransform({ scale: runtime.scene.getTransform().scale });
}

/** Raises or lowers the object above the marker. */
export function heightBy(delta: number): void {
  if (!runtime.scene) return;
  runtime.scene.heightBy(delta);
  updateTransform({ height: runtime.scene.getTransform().height });
}

/** Restores the default transform. */
export function resetTransform(): void {
  if (!runtime.scene) return;
  const transform = runtime.scene.resetTransform();
  setState({ transform });
  storage.save('transform', transform);
  bus.emit('transform:reset', {});
  toast('transform.resetDone', 'info');
  haptic([10, 30, 10]);
}

/** Toggles auto-rotation. */
export function toggleAutoRotate(): void {
  updateTransform({ autoRotate: !appStore.getState().transform.autoRotate });
}

// ---- UI --------------------------------------------------------------------

/** Selects a panel tab. */
export function setTab(tab: TabId): void {
  setState({ ui: { ...appStore.getState().ui, tab, sheetOpen: true } });
  storage.save('tab', tab);
  bus.emit('ui:tab', { tab });
}

/** Opens or closes the mobile bottom sheet. */
export function setSheet(open: boolean, snap?: number): void {
  const ui = appStore.getState().ui;
  setState({
    ui: { ...ui, sheetOpen: open, sheetSnap: snap ?? (open ? Math.max(1, ui.sheetSnap) : 0) },
  });
  bus.emit('ui:sheet', { open, snap });
}

/** Sets the sheet's snap point (0 peek / 1 half / 2 full). */
export function setSheetSnap(snap: number): void {
  const ui = appStore.getState().ui;
  setState({ ui: { ...ui, sheetSnap: snap, sheetOpen: snap > 0 } });
  bus.emit('ui:sheet', { open: snap > 0, snap });
}

/** Opens a modal (or closes it with 'none'). */
export function showModal(modal: ModalId): void {
  setState({ ui: { ...appStore.getState().ui, modal } });
  bus.emit('ui:modal', { modal });
}

/** Closes any open modal. */
export function closeModal(): void {
  showModal('none');
}

/** Marks the onboarding as seen. */
export function completeOnboarding(): void {
  const ui = appStore.getState().ui;
  setState({ ui: { ...ui, onboardingSeen: true, modal: 'none' } });
  storage.save('onboardingSeen', true);
}

/** Toggles the FPS/debug overlay. */
export function toggleDebug(): void {
  const ui = appStore.getState().ui;
  setState({ ui: { ...ui, debug: !ui.debug } });
}

/** Collapses or expands the desktop sidebar. */
export function toggleSidebar(): void {
  const ui = appStore.getState().ui;
  setState({ ui: { ...ui, sidebarCollapsed: !ui.sidebarCollapsed } });
}

/** Cycles light → dark → system. */
export function toggleTheme(): void {
  const mode = cycleTheme();
  toast(
    mode === 'light' ? 'toast.themeLight' : mode === 'dark' ? 'toast.themeDark' : 'toast.themeSystem',
    'info',
  );
}

/** Cycles the UI language. */
export function toggleLanguage(): void {
  const lang = cycleLang();
  setState({ lang });
  toast('toast.languageChanged', 'info');
}

/** Sets a specific language. */
export function setLanguage(lang: 'en' | 'fr' | 'ar'): void {
  setLang(lang);
  setState({ lang });
  toast('toast.languageChanged', 'info');
}

/** Pauses or resumes rendering (battery / screenshot control). */
export function setPaused(paused: boolean): void {
  const phase: ArPhase = paused ? 'paused' : 'running';
  setPhase(phase);
  bus.emit('render:pause', { paused });
  toast(paused ? 'toast.paused' : 'toast.resumed', 'info');
}

// ---- capture / export ------------------------------------------------------

/** Composites the camera frame with the 3D overlay and opens the preview. */
export async function takeSnapshot(): Promise<void> {
  if (!runtime.ar || !runtime.scene) return;
  const { video, renderer, scene, camera } = runtime.ar;
  if (!video || !renderer || !scene || !camera) return;

  try {
    runtime.scene.beginExport();
    const result = await captureSnapshot({
      video,
      renderer,
      scene,
      camera,
      mirrored: appStore.getState().mode === 'hands',
      caption: snapshotCaption(),
    });
    bus.emit('capture:ready', {
      blob: result.blob,
      dataUrl: result.dataUrl,
      shareText: appStore.getState().modelMeta?.title,
    });
    showModal('snapshot');
    haptic(24);
  } catch (err) {
    console.warn('[actions] snapshot failed', err);
    toast('export.snapshotFailed', 'error');
  } finally {
    runtime.scene.endExport();
  }
}

/** Optional CC-BY credit line burned into the snapshot. */
function snapshotCaption(): string | undefined {
  const meta = appStore.getState().modelMeta;
  if (!meta || meta.builtin || !meta.author) return undefined;
  if (appStore.getState().ui.tab === 'export' && !meta.license) return undefined;
  return `${meta.title} — ${meta.author} (${meta.license ?? 'see credits'})`;
}

/** Downloads the current object as .glb. */
export async function exportCurrentGlb(): Promise<void> {
  if (!runtime.scene) return;
  const root = runtime.scene.getExportRoot();
  if (!root) return;
  toast('export.exporting', 'info');
  try {
    runtime.scene.beginExport();
    const blob = await exportGLB(root);
    const name = exportFilename(appStore.getState().modelMeta?.title ?? appStore.getState().objectId);
    downloadBlob(blob, name);
    bus.emit('export:ready', { blob, name });
    toast('export.exportDone', 'success');
  } catch (err) {
    console.warn('[actions] export failed', err);
    toast('export.exportFailed', 'error');
  } finally {
    runtime.scene.endExport();
  }
}

/** Shares a snapshot through the native share sheet when available. */
export async function shareSnapshot(blob: Blob, dataUrl: string): Promise<void> {
  const title = t('app.name');
  const ok = await shareFile(blob, `webar-${Date.now()}.jpg`, title, t('export.snapshot'));
  if (!ok) {
    // Fall back to a download so the action never silently does nothing.
    downloadBlob(blob, `webar-${Date.now()}.jpg`);
    toast('export.shareUnsupported', 'warn');
  }
  void dataUrl;
}

// ---- camera / fullscreen ---------------------------------------------------

/** Switches between the front and rear camera. */
export async function switchCamera(): Promise<boolean> {
  if (!runtime.ar) return false;
  try {
    const devices = await runtime.ar.listCameras();
    bus.emit('camera:list', { devices });
    await runtime.ar.switchCamera();
    const isFront = runtime.ar.isFrontCamera();
    bus.emit('camera:switched', { isFront });
    toast(isFront ? 'toast.cameraFront' : 'toast.cameraBack', 'info');
    return isFront;
  } catch (err) {
    console.warn('[actions] switchCamera failed', err);
    return false;
  }
}

/** Toggles fullscreen on the app root. */
export async function toggleFullscreen(): Promise<void> {
  try {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
    } else {
      await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
    }
  } catch (err) {
    console.warn('[actions] fullscreen failed', err);
  }
}

// ---- search (lazy) ---------------------------------------------------------

/** Lazily creates the search orchestrator. */
export async function ensureSearch() {
  if (runtime.search) return runtime.search;
  const { ModelSearch } = await import('../core/search/ModelSearch');
  const search = new ModelSearch({
    onState: (patch) => {
      setState({ search: { ...appStore.getState().search, ...patch } });
      bus.emit('search:state', patch);
    },
    lang: () => appStore.getState().lang,
  });
  runtime.search = search;
  return search;
}

/** Starts a debounced search from the sheet's text field. */
export async function searchModels(query: string): Promise<void> {
  const search = await ensureSearch();
  setState({ search: { ...appStore.getState().search, query, voiceAvailable: search.voiceAvailable } });
  search.search(query);
}

/** Runs a search immediately (Enter / suggestion chip). */
export async function searchModelsNow(query: string): Promise<void> {
  const search = await ensureSearch();
  setState({ search: { ...appStore.getState().search, query } });
  search.searchNow(query);
}

/** Turns on the optional semantic re-ranker. */
export async function enableSemanticSearch(): Promise<void> {
  const search = await ensureSearch();
  const ok = await search.enableSemantic();
  if (!ok) toast('search.error', 'warn');
}

/** Opens the search sheet and warms the optional worker. */
export async function openSearch(): Promise<void> {
  setTab('search');
  setSheet(true, 2);
  const search = await ensureSearch();
  search.warmSemantic();
}

// ---- rooms (lazy) ----------------------------------------------------------

/** Lazily creates the room manager. */
export async function ensureRoom() {
  if (runtime.room) return runtime.room;
  if (!CONFIG.features.rooms) return null;
  const { RoomManager } = await import('../core/network/RoomManager');
  const room = new RoomManager({
    onStateChanged: (state) => {
      setState({ room: state });
      bus.emit('room:state', {});
    },
    onSnapshot: (snapshot) => applyRemoteSnapshot(snapshot),
    onRemoteObject: (objectId, modelRef) => {
      void applyRemoteObject(objectId, modelRef);
    },
    onRemoteMaterial: (patch) => {
      const material = runtime.scene
        ? runtime.scene.setMaterial(patch)
        : { ...appStore.getState().material, ...patch };
      setState({ material });
      bus.emit('material:change', patch);
    },
    onRemoteTransform: (patch) => {
      const transform = runtime.scene
        ? runtime.scene.setTransform(patch)
        : { ...appStore.getState().transform, ...patch };
      setState({ transform });
      bus.emit('transform:change', patch);
    },
    onReaction: (emoji, name) => toastMessage(`${name} ${emoji}`, 'info'),
    onNotice: (key, vars) => notice(key, vars),
    getLocalSnapshot: () => {
      const state = appStore.getState();
      return {
        objectId: state.objectId,
        modelRef: null,
        material: state.material,
        transform: state.transform,
        ts: Date.now(),
        seq: 0,
      };
    },
  });
  runtime.room = room;
  return room;
}

/** Creates a room and returns its code. */
export async function createRoom(name = 'Host'): Promise<string | null> {
  const room = await ensureRoom();
  if (!room) return null;
  const code = await room.create(name);
  if (code) toast('room.connected', 'success');
  return code;
}

/** Joins a room by code. */
export async function joinRoom(code: string, name = 'Guest'): Promise<boolean> {
  const room = await ensureRoom();
  if (!room) return false;
  const ok = await room.join(code, name);
  if (!ok) toast('room.badCode', 'error');
  return ok;
}

/** Leaves the current room. */
export function leaveRoom(): void {
  runtime.room?.leave();
}

/** Sends an emoji reaction to the room. */
export function sendReaction(emoji: string): void {
  runtime.room?.sendReaction(emoji);
}

/** Requests the transform control lock. */
export function requestControl(): void {
  runtime.room?.requestControl();
}

/** Applies a full snapshot (late joiner or host resync). */
function applyRemoteSnapshot(snapshot: {
  objectId: string;
  material: MaterialState;
  transform: TransformState;
  modelRef: Parameters<typeof applyRemoteObject>[1];
}): void {
  if (runtime.scene) {
    runtime.scene.setMaterial(snapshot.material);
    runtime.scene.setTransform(snapshot.transform);
    if (OBJECT_IDS.includes(snapshot.objectId)) {
      runtime.scene.setBuiltinObject(snapshot.objectId, snapshot.material.color);
    }
  }
  setState({
    objectId: snapshot.objectId,
    material: snapshot.material,
    transform: snapshot.transform,
  });
  void applyRemoteObject(snapshot.objectId, snapshot.modelRef);
}

/** Applies an object change coming from a peer (downloads by reference). */
async function applyRemoteObject(
  objectId: string,
  modelRef: { downloadUrl: string; provider: string; id: string; title: string; author: string; license: string; sourceUrl: string } | null,
): Promise<void> {
  if (OBJECT_IDS.includes(objectId) && runtime.scene) {
    const meta = runtime.scene.setBuiltinObject(objectId, appStore.getState().material.color);
    setState({ objectId, modelMeta: { ...meta, title: t(`objects.${objectId}` as TranslationKey) } });
    bus.emit('object:change', { id: objectId, meta });
    return;
  }
  if (!modelRef || !runtime.scene) return;
  try {
    const search = await ensureSearch();
    const buffer = await search.fetchModel({
      id: modelRef.id,
      title: modelRef.title,
      author: modelRef.author,
      license: modelRef.license,
      sourceUrl: modelRef.sourceUrl,
      provider: modelRef.provider,
      downloadUrl: modelRef.downloadUrl,
    });
    const blob = new Blob([buffer], { type: 'model/gltf-binary' });
    const url = URL.createObjectURL(blob);
    const meta = await runtime.scene.loadFromUrl(url, {
      id: modelRef.id,
      title: modelRef.title,
      author: modelRef.author,
      license: modelRef.license,
      sourceUrl: modelRef.sourceUrl,
      provider: modelRef.provider,
    });
    URL.revokeObjectURL(url);
    commitModel(meta);
  } catch (err) {
    console.warn('[actions] remote model failed', err);
  }
}

// ---- misc ------------------------------------------------------------------

/** Opens the marker download modal. */
export function openMarker(): void {
  showModal('marker');
}

/** Opens the credits modal. */
export function openCredits(): void {
  showModal('credits');
}

/** Opens the keyboard-shortcut help. */
export function openHelp(): void {
  showModal('shortcuts');
}

/** Opens the privacy note. */
export function openPrivacy(): void {
  showModal('privacy');
}
