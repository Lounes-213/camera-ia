/**
 * App — the composition root.
 *
 * It owns the DOM shell, boots the managers, runs the single requestAnimationFrame
 * loop and wires input, i18n, theme, modals and the PWA together. Everything the
 * user can see is assembled here from the `ui/components` modules; the components
 * themselves never touch Three.js or MediaPipe.
 */
import * as THREE from 'three';
import { CONFIG } from './config';
import { appStore } from './appStore';
import { bus } from './events';
import { runtime } from './runtime';
import type { AppMode, ErrorCode, ModelMeta } from './state';
import { OBJECT_DEFINITIONS } from '../core/objects/ObjectRegistry';
import { ARManager } from '../core/ar/ARManager';
import { SceneManager } from '../core/scene/SceneManager';
import { InputController } from '../core/input/InputController';
import { ticker } from '../utils/raf';
import { supportsCamera, supportsWebGL } from '../utils/device';
import { assetUrl } from '../utils/assets';
import { handToWorld } from '../core/hands/projection';
import { iconElement } from '../ui/icon';
import { initI18n, onLanguageChange, t, getLang } from '../ui/i18n';
import { initTheme, onThemeChange } from '../ui/theme/ThemeManager';
import { el } from '../ui/dom';
import { Modal } from '../ui/components/Modal';
import { TopBar } from '../ui/components/TopBar';
import { ErrorScreen } from '../ui/components/ErrorScreen';
import { DebugOverlay } from '../ui/components/DebugOverlay';
import { Onboarding } from '../ui/components/Onboarding';
import { HandsTutorial } from '../ui/components/HandsTutorial';
import { MarkerModal } from '../ui/components/MarkerModal';
import { SnapshotModal } from '../ui/components/SnapshotModal';
import { CreditsModal } from '../ui/components/CreditsModal';
import { iconButton } from '../ui/components/controls';
import { HandSkeletonOverlay } from '../core/hands/HandSkeletonOverlay';
import { AirDrawManager } from '../core/drawing/AirDrawManager';
import { SpatialGrabManager } from '../core/objects/SpatialGrabManager';
import type { ArInteractionMode } from '../ui/components/ArControlDock';
import { AirInteractiveToolbar, type AirToolId } from '../core/hands/AirInteractiveToolbar';
import { SpatialPaperKeyboard } from '../core/ocr/SpatialPaperKeyboard';
import { YouTubeSpatialPlayer } from '../core/youtube/YouTubeSpatialPlayer';
import { ArLiveStatusBanner } from '../ui/components/ArLiveStatusBanner';
import * as actions from './actions';

export class App {
  private readonly stage: HTMLElement;
  private readonly flash: HTMLElement;
  private readonly targetRing: HTMLElement;
  private readonly shutter: HTMLButtonElement;
  private readonly toolRail: HTMLElement;
  private readonly errorScreen: ErrorScreen;
  private readonly debugOverlay: DebugOverlay;
  private readonly topBar: TopBar;
  private spatialPaper: SpatialPaperKeyboard | null = null;
  private youtubePlayer: YouTubeSpatialPlayer | null = null;
  private airToolbar: AirInteractiveToolbar | null = null;
  private liveBanner: ArLiveStatusBanner | null = null;
  private skeletonOverlay: HandSkeletonOverlay | null = null;
  private airDraw: AirDrawManager | null = null;
  private spatialGrab: SpatialGrabManager | null = null;
  private interactionMode: ArInteractionMode = 'hands';
  private activeAirTool: AirToolId = 'pen';
  private isAirDrawingActive = false;
  private input: InputController | null = null;
  private modal: { element: HTMLElement } | null = null;
  private disposeFns: (() => void)[] = [];

  private handInitialised = false;
  private twoHandReference: { distance: number; scale: number } | null = null;
  private lastTriggerPinching = false;
  private lastScrollPoint: { x: number; y: number } | null = null;

  constructor(private readonly root: HTMLElement) {
    this.stage = el('div', { class: 'stage', attrs: { 'aria-label': t('a11y.arView') } });
    this.flash = el('div', { class: 'flash' });
    this.targetRing = el('div', { class: 'target-ring' });
    this.shutter = el('button', {
      class: 'shutter only-mobile',
      type: 'button',
      attrs: { 'aria-label': t('a11y.snapshotButton'), 'data-hand-clickable': '' },
    }) as HTMLButtonElement;
    this.shutter.addEventListener('click', () => void actions.takeSnapshot());
    this.shutter.replaceChildren(iconElement('Camera', { size: 26 }));

    this.toolRail = el('div', { class: 'tool-rail only-mobile' });
    this.errorScreen = new ErrorScreen({
      onRetry: () => void this.startAR(),
      onMarker: () => actions.openMarker(),
    });
    this.debugOverlay = new DebugOverlay();
    this.topBar = new TopBar({
      onToggleTheme: () => actions.toggleTheme(),
      onCycleLanguage: () => actions.toggleLanguage(),
      onToggleSidebar: () => this.toggleSidebar(),
      onOpenHelp: () => actions.openHelp(),
      onOpenPrivacy: () => actions.openPrivacy(),
      onOpenMarker: () => actions.openMarker(),
    });
  }

  /** Boots the app: shell, managers, AR, frame loop, listeners. */
  async boot(): Promise<void> {
    initTheme();
    initI18n();

    this.skeletonOverlay = new HandSkeletonOverlay({
      container: this.stage,
      enabled: appStore.getState().hands.showSkeleton,
    });

    this.airToolbar = new AirInteractiveToolbar({
      container: this.root,
      initialTool: this.activeAirTool,
      skeletonEnabled: this.skeletonOverlay.isEnabled,
      onToolSelected: (tool) => this.handleAirToolSelected(tool),
    });

    this.spatialPaper = new SpatialPaperKeyboard({
      container: this.root,
      onTextUpdated: (text) => {
        this.liveBanner?.setStatus(`📝 النص المكتوب: "${text}"`, 'draw');
      },
      onStatusChange: (action, char) => {
        if (action === 'typed') {
          this.liveBanner?.setStatus(`⚡ تم كتابة الحرف [ ${char} ] بنقرة اليد الخارجية!`, 'seized');
        } else if (action === 'pointing') {
          this.liveBanner?.setStatus(`☝️ تشير بالسبابة إلى [ ${char} ] — انقر بأصابع اليد الثانية 👌 خارج الكيبورد!`, 'draw');
        } else if (action === 'miss') {
          this.liveBanner?.setStatus('⚠️ وجّه السبابة نحو أحد الحروف أولاً ثم انقر باليد الأخرى!', 'idle');
        }
      },
      onSpawn3DText: (text) => this.spawn3DText(text),
      onClose: () => {
        this.airToolbar?.setPaperOcrActive(false);
        this.liveBanner?.setStatus('✨ تم إغلاق لوحة الكتابة', 'idle');
      },
    });

    this.youtubePlayer = new YouTubeSpatialPlayer({
      container: this.root,
      onStatusChange: (msg, kind) => {
        this.liveBanner?.setStatus(msg, kind);
      },
      onClose: () => {
        this.airToolbar?.setYouTubeActive(false);
        this.liveBanner?.setStatus('تم إغلاق يوتيوب AR', 'idle');
      },
    });

    this.liveBanner = new ArLiveStatusBanner(this.root);

    this.root.append(
      this.stage,
      el('div', { class: 'stage-scrim' }),
      this.targetRing,
      this.flash,
      this.topBar.element,
      this.liveBanner.element,
      this.debugOverlay.element,
      this.errorScreen.element,
      this.shutter,
      this.toolRail,
    );

    this.buildResponsiveChrome();
    this.wireEvents();
    this.wireCanvasPointerEvents();
    this.wirePwa();

    // Language changes re-render every translated surface.
    this.disposeFns.push(
      onLanguageChange(() => this.refreshTranslations()),
      onThemeChange((theme) => bus.emit('theme:change', { resolved: theme })),
    );

    if (!this.checkEnvironment()) return;

    actions.setPhase('loading', null);
    await this.startAR();
  }

  // ---- environment ---------------------------------------------------------

  /** Verifies the platform can run the experience at all. */
  private checkEnvironment(): boolean {
    if (!window.isSecureContext) {
      this.errorScreen.show('insecure');
      return false;
    }
    if (!supportsWebGL()) {
      this.errorScreen.show('webgl');
      return false;
    }
    if (!supportsCamera()) {
      this.errorScreen.show(
        typeof navigator.mediaDevices === 'undefined' ? 'unsupported' : 'no-camera',
      );
      return false;
    }
    return true;
  }

  // ---- AR ------------------------------------------------------------------

  /** Creates the managers (once) and starts tracking. */
  private async startAR(): Promise<void> {
    try {
      if (!runtime.ar) {
        runtime.ar = new ARManager({
          container: this.stage,
          onPhase: (phase, error) => this.onPhase(phase, error ?? null),
          onTarget: (found) => actions.setTargetFound(found),
        });

        const ok = await runtime.ar.init();
        if (!ok) return;

        runtime.scene = new SceneManager({
          scene: runtime.ar.scene!,
          camera: runtime.ar.camera!,
          renderer: runtime.ar.renderer!,
          anchorGroup: runtime.ar.anchorGroup!,
          material: appStore.getState().material,
          transform: appStore.getState().transform,
          quality: appStore.getState().perf.quality,
        });
        runtime.scene.applyQuality(appStore.getState().perf.quality);

        // Restore the last object, or build the default one.
        const state = appStore.getState();
        const definition = OBJECT_DEFINITIONS.find((entry) => entry.id === state.objectId);
        if (definition) {
          const meta = runtime.scene.setBuiltinObject(definition.id, state.material.color);
          appStore.setState({
            modelMeta: { ...meta, title: t(definition.labelKey) },
          });
        }

        this.airDraw = new AirDrawManager(runtime.ar.scene!);
        this.spatialGrab = new SpatialGrabManager({
          scene: runtime.ar.scene!,
          camera: runtime.ar.camera!,
          targetObject: runtime.scene.holder,
        });

        this.startFrameLoop();
      }

      this.errorScreen.hide();
      await runtime.ar.start();
      await this.handleInteractionModeChange(this.interactionMode);
    } catch (err) {
      console.error('[app] failed to start AR', err);
      this.onPhase('error', 'generic');
    }
  }

  private onPhase(phase: Parameters<typeof actions.setPhase>[0], error: ErrorCode | null): void {
    actions.setPhase(phase, error);
    if (phase === 'error') {
      this.errorScreen.show(error ?? 'generic');
      if (error === 'context-lost') {
        // A lost context is transient: try to bring it back without a reload.
        window.setTimeout(() => {
          if (appStore.getState().arError === 'context-lost') void this.startAR();
        }, 1200);
      }
    } else {
      this.errorScreen.hide();
    }
  }

  // ---- frame loop ----------------------------------------------------------

  /** Starts the single RAF loop that drives everything. */
  private startFrameLoop(): void {
    this.disposeFns.push(
      ticker.add((dt, elapsed) => this.frame(dt, elapsed), 0),
    );
  }

  private frame(dt: number, elapsed: number): void {
    const state = appStore.getState();
    if (!runtime.scene || !runtime.ar) return;

    // 3D: animation, fade, auto-rotate.
    const visible =
      state.mode === 'hands'
        ? state.hands.status === 'found' || this.handInitialised
        : state.targetFound;
    runtime.scene.update(dt, elapsed, visible);

    // Hand tracking (markerless mode).
    if (state.mode === 'hands') this.updateHands(dt, elapsed);

    // Rooms: throttled sync, heartbeat, remote cursors.
    runtime.room?.tick(dt, performance.now());

    // Draw the frame.
    runtime.ar.render();

    // Performance sampling → adaptive quality.
    this.samplePerformance(dt);

    if (state.ui.debug) this.debugOverlay.setFps(ticker.getFps());
  }

  /**
   * Applies the latest hand pose to the anchored object.
   * Grab/release is pinch driven; rotation follows the palm normal; two hands
   * scale by their distance.
   */
  private updateHands(_dt: number, _elapsed: number): void {
    const tracker = runtime.hands;
    const scene = runtime.scene;
    const camera = runtime.ar?.camera;
    if (!tracker || !scene || !camera) return;

    const gesture = tracker.sample(performance.now(), {
      fov: camera.fov,
      aspect: camera.aspect,
    });
    if (!gesture) return;

    scene.setHandGesture(gesture.gesture);
    actions.setHandsStatus({ gesture: gesture.gesture });

    // 1. Render glowing skeleton & joints overlay on screen
    if (this.skeletonOverlay) {
      this.skeletonOverlay.render(gesture.poses, gesture.gesture);
    }

    const pose = gesture.poses[gesture.primaryIndex];
    if (!pose) {
      this.handInitialised = false;
      if (this.isAirDrawingActive) {
        this.airDraw?.endStroke();
        this.skeletonOverlay?.endStroke2D();
        this.isAirDrawingActive = false;
      }
      runtime.cursor?.hide();
      this.liveBanner?.setStatus('📷 وجّه يدك نحو الكاميرا (Montrez votre main)', 'idle');
      return;
    }

    // 2. Index fingertip apex (Landmark 8) shifted higher up ("zidlu lfuq chwiya")
    const indexPt = pose.landmarks[8] ?? pose.center;
    const dipPt = pose.landmarks[7] ?? indexPt;
    const thumbPt = pose.landmarks[4] ?? indexPt;

    const dirX = indexPt.x - dipPt.x;
    const dirY = indexPt.y - dipPt.y;
    const dirLen = Math.hypot(dirX, dirY) || 1;
    // Apex of index fingertip nail, shifted slightly higher up ("zidlu lfuq chwiya")
    const screenX = indexPt.x + (dirX / dirLen) * 0.022;
    const screenY = indexPt.y + (dirY / dirLen) * 0.022 - 0.022;

    // Contact point between thumb and index (where the pen is held) - raised higher up as requested
    const penTipX = (indexPt.x + thumbPt.x) * 0.5;
    const penTipY = (indexPt.y + thumbPt.y) * 0.5 - 0.038;

    // Touch distance between thumb tip (Landmark 4) & index tip (Landmark 8)
    const touchDist = Math.hypot(indexPt.x - thumbPt.x, indexPt.y - thumbPt.y);
    // The pen is held ONLY when thumb and index physically touch in the "bien" sign 👌
    const isPenHolding = pose.pinching && touchDist < 0.075;

    // Collect all detected hands with their index fingertip apex and pinch status
    const dualHands = gesture.poses.map((p) => {
      const pIndex = p.landmarks[8] ?? p.center;
      const pDip = p.landmarks[7] ?? pIndex;
      const pThumb = p.landmarks[4] ?? pIndex;
      const pDirX = pIndex.x - pDip.x;
      const pDirY = pIndex.y - pDip.y;
      const pDirLen = Math.hypot(pDirX, pDirY) || 1;
      const pIndexX = pIndex.x + (pDirX / pDirLen) * 0.022;
      const pIndexY = pIndex.y + (pDirY / pDirLen) * 0.022 - 0.022;
      const pPinchX = (pIndex.x + pThumb.x) * 0.5;
      const pPinchY = (pIndex.y + pThumb.y) * 0.5 - 0.038;
      const pDist = Math.hypot(pIndex.x - pThumb.x, pIndex.y - pThumb.y);
      const pIsPinching = p.pinching || pDist < 0.075;
      return {
        indexX: pIndexX,
        indexY: pIndexY,
        pinchX: pPinchX,
        pinchY: pPinchY,
        isPinching: pIsPinching,
        handedness: p.handedness,
      };
    });

    // Spatial Paper OCR touch-to-type with Dual-Hand system:
    // One hand points with index (sababa) at a letter,
    // and the other hand clicks outside the keyboard when two fingers touch (pinch) 👌
    if (this.spatialPaper?.isActive) {
      this.spatialPaper.updateDualHands(dualHands, performance.now());
    }

    // Dual-hand and cursor role assignment:
    // User moves cursor with one hand's index finger ("nmchi b cursur b yed")
    // and clicks when pinching 2 fingers with the other hand ("ncliki f haja ki ndir zuj asabi3 b yyed lakhra")
    // or scrolls when moving 2 pinched fingers ("w ki ndir zuj asabi3 w nscroli scroli ll jiha hadik")
    let cursorHand = dualHands[0];
    let triggerHand = dualHands.length > 1 ? dualHands[1] : null;

    if (dualHands.length >= 2) {
      if (dualHands[0]!.isPinching && !dualHands[1]!.isPinching) {
        cursorHand = dualHands[1];
        triggerHand = dualHands[0];
      } else if (!dualHands[0]!.isPinching && dualHands[1]!.isPinching) {
        cursorHand = dualHands[0];
        triggerHand = dualHands[1];
      } else {
        cursorHand = dualHands[0];
        triggerHand = dualHands[1];
      }
    }

    const curScreenX = cursorHand ? cursorHand.indexX : screenX;
    const curScreenY = cursorHand ? cursorHand.indexY : screenY;
    const curPx = curScreenX * window.innerWidth;
    const curPy = curScreenY * window.innerHeight;

    let didCrossHandClick = false;

    // Cross-hand clicking and 2-finger spatial scrolling
    if (triggerHand && cursorHand) {
      const isTriggerPinching = triggerHand.isPinching;

      // Rising edge: trigger hand just pinched 2 fingers!
      if (isTriggerPinching && !this.lastTriggerPinching) {
        if (this.youtubePlayer?.isActive) {
          this.youtubePlayer.updateFinger(curScreenX, curScreenY, true);
        }
        const clicked = runtime.cursor?.trigger(curPx, curPy, true);
        if (clicked) {
          didCrossHandClick = true;
          this.liveBanner?.setStatus('🎯 نقرة باليد الثانية (Clic 2ème main)!', 'seized');
        }
        this.lastScrollPoint = { x: triggerHand.pinchX, y: triggerHand.pinchY };
      } else if (isTriggerPinching && this.lastTriggerPinching) {
        // Sustained pinch: Two-finger scroll gesture ("w ki ndir zuj asabi3 w nscroli scroli ll jiha hadik")
        if (this.lastScrollPoint) {
          const deltaNormX = triggerHand.pinchX - this.lastScrollPoint.x;
          const deltaNormY = triggerHand.pinchY - this.lastScrollPoint.y;
          if (Math.hypot(deltaNormX, deltaNormY) > 0.002) {
            const deltaPxX = deltaNormX * window.innerWidth * 2.4;
            const deltaPxY = deltaNormY * window.innerHeight * 2.4;

            const handledByPlayer = this.youtubePlayer?.handleScrollGesture(curPx, curPy, deltaPxX, deltaPxY);
            if (!handledByPlayer) {
              runtime.cursor?.scroll(curPx, curPy, deltaPxX, deltaPxY);
            }
            this.liveBanner?.setStatus('📜 سكرول وتمرير بالأصابع (Défilement 2 doigts)', 'draw');
            this.lastScrollPoint = { x: triggerHand.pinchX, y: triggerHand.pinchY };
          }
        }
      } else {
        this.lastScrollPoint = null;
      }
      this.lastTriggerPinching = isTriggerPinching;
    } else if (dualHands.length === 1) {
      // Single hand mode:
      const singleHand = dualHands[0]!;
      const isSinglePinching = singleHand.isPinching;

      if (isSinglePinching && !this.lastTriggerPinching) {
        if (this.activeAirTool !== 'pen' && this.activeAirTool !== 'brush' && this.activeAirTool !== 'eraser') {
          if (this.youtubePlayer?.isActive) {
            this.youtubePlayer.updateFinger(curScreenX, curScreenY, true);
          }
          const clicked = runtime.cursor?.trigger(curPx, curPy, true);
          if (clicked) didCrossHandClick = true;
          this.lastScrollPoint = { x: singleHand.pinchX, y: singleHand.pinchY };
        }
      } else if (isSinglePinching && this.lastTriggerPinching) {
        if (this.activeAirTool !== 'pen' && this.activeAirTool !== 'brush' && this.activeAirTool !== 'eraser') {
          if (this.lastScrollPoint) {
            const deltaNormX = singleHand.pinchX - this.lastScrollPoint.x;
            const deltaNormY = singleHand.pinchY - this.lastScrollPoint.y;
            if (Math.hypot(deltaNormX, deltaNormY) > 0.002) {
              const deltaPxX = deltaNormX * window.innerWidth * 2.4;
              const deltaPxY = deltaNormY * window.innerHeight * 2.4;
              const handledByPlayer = this.youtubePlayer?.handleScrollGesture(curPx, curPy, deltaPxX, deltaPxY);
              if (!handledByPlayer) {
                runtime.cursor?.scroll(curPx, curPy, deltaPxX, deltaPxY);
              }
              this.lastScrollPoint = { x: singleHand.pinchX, y: singleHand.pinchY };
            }
          }
        }
      } else {
        this.lastScrollPoint = null;
      }
      this.lastTriggerPinching = isSinglePinching;
    } else {
      this.lastTriggerPinching = false;
      this.lastScrollPoint = null;
    }

    // Spatial Translucent YouTube mid-air finger interaction (hover / touch)
    if (this.youtubePlayer?.isActive) {
      this.youtubePlayer.updateFinger(curScreenX, curScreenY, isPenHolding);
    }

    // Index finger alone (usbu3 al ichara wahdu)
    const isPointingAlone = gesture.gesture === 'point' && !isPenHolding;

    // Index finger hover on top floating toolbar (dwell ring completes in 2s)
    this.airToolbar?.updateFingerHover(curScreenX, curScreenY, performance.now());

    // 3. CURSOR: Position laser cursor on pointing index fingertip apex
    // Stays visible whenever pointing or dual-hands are active
    const isCursorActive = cursorHand !== undefined && (!isPenHolding || dualHands.length >= 2);
    if (runtime.cursor) {
      runtime.cursor.update(
        curScreenX,
        curScreenY,
        pose.cursorProgress,
        gesture.clickTriggered || didCrossHandClick,
        isCursorActive,
      );
    }

    const isNearToolbar = this.airToolbar?.isHovering() ?? false;
    const isNearCursorTarget = runtime.cursor?.isHoveringTarget() ?? false;
    const isNearObject = isNearToolbar || isNearCursorTarget;

    // Midpoint between fingertips for grabbing objects
    const pinchPt = {
      x: penTipX,
      y: penTipY,
      z: ((indexPt.z ?? 0) + (thumbPt.z ?? 0)) * 0.5,
    };

    const pinchWorld = handToWorld(
      { ...pose, center: pinchPt },
      { fov: camera.fov, aspect: camera.aspect },
      false,
    );
    const pinchPos = new THREE.Vector3(pinchWorld.position.x, pinchWorld.position.y, pinchWorld.position.z);

    // 4. ERASER (Gomme) — precise local erasing wherever user touches
    if (this.activeAirTool === 'eraser') {
      this.skeletonOverlay?.setEraserCursor({ x: penTipX, y: penTipY });
      if (isPenHolding) {
        this.skeletonOverlay?.eraseNear2D(penTipX, penTipY, 0.055);
        this.airDraw?.clear();
        this.liveBanner?.setStatus('🧼 جاري مسح الخطوط المحددة (Gomme 2D)', 'erase');
      }
    } else {
      this.skeletonOverlay?.setEraserCursor(null);
    }

    // 5. PEN / BRUSH (Stylu / Pinceau) — strictly 2D on screen ("kitaba tkun 2 d bark w tban")
    // Held ONLY when thumb and index touch in the "bien" sign 👌
    if (this.activeAirTool === 'pen' || this.activeAirTool === 'brush') {
      // Clear any legacy 3D floating tubes
      this.airDraw?.clear();

      if (isPenHolding) {
        const strokeSize = this.activeAirTool === 'brush' ? 8.0 : 5.0;
        const drawColor = appStore.getState().material.color || '#00f0ff';

        if (!this.isAirDrawingActive) {
          this.skeletonOverlay?.startStroke2D(penTipX, penTipY, drawColor, strokeSize);
          this.isAirDrawingActive = true;
        } else {
          this.skeletonOverlay?.addPoint2D(penTipX, penTipY);
        }
        this.liveBanner?.setStatus('✍️ جاري الكتابة 2D بالقلم (علامة 👌 الإبهام والسبابة لاصقين)', 'draw');
      } else {
        if (this.isAirDrawingActive) {
          this.skeletonOverlay?.endStroke2D();
          this.isAirDrawingActive = false;
          this.liveBanner?.setStatus('✨ تم رفع القلم (علامة 👌 للكتابة)', 'idle');
        }
      }
    }

    // 6. SEIZE 3D OBJECT — when thumb and index pinch together!
    const isGrabTool =
      this.activeAirTool === 'grab' ||
      this.interactionMode === 'place' ||
      this.interactionMode === 'hands';

    if (isGrabTool && this.spatialGrab) {
      const grabbing = isPenHolding || gesture.gesture === 'two-hands';
      if (grabbing) {
        this.spatialGrab.updateHandGrab(pinchPos, true);
        scene.clearHandPose();
        this.liveBanner?.setStatus('⚡ أصبعين لاصقين (علامة 👌) — تم إمساك المجسم!', 'seized');
      } else {
        this.spatialGrab.updateHandGrab(pinchPos, false);
      }
    }

    // 7. TWO HANDS PINCH → 3D Scale
    if (gesture.gesture === 'two-hands') {
      if (!this.twoHandReference) {
        this.twoHandReference = {
          distance: Math.max(0.0001, gesture.handsDistance),
          scale: scene.getTransform().scale,
        };
      }
      const ratio = gesture.handsDistance / this.twoHandReference.distance;
      scene.setTransform({ scale: this.twoHandReference.scale * ratio });
      this.liveBanner?.setStatus('👐 يدين اثنتين — جاري تكبير / تصغير المجسم (Zoom 3D)', 'seized');
    } else {
      this.twoHandReference = null;
    }

    // 8. FIST HELD → Reset transform
    if (gesture.gesture === 'fist' && gesture.resetTriggered) {
      actions.resetTransform();
      this.liveBanner?.setStatus('🔄 تمت إعادة ضبط موضع المجسم (Reset)', 'point');
    }

    // 9. IDLE / POINTING BANNER ANNOUNCEMENTS
    if (!isPenHolding && gesture.gesture !== 'two-hands') {
      if (isNearObject) {
        this.liveBanner?.setStatus('🎯 توجيه نحو العنصر — جاري التحديد (2s)...', 'point');
      } else if (isPointingAlone) {
        this.liveBanner?.setStatus('☝️ مؤشر السبابة وحده (حرك للإشارة، أو الصق الإبهام والسبابة علامة 👌 للكتابة)', 'point');
      } else if (this.activeAirTool === 'pen' || this.activeAirTool === 'brush') {
        this.liveBanner?.setStatus('✍️ الصق الإبهام بالسبابة (علامة 👌) للبدء في الكتابة 2D', 'idle');
      } else if (this.activeAirTool === 'eraser') {
        this.liveBanner?.setStatus('🧼 الصق الإبهام بالسبابة (علامة 👌) للمسح بالممحاة', 'idle');
      } else {
        this.liveBanner?.setStatus('🖐️ اليد مرصودة — الصق الإبهام والسبابة (علامة 👌) للإمساك أو الكتابة', 'idle');
      }
    }
  }

  /** Downgrades quality when the device cannot hold 60 FPS. */
  private slowFrames = 0;
  private samplePerformance(dt: number): void {
    const state = appStore.getState();
    if (state.perf.quality === 'low') return;
    if (dt * 1000 > CONFIG.perf.slowFrameMs) this.slowFrames += 1;
    else this.slowFrames = Math.max(0, this.slowFrames - 1);

    if (this.slowFrames > CONFIG.perf.slowSamples) {
      this.slowFrames = 0;
      const next = state.perf.quality === 'high' ? 'medium' : 'low';
      appStore.setState({ perf: { ...state.perf, quality: next } });
      runtime.scene?.applyQuality(next);
      bus.emit('perf:quality', { quality: next });
      actions.toast('toast.qualityDowngraded', 'warn');
    }
  }

  // ---- chrome --------------------------------------------------------------

  /** Builds the chrome (disabled obstructive sidebars and bottom sheets as requested). */
  private buildResponsiveChrome(): void {
    // Disabled all obstructive sidebars and bottom sheets:
    // "nahi hadik ta3 al achkal w ga3 ,,, nahi ga3 had tableau ,, khali ghir charit ta3 lktiba"
  }

  /** Rebuilds the chrome when the layout class changes (rotation/resize). */
  private onBreakpointChange = (): void => {
    this.refreshTranslations();
  };

  private buildToolRail(): void {
    const rail = [
      { icon: 'Hand' as const, label: t('mode.hands'), action: () => void this.setMode('hands') },
      { icon: 'QrCode' as const, label: t('mode.marker'), action: () => void this.setMode('marker') },
      { icon: 'SwitchCamera' as const, label: t('export.camera'), action: () => void actions.switchCamera() },
      { icon: 'Maximize' as const, label: t('export.fullscreen'), action: () => void actions.toggleFullscreen() },
    ];
    this.toolRail.replaceChildren(
      ...rail.map((entry) => iconButton(entry.icon, entry.label, entry.action)),
    );
  }

  private toggleSidebar(): void {}

  private async setMode(mode: AppMode): Promise<void> {
    await actions.setMode(mode);
    if (mode === 'hands' && runtime.hands?.isReady) {
      this.showModal(new HandsTutorial({
        onDone: () => actions.closeModal(),
        onToggleSkeleton: (show) => actions.setHandsStatus({ showSkeleton: show }),
        skeletonVisible: appStore.getState().hands.showSkeleton,
      }).element);
    }
  }

  // ---- events --------------------------------------------------------------

  private wireEvents(): void {
    // Input: pointer/touch/keyboard → actions.
    this.input = new InputController(this.stage, {
      rotate: (dx, dy) => {
        if (
          this.interactionMode === 'draw' ||
          this.activeAirTool === 'pen' ||
          this.activeAirTool === 'brush' ||
          this.activeAirTool === 'eraser'
        ) {
          return;
        }
        actions.rotateBy(dx, dy);
      },
      scale: (factor) => actions.scaleBy(factor),
      height: (delta) => actions.heightBy(delta),
      reset: () => actions.resetTransform(),
      snapshot: () => void actions.takeSnapshot(),
      toggleTheme: () => actions.toggleTheme(),
      cycleLanguage: () => actions.toggleLanguage(),
      toggleAutoRotate: () => actions.toggleAutoRotate(),
      selectObject: (index) => actions.selectObjectByIndex(index),
      toggleHands: () => void this.setMode(appStore.getState().mode === 'hands' ? 'marker' : 'hands'),
      openSearch: () => void actions.openSearch(),
      openRoom: () => {
        actions.setTab('room');
        actions.setSheet(true, 2);
      },
      toggleFullscreen: () => void actions.toggleFullscreen(),
      toggleDebug: () => actions.toggleDebug(),
      openHelp: () => actions.openHelp(),
      escape: () => {
        const ui = appStore.getState().ui;
        if (ui.modal !== 'none') actions.closeModal();
        else if (ui.sheetOpen) actions.setSheet(false);
      },
    });

    // Drag & drop a .glb anywhere on the stage.
    const prevent = (event: DragEvent): void => event.preventDefault();
    document.addEventListener('dragover', prevent);
    document.addEventListener('drop', (event) => {
      prevent(event);
      const file = event.dataTransfer?.files?.[0];
      if (file) void actions.importModelFile(file);
    });

    // Snapshots: flash animation + modal.
    this.disposeFns.push(
      bus.on('capture:request', () => void actions.takeSnapshot()),
      bus.on('capture:ready', ({ blob, dataUrl }) => {
        this.flash.classList.add('is-firing');
        window.setTimeout(() => this.flash.classList.remove('is-firing'), 480);
        this.showModal(
          new SnapshotModal({
            dataUrl,
            blob,
            onShare: (shareBlob, url) => void actions.shareSnapshot(shareBlob, url),
            onClose: () => actions.closeModal(),
          }).element,
        );
      }),
      bus.on('ui:modal', ({ modal }) => {
        if (modal === 'none') this.dismissModal();
        if (modal === 'onboarding') this.showModal(this.buildOnboarding());
        if (modal === 'marker') this.showModal(new MarkerModal({ onClose: () => actions.closeModal() }).element);
        if (modal === 'credits') {
          this.showModal(
            new CreditsModal({
              onClose: () => actions.closeModal(),
              onReport: () => actions.toast('credits.reported', 'success'),
            }).element,
          );
        }
        if (modal === 'shortcuts' || modal === 'privacy') this.showModal(this.buildInfoModal(modal));
      }),
      bus.on('ar:target', ({ found }) => this.targetRing.classList.toggle('is-found', found)),
      bus.on('room:toast', ({ key, vars, kind }) => actions.toast(key, kind ?? 'info', vars)),
    );

    // Breakpoint switching (rotation, window resize).
    const media = window.matchMedia('(min-width: 1024px)');
    media.addEventListener('change', this.onBreakpointChange);
    this.disposeFns.push(() => media.removeEventListener('change', this.onBreakpointChange));

    // A room in the URL joins automatically.
    const roomCode = new URLSearchParams(window.location.search).get('room');
    if (roomCode && CONFIG.features.rooms) {
      void actions.joinRoom(roomCode, `Guest ${Math.floor(Math.random() * 90 + 10)}`);
    }

    // First run: show the tutorial.
    if (!appStore.getState().ui.onboardingSeen) {
      window.setTimeout(() => actions.showModal('onboarding'), 600);
    } else if (appStore.getState().mode === 'hands') {
      void this.setMode('marker');
    }
  }

  private buildOnboarding(): HTMLElement {
    return new Onboarding({
      onDone: ({ neverShowAgain }) => {
        if (neverShowAgain) actions.completeOnboarding();
        else actions.closeModal();
      },
      onGetMarker: () => actions.openMarker(),
    }).element;
  }

  private buildInfoModal(kind: 'shortcuts' | 'privacy'): HTMLElement {
    const rows: [string, string][] =
      kind === 'shortcuts'
        ? [
            ['R', t('shortcuts.reset')],
            ['S', t('shortcuts.snapshot')],
            ['T', t('shortcuts.theme')],
            ['L', t('shortcuts.language')],
            ['Space', t('shortcuts.autoRotate')],
            ['1-7', t('shortcuts.objects')],
            ['H', t('shortcuts.hands')],
            ['F', t('shortcuts.search')],
            ['M', t('shortcuts.room')],
            ['V', t('export.fullscreen')],
            ['D', t('shortcuts.debug')],
          ]
        : [
            [t('privacy.summary'), t('privacy.body')],
            [t('room.title'), t('privacy.sharedRoom')],
          ];

    const modal = new Modal({
      title: kind === 'shortcuts' ? t('shortcuts.title') : t('privacy.summary'),
      body: el(
        'div',
        { class: 'shortcuts' },
        ...rows.map(([left, right]) =>
          el(
            'div',
            { class: 'shortcut' },
            el('span', { class: 'muted', text: right }),
            left.length <= 8 ? el('kbd', { text: left }) : el('span', { class: 'tiny', text: left }),
          ),
        ),
      ),
      onClose: () => actions.closeModal(),
    });
    return modal.element;
  }

  private showModal(element: HTMLElement): void {
    this.dismissModal();
    this.modal = { element };
    document.body.appendChild(element);
  }

  private dismissModal(): void {
    this.modal?.element.remove();
    this.modal = null;
  }

  // ---- misc ----------------------------------------------------------------

  /** Re-renders every translated surface in place. */
  private refreshTranslations(): void {
    this.topBar.refreshLabels();
    this.shutter.setAttribute('aria-label', t('a11y.snapshotButton'));
    this.buildToolRail();
    this.errorScreen.refresh();
    if (this.modal && appStore.getState().ui.modal === 'onboarding') {
      this.showModal(this.buildOnboarding());
    }
    document.documentElement.lang = getLang();
  }

  private wirePwa(): void {
    // Register the service worker (offline shell) and warm the marker asset so
    // "Get the marker" opens instantly.
    if (CONFIG.features.pwa && 'serviceWorker' in navigator) {
      void navigator.serviceWorker
        .register(assetUrl('sw.js'), { scope: './' })
        .catch((err) => console.warn('[pwa] service worker registration failed', err));
    }
    void fetch(assetUrl(CONFIG.urls.markerPng), { cache: 'force-cache' }).catch(() => undefined);
  }

  private wireCanvasPointerEvents(): void {
    let pointerDown = false;
    this.stage.addEventListener('pointerdown', (e) => {
      if ((e.target as HTMLElement).closest('.ar-dock, .air-toolbar, .topbar, .sheet, .sidebar, .modal, button, a')) return;
      pointerDown = true;
      const nx = e.clientX / window.innerWidth;
      const ny = e.clientY / window.innerHeight;

      if ((this.interactionMode === 'draw' || this.activeAirTool === 'pen' || this.activeAirTool === 'brush') && this.airDraw && runtime.ar?.camera) {
        const pt = this.screenToWorldAtDepth(nx, ny, runtime.ar.camera, 0.6);
        this.airDraw.startStroke(pt);
      } else if ((this.interactionMode === 'place' || this.activeAirTool === 'grab') && this.spatialGrab) {
        this.spatialGrab.startPointerDrag(nx, ny);
      }
    });

    this.stage.addEventListener('pointermove', (e) => {
      if (!pointerDown) return;
      const nx = e.clientX / window.innerWidth;
      const ny = e.clientY / window.innerHeight;

      if ((this.interactionMode === 'draw' || this.activeAirTool === 'pen' || this.activeAirTool === 'brush') && this.airDraw && runtime.ar?.camera) {
        const pt = this.screenToWorldAtDepth(nx, ny, runtime.ar.camera, 0.6);
        this.airDraw.addPoint(pt);
      } else if ((this.interactionMode === 'place' || this.activeAirTool === 'grab') && this.spatialGrab) {
        this.spatialGrab.updatePointerDrag(nx, ny);
      }
    });

    const pointerEnd = () => {
      if (!pointerDown) return;
      pointerDown = false;
      if (this.airDraw) {
        this.airDraw.endStroke();
      }
      if (this.spatialGrab) {
        this.spatialGrab.endPointerDrag();
      }
    };

    this.stage.addEventListener('pointerup', pointerEnd);
    this.stage.addEventListener('pointercancel', pointerEnd);
  }

  private screenToWorldAtDepth(
    screenX: number,
    screenY: number,
    camera: THREE.PerspectiveCamera,
    depth = 0.6,
  ): THREE.Vector3 {
    const ndcX = (screenX - 0.5) * 2;
    const ndcY = -(screenY - 0.5) * 2;
    const vec = new THREE.Vector3(ndcX, ndcY, 0.5);
    vec.unproject(camera);
    const dir = vec.sub(camera.position).normalize();
    return new THREE.Vector3().copy(camera.position).addScaledVector(dir, depth);
  }

  private async handleInteractionModeChange(mode: ArInteractionMode): Promise<void> {
    this.interactionMode = mode;
    if (mode === 'marker') {
      await actions.setMode('marker');
      this.spatialGrab?.setEnabled(false);
      this.airDraw?.setActive(false);
      this.skeletonOverlay?.setEnabled(false);
    } else {
      await actions.setMode('hands', true);
      this.skeletonOverlay?.setEnabled(appStore.getState().hands.showSkeleton);
      if (mode === 'draw') {
        this.airDraw?.setActive(true);
        this.spatialGrab?.setEnabled(false);
      } else if (mode === 'place') {
        this.airDraw?.setActive(false);
        this.spatialGrab?.setEnabled(true);
        this.spatialGrab?.setFreePlacement(true);
      } else {
        // hands mode
        this.airDraw?.setActive(false);
        this.spatialGrab?.setEnabled(true);
        this.spatialGrab?.setFreePlacement(false);
      }
    }
  }

  private handleAirToolSelected(tool: AirToolId): void {
    if (tool.startsWith('color_')) {
      const colorMap: Record<string, string> = {
        color_cyan: '#00f0ff',
        color_orange: '#ff8800',
        color_magenta: '#ff00aa',
        color_green: '#00ff66',
        color_yellow: '#ffe600',
        color_white: '#ffffff',
      };
      const hex = colorMap[tool] ?? '#00f0ff';
      this.airDraw?.setColor(hex);
      this.skeletonOverlay?.setDrawColor(hex);
      void actions.updateMaterial({ color: hex });
      this.liveBanner?.setStatus('🎨 تم تغيير اللون (Couleur changée)', 'point');
      return;
    }

    this.activeAirTool = tool;

    if (tool === 'pen') {
      this.interactionMode = 'draw';
      this.skeletonOverlay?.setDrawSize(4.5);
      this.spatialGrab?.setEnabled(false);
      this.spatialPaper?.setActive(false);
      this.airToolbar?.setPaperOcrActive(false);
      this.liveBanner?.setStatus('✍️ تم اختيار: قلم نيون 2D (علامة 👌 للكتابة)', 'draw');
    } else if (tool === 'brush') {
      this.interactionMode = 'draw';
      this.skeletonOverlay?.setDrawSize(8.0);
      this.spatialGrab?.setEnabled(false);
      this.spatialPaper?.setActive(false);
      this.airToolbar?.setPaperOcrActive(false);
      this.liveBanner?.setStatus('🖌️ تم اختيار: فرشاة نيون عريضة 2D (علامة 👌)', 'draw');
    } else if (tool === 'eraser') {
      this.interactionMode = 'draw';
      this.spatialGrab?.setEnabled(false);
      this.spatialPaper?.setActive(false);
      this.airToolbar?.setPaperOcrActive(false);
      this.liveBanner?.setStatus('🧼 تم اختيار: ممحاة موضعية ذكية (امسح الأماكن التي تريد)', 'erase');
    } else if (tool === 'grab') {
      this.interactionMode = 'place';
      this.spatialGrab?.setEnabled(true);
      this.spatialGrab?.setFreePlacement(true);
      this.spatialPaper?.setActive(false);
      this.airToolbar?.setPaperOcrActive(false);
      this.liveBanner?.setStatus('⚡ تم اختيار: إمساك وتحريك المجسم (Saisir 3D)', 'seized');
    } else if (tool === 'paper_ocr') {
      const nextActive = !this.spatialPaper?.isActive;
      this.spatialPaper?.setActive(nextActive);
      this.airToolbar?.setPaperOcrActive(nextActive);
      if (nextActive) {
        this.liveBanner?.setStatus('👐 لوحة الكتابة باليدين: يد تشير بالسبابة ☝️ والأخرى تنقر 👌 خارج الكيبورد', 'point');
      } else {
        this.liveBanner?.setStatus('تم إغلاق مستشعر الورقة', 'idle');
      }
    } else if (tool === 'youtube') {
      const nextActive = !this.youtubePlayer?.isActive;
      this.youtubePlayer?.setActive(nextActive);
      this.airToolbar?.setYouTubeActive(nextActive);
      if (nextActive) {
        this.liveBanner?.setStatus('📺 تم تفعيل يوتيوب الشفاف: تحكّم بالأصابع وبدّل الشفافية وملء الشاشة!', 'seized');
      } else {
        this.liveBanner?.setStatus('تم إغلاق يوتيوب AR', 'idle');
      }
    } else if (tool === 'skeleton') {
      const next = !this.skeletonOverlay?.isEnabled;
      this.skeletonOverlay?.setEnabled(next);
      this.airToolbar?.setSkeletonActive(next);
      actions.setHandsStatus({ showSkeleton: next });
      this.liveBanner?.setStatus(next ? '🖐️ تم إظهار نقاط اليد (ON)' : '🖐️ تم إخفاء نقاط اليد (OFF)', 'point');
    } else if (tool === 'snap') {
      void actions.takeSnapshot();
      this.liveBanner?.setStatus('📷 تم التقاط لقطة شاشة (Snapshot)', 'point');
    } else if (tool === 'clear') {
      this.airDraw?.clear();
      this.skeletonOverlay?.clearStrokes2D();
      this.liveBanner?.setStatus('🧹 تم مسح جميع الخطوط من الشاشة (Effacé)', 'erase');
    }
  }

  private spawn3DText(text: string): void {
    if (!runtime.scene) return;
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = 'rgba(15, 23, 42, 0.88)';
    ctx.beginPath();
    ctx.roundRect(10, 10, 492, 236, 28);
    ctx.fill();
    ctx.strokeStyle = '#00f0ff';
    ctx.lineWidth = 6;
    ctx.stroke();

    ctx.font = 'bold 56px Cairo, Inter, system-ui, sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = '#00f0ff';
    ctx.shadowBlur = 18;
    ctx.fillText(text, 256, 128);

    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    const mat = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      side: THREE.DoubleSide,
    });
    const geom = new THREE.PlaneGeometry(1.2, 0.6);
    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.set(0, 0.35, 0);
    runtime.scene.holder.add(mesh);
    this.liveBanner?.setStatus(`🧊 تم تجسيم النص "${text}" بنجاح في الفضاء 3D!`, 'seized');
  }

  /** Returns the stage element (used by preview/tests). */
  get stageElement(): HTMLElement {
    return this.stage;
  }

  /** Model metadata for the currently loaded object. */
  get currentMeta(): ModelMeta | null {
    return runtime.scene?.meta ?? null;
  }

  /** Tears everything down (hot reload / teardown). */
  dispose(): void {
    for (const dispose of this.disposeFns) dispose();
    this.disposeFns = [];
    this.input?.dispose();
    this.topBar.dispose();
    this.spatialPaper?.dispose();
    this.youtubePlayer?.dispose();
    this.airToolbar?.dispose();
    this.debugOverlay.dispose();
    this.liveBanner?.dispose();
    runtime.hands?.dispose();
    runtime.cursor?.dispose();
    runtime.room?.dispose();
    runtime.search?.dispose();
    runtime.scene?.dispose();
    runtime.ar?.dispose();
    ticker.dispose();
  }
}

/** Re-exported so consumers can reach the projection maths from the app layer. */
export { handToWorld };
