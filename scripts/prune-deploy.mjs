#!/usr/bin/env node
/**
 * Prunes `dist/` so it fits a host that caps uploads at 10 MiB / 1000 assets.
 *
 * Run after `npm run build` and before `sites_deploy`.
 *
 * Removed, and why it is safe:
 *   mediapipe/                ~40 MB of wasm + model. HandTracker probes this
 *                              folder and falls back to the CDN when absent, so
 *                              hands mode still works while online. Marker mode
 *                              never touches these files.
 *   draco/*encoder*            Only *decoding* is needed to load compressed
 *                              glTF; the encoders are for authoring.
 *   assets/transformers-*.js   Backs the optional semantic re-ranking, which is
 *                              gated behind `features.semanticSearch`
 *                              (default false) and therefore never fetched.
 *   *.map                      Source maps are not published.
 *
 * Exits non-zero if the result would still exceed the budget, so an oversized
 * bundle can never be deployed silently.
 */
import { statSync } from 'node:fs';
import { rm, readdir } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST = resolve(__dirname, '..', 'dist');

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_FILES = 1000;

/** Directories that go away entirely. */
const DROP_DIRS = ['mediapipe'];
/** Exact file-name matches (with their subpath). */
const DROP_FILES = ['_headers'];
/** Patterns matched against the posix-style path relative to dist/. */
const DROP_PATTERNS = [
  /(^|\/)[^/]*encoder\.js$/, // draco encoder
  /^assets\/transformers-.*\.js$/, // optional semantic worker payload
  /\.map$/, // source maps
];

/** @param {string} p */
const matches = (p) => DROP_PATTERNS.some((re) => re.test(p));

async function walk(dir) {
  /** @type {string[]} */
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else out.push(full);
  }
  return out;
}

function sizeOf(files) {
  let total = 0;
  for (const file of files) {
    try {
      total += statSync(file).size;
    } catch {
      /* ignore */
    }
  }
  return total;
}

const mib = (bytes) => `${(bytes / 1048576).toFixed(2)} MiB`;

let files = await walk(DIST);
const beforeCount = files.length;
const beforeBytes = sizeOf(files);

for (const dir of DROP_DIRS) {
  await rm(join(DIST, dir), { recursive: true, force: true });
}

files = await walk(DIST);
for (const file of files) {
  const rel = relative(DIST, file).split('\\').join('/');
  if (DROP_FILES.includes(rel) || matches(rel)) {
    await rm(file, { force: true });
  }
}

files = await walk(DIST);
const afterBytes = sizeOf(files);
const removedBytes = beforeBytes - afterBytes;
const removedCount = beforeCount - files.length;

console.log(`[prune] dist/    ${mib(beforeBytes)}  in ${beforeCount} files`);
console.log(`[prune] removed  ${mib(removedBytes)} in ${removedCount} file(s)`);
console.log(`[prune] result   ${mib(afterBytes)}  in ${files.length} files`);
console.log(`[prune] budget   ${mib(MAX_BYTES)}  / ${MAX_FILES} files`);

const problems = [];
if (afterBytes > MAX_BYTES) {
  problems.push(
    `dist/ is ${mib(afterBytes)}, which exceeds the ${mib(MAX_BYTES)} deploy budget by ${mib(afterBytes - MAX_BYTES)}`,
  );
}
if (files.length > MAX_FILES) {
  problems.push(`dist/ has ${files.length} files, over the ${MAX_FILES} asset limit`);
}

if (problems.length > 0) {
  console.error('[prune] FAILED — refusing to produce an undeployable bundle:');
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

console.log('[prune] OK — within deploy budget');
