#!/usr/bin/env node
/**
 * Generates the PWA icon set:
 *   public/icons/icon.svg          vector favicon / any-size icon
 *   public/icons/icon-192.png      home-screen icon
 *   public/icons/icon-512.png      store / splash icon
 *   public/icons/maskable-512.png  Android adaptive icon (safe zone respected)
 *
 * The mark is the same asymmetric "W" used on the tracking marker, on the brand
 * orange gradient — so the app icon and the printed marker look related.
 */
import { createCanvas } from 'canvas';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const OUT = resolve(ROOT, 'public/icons');
mkdirSync(OUT, { recursive: true });

const ORANGE = '#FF7A00';
const ORANGE_600 = '#E56A00';

/**
 * Draws the logo mark.
 * @param {import('canvas').CanvasRenderingContext2D} ctx
 * @param {number} size
 * @param {boolean} maskable keeps the mark inside the 80% safe zone
 */
function drawMark(ctx, size, maskable) {
  const gradient = ctx.createLinearGradient(0, 0, size, size);
  gradient.addColorStop(0, '#FF8F26');
  gradient.addColorStop(1, ORANGE_600);

  const radius = maskable ? 0 : size * 0.22;
  ctx.fillStyle = maskable ? '#FF8F26' : gradient;
  ctx.beginPath();
  ctx.moveTo(radius, 0);
  ctx.arcTo(size, 0, size, size, radius);
  ctx.arcTo(size, size, 0, size, radius);
  ctx.arcTo(0, size, 0, 0, radius);
  ctx.arcTo(0, 0, size, 0, radius);
  ctx.closePath();
  ctx.fill();

  // Soft highlight blob for depth.
  const glow = ctx.createRadialGradient(size * 0.28, size * 0.2, 0, size * 0.28, size * 0.2, size * 0.7);
  glow.addColorStop(0, 'rgba(255,255,255,0.35)');
  glow.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, size, size);

  // The "W" monogram, scaled into the safe zone when maskable.
  const inset = maskable ? size * 0.26 : size * 0.2;
  const w = size - inset * 2;
  const left = inset;
  const top = size * 0.34;
  const bottom = size * 0.66;

  ctx.strokeStyle = '#FFFFFF';
  ctx.lineWidth = Math.max(3, size * 0.075);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(left, top);
  ctx.lineTo(left + w * 0.27, bottom);
  ctx.lineTo(left + w * 0.5, top + (bottom - top) * 0.42);
  ctx.lineTo(left + w * 0.73, bottom);
  ctx.lineTo(left + w, top);
  ctx.stroke();

  // Orange dot: the AR anchor.
  ctx.fillStyle = '#FFFFFF';
  ctx.beginPath();
  ctx.arc(left + w * 0.5, size * 0.265, size * 0.045, 0, Math.PI * 2);
  ctx.fill();
}

function build(size, maskable = false) {
  const canvas = createCanvas(size, size);
  drawMark(canvas.getContext('2d'), size, maskable);
  return canvas;
}

writeFileSync(resolve(OUT, 'icon-192.png'), build(192).toBuffer('image/png'));
writeFileSync(resolve(OUT, 'icon-512.png'), build(512).toBuffer('image/png'));
writeFileSync(
  resolve(OUT, 'maskable-512.png'),
  build(512, true).toBuffer('image/png', { compressionLevel: 9 }),
);

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <title>WebAR Spatial Anchor</title>
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#FF8F26"/>
      <stop offset="1" stop-color="${ORANGE_600}"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="112" fill="url(#g)"/>
  <circle cx="256" cy="135" r="23" fill="#fff"/>
  <path d="M102 174 L240 338 L256 299 L272 338 L410 174" fill="none" stroke="#fff" stroke-width="38" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
`;
writeFileSync(resolve(OUT, 'icon.svg'), svg);

console.log('[icons] public/icons/icon.svg, icon-192.png, icon-512.png, maskable-512.png');
console.log(`[icons] brand colour ${ORANGE}`);
