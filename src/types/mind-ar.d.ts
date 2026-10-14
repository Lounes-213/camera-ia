/**
 * Type declarations for MindAR's prebuilt Three.js bundle.
 *
 * MindAR ships a minified ESM bundle that imports `three` as an external, so it
 * shares our Three.js instance. These declarations describe only the public
 * surface we use.
 */
declare module 'mind-ar/dist/mindar-image-three.prod.js' {
  import type { Group, PerspectiveCamera, Scene, WebGLRenderer } from 'three';

  export interface MindARAnchor {
    group: Group;
    targetIndex: number;
    onTargetFound: (() => void) | null;
    onTargetLost: (() => void) | null;
    onTargetUpdate: (() => void) | null;
    visible: boolean;
    css: boolean;
  }

  export interface MindARController {
    stopProcessVideo(): void;
    processVideo(input: HTMLVideoElement): void;
    getProjectionMatrix(): number[];
    inputWidth: number;
    inputHeight: number;
  }

  export interface MindARThreeOptions {
    container: HTMLElement;
    imageTargetSrc: string;
    maxTrack?: number;
    uiLoading?: string;
    uiScanning?: string;
    uiError?: string;
    filterMinCF?: number | null;
    filterBeta?: number | null;
    warmupTolerance?: number | null;
    missTolerance?: number | null;
    userDeviceId?: string | null;
    environmentDeviceId?: string | null;
  }

  export class MindARThree {
    constructor(options: MindARThreeOptions);
    container: HTMLElement;
    renderer: WebGLRenderer;
    cssRenderer: { domElement: HTMLElement; setSize(w: number, h: number): void };
    scene: Scene;
    camera: PerspectiveCamera;
    video: HTMLVideoElement;
    anchors: MindARAnchor[];
    controller: MindARController;
    shouldFaceUser: boolean;
    start(): Promise<void>;
    stop(): void;
    switchCamera(): void;
    addAnchor(targetIndex: number): MindARAnchor;
    addCSSAnchor(targetIndex: number): MindARAnchor;
    resize(): void;
  }
}
