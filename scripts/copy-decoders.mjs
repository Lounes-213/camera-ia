#!/usr/bin/env node
/**
 * Self-hosts the GLTF decoders so model loading never calls a CDN:
 *   public/draco/  <- three/examples/jsm/libs/draco
 *   public/basis/  <- three/examples/jsm/libs/basis  (KTX2 / Basis Universal)
 */
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const jobs = [
  ['node_modules/three/examples/jsm/libs/draco', 'public/draco'],
  ['node_modules/three/examples/jsm/libs/basis', 'public/basis'],
];

for (const [from, to] of jobs) {
  const src = resolve(ROOT, from);
  const dest = resolve(ROOT, to);
  if (!existsSync(src)) {
    console.warn(`[decoders] source missing: ${from}`);
    continue;
  }
  mkdirSync(dest, { recursive: true });
  cpSync(src, dest, { recursive: true });
  console.log(`[decoders] ${from} -> ${to}`);
}
