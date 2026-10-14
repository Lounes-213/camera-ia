#!/usr/bin/env node
/**
 * Copies the MediaPipe HandLandmarker runtime (wasm) out of node_modules into
 * `public/mediapipe/` so the app is fully self-hosted and works offline / in a PWA.
 *
 * It also tries to download `hand_landmarker.task` (~7 MB) once. If the machine
 * is offline the script keeps going and the app shows a friendly, translated
 * message telling the user to run `npm run copy:mediapipe` again.
 */
import { cpSync, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const SRC_WASM = resolve(ROOT, 'node_modules/@mediapipe/tasks-vision/wasm');
const DEST = resolve(ROOT, 'public/mediapipe');
const DEST_WASM = resolve(DEST, 'wasm');
const TASK = resolve(DEST, 'hand_landmarker.task');
const TASK_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

mkdirSync(DEST_WASM, { recursive: true });

let copied = false;
if (existsSync(SRC_WASM)) {
  cpSync(SRC_WASM, DEST_WASM, { recursive: true });
  copied = true;
  const files = statSync(SRC_WASM).isDirectory() ? '(all files)' : '';
  console.log(`[mediapipe] copied wasm runtime from node_modules ${files}`);
} else {
  console.warn('[mediapipe] node_modules/@mediapipe/tasks-vision/wasm not found - skipping wasm copy.');
}

if (!existsSync(TASK)) {
  try {
    console.log('[mediapipe] downloading hand_landmarker.task (~7 MB, once)...');
    const res = await fetch(TASK_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength < 100_000) throw new Error(`unexpected size ${buf.byteLength}`);
    writeFileSync(TASK, buf);
    console.log(`[mediapipe] saved hand_landmarker.task (${(buf.byteLength / 1024 / 1024).toFixed(1)} MB)`);
  } catch (err) {
    console.warn(`[mediapipe] could not download hand_landmarker.task (${err.message}).`);
    console.warn('[mediapipe] Hands mode will stay disabled until you re-run: npm run copy:mediapipe');
  }
} else {
  console.log('[mediapipe] hand_landmarker.task already present.');
}

if (!copied && !existsSync(TASK)) {
  console.warn('[mediapipe] nothing was prepared.');
}
