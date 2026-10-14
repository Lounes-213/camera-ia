#!/usr/bin/env node
/**
 * Compiles `public/targets.mind` from `public/marker.png` using MindAR's
 * OfflineCompiler (the exact same compiler the online tool uses).
 *
 * Run: npm run gen:target
 *
 * Note: this is CPU heavy and takes ~1-3 minutes. Requires the `canvas`
 * native package (transitive dependency of mind-ar) and @tensorflow/tfjs.
 */
import { createCanvas, loadImage } from 'canvas';
import { existsSync, writeFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const MARKER = resolve(ROOT, 'public/marker.png');
const OUT = resolve(ROOT, 'public/targets.mind');

if (!existsSync(MARKER)) {
  console.error('[target] public/marker.png is missing. Run `npm run gen:marker` first.');
  process.exit(1);
}

// Register the pure-JS CPU backend before MindAR loads its kernels.
await import('@tensorflow/tfjs');

const { OfflineCompiler } = await import('mind-ar/src/image-target/offline-compiler.js');

const image = await loadImage(MARKER);
// Down-scale to 640px on the long edge for the crispest feature matching
// (MindAR recommends target images between 480 and 1600 px).
const MAX = 640;
const scale = Math.min(1, MAX / Math.max(image.width, image.height));
const w = Math.round(image.width * scale);
const h = Math.round(image.height * scale);

const canvas = createCanvas(w, h);
const ctx = canvas.getContext('2d');
ctx.drawImage(image, 0, 0, w, h);

console.log(`[target] compiling ${w}x${h} target from public/marker.png ...`);

const compiler = new OfflineCompiler();
let last = -1;
await compiler.compileImageTargets([canvas], (progress) => {
  const p = Math.floor(progress);
  if (p !== last && p % 5 === 0) {
    last = p;
    process.stdout.write(`  ${String(p).padStart(3)}%\r`);
  }
});

const buffer = compiler.exportData();
writeFileSync(OUT, Buffer.from(buffer));
console.log('');
console.log(`[target] wrote ${OUT} (${(statSync(OUT).size / 1024).toFixed(1)} KB)`);
