#!/usr/bin/env node
/**
 * Generates the printable AR marker.
 *
 * Produces:
 *   public/marker.png     - 1024x1024 high-contrast, asymmetric tracking target
 *   public/marker-a4.png  - A4 (300 DPI) sheet, marker at 160 mm + print notes
 *   public/marker.svg     - vector version of the marker (bonus, scalable)
 *
 * The pattern is deterministic (seeded PRNG) so it can be regenerated and
 * always matches a previously compiled `public/targets.mind`.
 *
 * Requires the `canvas` package (a transitive dependency of mind-ar).
 */
import { createCanvas, loadImage } from 'canvas';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const PUBLIC = resolve(ROOT, 'public');
mkdirSync(PUBLIC, { recursive: true });

/** Deterministic 32-bit PRNG (mulberry32). */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SIZE = 1024;
const ORANGE = '#FF7A00';
const ORANGE_DEEP = '#E56A00';
const INK = '#111111';

/**
 * Draws the marker artwork on a canvas context.
 * @param {CanvasRenderingContext2D} ctx
 */
function drawMark(ctx) {
  const rnd = mulberry32(0xa17c0de);
  const S = SIZE;

  // Warm-white paper background.
  ctx.fillStyle = '#FFFDF9';
  ctx.fillRect(0, 0, S, S);

  // --- Outer registration frame -------------------------------------------------
  ctx.strokeStyle = INK;
  ctx.lineWidth = 34;
  ctx.strokeRect(24, 24, S - 48, S - 48);
  ctx.lineWidth = 10;
  ctx.strokeRect(64, 64, S - 128, S - 128);

  // Orange asymmetric corner accents (orientation cues).
  const accents = [
    [0, 0, 150, 46],
    [S - 46, 0, 46, 150],
    [S - 150, S - 46, 150, 46],
    [0, S - 46, 46, 46],
  ];
  ctx.fillStyle = ORANGE;
  for (const [x, y, w, h] of accents) ctx.fillRect(x, y, w, h);
  ctx.fillStyle = ORANGE_DEEP;
  ctx.fillRect(0, 0, 46, 46);

  // --- Dense, irregular feature field (what the tracker actually locks onto) -----
  for (let i = 0; i < 190; i++) {
    const cx = 110 + rnd() * (S - 220);
    const cy = 110 + rnd() * (S - 220);
    const type = Math.floor(rnd() * 4);
    const r = 8 + rnd() * 46;
    const rot = rnd() * Math.PI * 2;
    const roll = rnd();
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rot);
    if (roll < 0.42) {
      ctx.fillStyle = INK;
    } else if (roll < 0.78) {
      ctx.fillStyle = ORANGE;
    } else {
      ctx.fillStyle = ORANGE_DEEP;
    }
    if (type === 0) {
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();
    } else if (type === 1) {
      ctx.beginPath();
      ctx.moveTo(-r, r);
      ctx.lineTo(0, -r);
      ctx.lineTo(r, r);
      ctx.closePath();
      ctx.fill();
    } else if (type === 2) {
      ctx.fillRect(-r, -r * 0.5, r * 2, r);
    } else {
      ctx.lineWidth = Math.max(4, r * 0.35);
      ctx.strokeStyle = ctx.fillStyle;
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.8, 0, Math.PI * 1.4);
      ctx.stroke();
    }
    ctx.restore();
  }

  // --- Central badge (the "logo" the user recognises) ---------------------------
  const mid = S / 2;
  ctx.fillStyle = '#FFFFFF';
  ctx.beginPath();
  ctx.arc(mid, mid, 176, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = INK;
  ctx.lineWidth = 16;
  ctx.stroke();

  // Asymmetric "W" monogram + orbit dot.
  ctx.strokeStyle = ORANGE;
  ctx.lineWidth = 30;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(mid - 92, mid - 58);
  ctx.lineTo(mid - 46, mid + 62);
  ctx.lineTo(mid, mid - 34);
  ctx.lineTo(mid + 46, mid + 62);
  ctx.lineTo(mid + 92, mid - 58);
  ctx.stroke();

  ctx.fillStyle = ORANGE_DEEP;
  ctx.beginPath();
  ctx.arc(mid + 118, mid - 122, 26, 0, Math.PI * 2);
  ctx.fill();

  // Scale ticks — plenty of high-frequency contrast for pose estimation.
  ctx.fillStyle = INK;
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const len = i % 3 === 0 ? 30 : 16;
    ctx.save();
    ctx.translate(mid + Math.cos(a) * 196, mid + Math.sin(a) * 196);
    ctx.rotate(a);
    ctx.fillRect(-3, -len / 2, 6, len);
    ctx.restore();
  }
}

function buildMarkerCanvas() {
  const canvas = createCanvas(SIZE, SIZE);
  const ctx = canvas.getContext('2d');
  drawMark(ctx);
  return canvas;
}

// --- SVG twin of the marker (kept in sync by hand for crisp large prints) --------
function buildMarkSvg() {
  const S = SIZE;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}">
  <title>WebAR Spatial Anchor - tracking marker</title>
  <rect width="${S}" height="${S}" fill="#FFFDF9"/>
  <rect x="24" y="24" width="${S - 48}" height="${S - 48}" fill="none" stroke="${INK}" stroke-width="34"/>
  <rect x="64" y="64" width="${S - 128}" height="${S - 128}" fill="none" stroke="${INK}" stroke-width="10"/>
  <rect x="0" y="0" width="150" height="46" fill="${ORANGE}"/>
  <rect x="${S - 46}" y="0" width="46" height="150" fill="${ORANGE}"/>
  <rect x="${S - 150}" y="${S - 46}" width="150" height="46" fill="${ORANGE}"/>
  <rect x="0" y="${S - 46}" width="46" height="46" fill="${ORANGE}"/>
  <rect x="0" y="0" width="46" height="46" fill="${ORANGE_DEEP}"/>
  <circle cx="${S / 2}" cy="${S / 2}" r="176" fill="#FFFFFF" stroke="${INK}" stroke-width="16"/>
  <path d="M${S / 2 - 92} ${S / 2 - 58} L${S / 2 - 46} ${S / 2 + 62} L${S / 2} ${S / 2 - 34} L${S / 2 + 46} ${S / 2 + 62} L${S / 2 + 92} ${S / 2 - 58}" fill="none" stroke="${ORANGE}" stroke-width="30" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="${S / 2 + 118}" cy="${S / 2 - 122}" r="26" fill="${ORANGE_DEEP}"/>
  <text x="${S / 2}" y="${S - 96}" text-anchor="middle" font-family="Arial, sans-serif" font-size="34" font-weight="700" fill="${INK}">WebAR - print this marker - point the camera at it</text>
</svg>
`;
}

// --- A4 print sheet ---------------------------------------------------------------
function buildA4Canvas() {
  const W = 2480; // A4 @ 300 DPI
  const H = 3508;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = INK;
  ctx.textAlign = 'center';
  ctx.font = 'bold 78px Arial, sans-serif';
  ctx.fillText('WebAR Spatial 3D Anchor & Canvas', W / 2, 220);
  ctx.font = '54px Arial, sans-serif';
  ctx.fillStyle = ORANGE_DEEP;
  ctx.fillText('Printable tracking marker (target)', W / 2, 300);

  const markerSize = 1890; // 160 mm at 300 DPI
  const marker = buildMarkerCanvas();
  ctx.drawImage(marker, (W - markerSize) / 2, 420, markerSize, markerSize);

  ctx.fillStyle = INK;
  const lines = [
    '1. Print this page at 100% scale (do NOT use "fit to page").',
    '2. Lay it flat on a table with even lighting - avoid glare and shadows.',
    '3. Open the app and point the camera so the whole marker is visible, then move closer.',
    '4. The object appears anchored to the marker; walk around it for a 360 view.',
    'Tip: you can also display marker.png full-screen on a second phone or monitor.',
  ];
  let y = 420 + markerSize + 150;
  ctx.font = '46px Arial, sans-serif';
  ctx.textAlign = 'left';
  const left = 340;
  for (const line of lines) {
    ctx.fillStyle = INK;
    ctx.fillText(line, left, y);
    y += 78;
  }

  ctx.textAlign = 'center';
  ctx.font = '34px Arial, sans-serif';
  ctx.fillStyle = '#666';
  ctx.fillText('Open-source - MIT licensed - Free forever', W / 2, H - 130);
  return canvas;
}

const marker = buildMarkerCanvas();
writeFileSync(resolve(PUBLIC, 'marker.png'), marker.toBuffer('image/png'));
writeFileSync(resolve(PUBLIC, 'marker.svg'), buildMarkSvg());
const a4 = buildA4Canvas();
writeFileSync(resolve(PUBLIC, 'marker-a4.png'), a4.toBuffer('image/png', { compressionLevel: 9 }));

// Sanity check: make sure the file is a loadable image.
const check = await loadImage(resolve(PUBLIC, 'marker.png'));
console.log(`[marker] public/marker.png       ${SIZE}x${SIZE} (loaded back: ${check.width}x${check.height})`);
console.log('[marker] public/marker-a4.png    2480x3508 (A4 @300 DPI, marker 160mm)');
console.log('[marker] public/marker.svg       vector fallback');
