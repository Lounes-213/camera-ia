# WebAR Spatial 3D Anchor & Canvas

A **zero-install, 100% free and open-source WebAR studio**. Point a camera at a printed
marker (or just show your hand) and you get interactive 3D objects anchored in the real
world — rotate, scale, recolour, add a neon glow, take AR snapshots, export `.glb`, and run a
live shared session with friends.

No backend to run, no account, no paid API, no tracking. Everything runs on free tiers.

- **Marker tracking** — [MindAR](https://github.com/hiukim/mind-ar-js) image tracking with Three.js.
- **Hand tracking** — [MediaPipe Tasks Vision](https://github.com/google-ai-edge/mediapipe) `HandLandmarker`, self-hosted and offline.
- **Shared rooms** — [PeerJS](https://peerjs.com) (free public signalling) over WebRTC data channels — state only, no video.
- **"Ask for an object"** — a multilingual query parser + offline model index, with an optional Poly Pizza proxy.
- **UI** — orange/white design system, glassmorphism, light/dark/system themes, **Arabic (RTL) + French + English**.
- **PWA** — installable, offline app shell.

```
Camera ──▶ MindAR / MediaPipe ──▶ ARManager ──▶ SceneManager (Three.js)
                                                   │
            actions ──▶ store ──▶ event bus ───────┘
```

---

## Table of contents

1. [Quick start](#1-quick-start)
2. [Project scripts](#2-project-scripts)
3. [Generate the `.mind` target from the marker](#3-generate-the-mind-target-from-the-marker)
4. [Test on your phone over local Wi-Fi (HTTPS)](#4-test-on-your-phone-over-local-wi-fi-https)
5. [Deploy for free](#5-deploy-for-free)
6. [Marker image & printable A4](#6-marker-image--printable-a4)
7. [Keyboard & gesture reference](#7-keyboard--gesture-reference)
8. [Add a new 3D object](#8-add-a-new-3d-object)
9. [Add a new language](#9-add-a-new-language)
10. [V2 modules](#10-v2-modules)
11. [Optional services (search key, TURN)](#11-optional-services-search-key-turn)
12. [Self-hosting MediaPipe & decoders](#12-self-hosting-mediapipe--decoders)
13. [Add words to the search dictionary](#13-add-words-to-the-search-dictionary)
14. [Architecture](#14-architecture)
15. [Known limitations](#15-known-limitations)
16. [Tuning tips](#16-tuning-tips)
17. [License & credits](#17-license--credits)

---

## 1. Quick start

Requirements: **Node.js ≥ 20** and a browser with WebGL 2 + `getUserMedia`.

```bash
npm ci                 # install (uses the committed lockfile)
npm run prepare:assets # marker + icons + MediaPipe runtime + Draco/Basis decoders
npm run gen:target     # compile public/targets.mind  (~1-3 min, CPU heavy)
npm run dev            # HTTPS dev server on https://<your-lan-ip>:5173
```

`npm run dev` uses [`@vitejs/plugin-basic-ssl`](https://github.com/vitejs/vite-plugin-basic-ssl),
so the server is reachable from other devices on your Wi-Fi. Open the printed URL on your
phone and accept the self-signed certificate warning once.

> The `dist/` folder is the build output. `public/mediapipe/**` and `public/targets.mind` are
> **git-ignored** (large third-party binaries) and re-created by the two commands above.

---

## 2. Project scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Vite dev server, HTTPS, exposed on the LAN (`--host`). |
| `npm run build` | `tsc -b` (strict typecheck) then `vite build` → `dist/`. |
| `npm run prune:deploy` | Strip `dist/` down to a ≤10 MiB deploy bundle (fails loudly if it would not fit). |
| `npm run preview` | Serve the production build locally (also HTTPS/LAN). |
| `npm run lint` | ESLint (flat config, TypeScript rules). |
| `npm run format` | Prettier write. |
| `npm test` | Vitest unit tests (gestures, query parser, state sync, normalizer, math). |
| `npm run test:watch` | Vitest in watch mode. |
| `npm run prepare:assets` | Marker + icons + MediaPipe runtime + Draco/Basis decoders. |
| `npm run gen:marker` | Regenerate `marker.png`, `marker-a4.png`, `marker.svg`. |
| `npm run gen:target` | Compile `public/targets.mind` from `marker.png`. |
| `npm run copy:mediapipe` | Copy the self-hosted MediaPipe wasm + model into `public/`. |
| `npm run copy:decoders` | Copy Three.js Draco/Basis decoders into `public/`. |
| `npm run gen:icons` | Generate the PWA icons. |

---

## 3. Generate the `.mind` target from the marker

A `.mind` file is MindAR's compiled feature descriptor of your target image. It must match the
exact printed marker.

### Option A — offline (recommended, reproducible)

```bash
npm run gen:marker   # writes public/marker.png (1024x1024, deterministic)
npm run gen:target   # compiles public/targets.mind
```

`gen:target` uses MindAR's own `OfflineCompiler` (the same code as the web tool) on a pure-JS
TensorFlow CPU backend. It takes 1–3 minutes. It needs the native `canvas` package, which is a
transitive dependency of `mind-ar` and is pinned via `overrides` in `package.json`.

### Option B — MindAR free online compiler

1. Open <https://hiukim.github.io/mind-ar-js-doc/tools/compile>.
2. Drop in `public/marker.png` (or your own high-contrast, asymmetric image).
3. Download the resulting `targets.mind` and put it in `public/`.

### Using your own marker

Replace `public/marker.png` with your image (best between **480 and 1600 px** on the long edge,
rich in non-repeating, high-contrast detail — avoid symmetric or blank patterns), then recompile.
To point the app at a different file without a rebuild, set `VITE_TARGET_SRC=my-target.mind`.

---

## 4. Test on your phone over local Wi-Fi (HTTPS)

`getUserMedia` (camera) requires a **secure context**: HTTPS *or* `localhost`.

1. Run `npm run dev` on your computer.
2. Find the LAN URL Vite prints, e.g. `https://192.168.1.20:5173`.
3. On the phone (same Wi-Fi), open it and accept the self-signed certificate.
   - **iOS Safari:** if the page stays blank, enable *Settings → Safari → Advanced →
     Show Develop menu* is not needed; instead use **trust over local network** apps or simply
     tunnel once (see below).
   - **Android Chrome:** tap *Advanced → Proceed*.
4. Allow camera access and point at the printed marker.

If a device refuses the self-signed cert, use a free tunnel for HTTPS:

```bash
npx localtunnel --port 5173          # or: cloudflared tunnel --url https://localhost:5173
```

---

## 5. Deploy for free

The build is a static `dist/` folder plus an optional serverless function folder
(`functions/`). All four hosts below have a generous free tier.

### Sites (agent-managed, what this workspace deploys to)

Sites publishes a static bundle plus a tiny Worker, and caps a deploy at **10 MiB / 1000 assets**
— so `prune:deploy` is mandatory here (MediaPipe alone is ~40 MB and falls back to the CDN, see
[§12](#12-self-hosting-mediapipe--decoders)).

The Worker + manifest live in [`deploy/`](deploy/): `deploy/worker.js` just serves
`env.ASSETS.fetch(request)`, and `deploy/manifest.json` points `assetsDirectory` at `../dist`.

```bash
npm run build          # typecheck + bundle
npm run prune:deploy   # strip MediaPipe / Draco encoders / semantic chunk → ~8 MiB
```

The manifest is then uploaded to the **preview** environment (preview and production are
independent, and both are public). `functions/` is *not* uploaded here, so the online model
search falls back to the bundled offline index; everything else works.

### Cloudflare Pages (recommended — also runs the search proxy)

**Dashboard:** *Workers & Pages → Create → Pages → Connect to Git*, then

- **Build command:** `npm run prepare:assets && npm run gen:target && npm run build`
- **Build output directory:** `dist`
- **Root directory:** repository root
- The `functions/` directory is detected automatically and serves `/api/search` + `/api/model`.
- *Settings → Environment variables* → add `POLY_PIZZA_KEY` (encrypted) to enable online
  search. Without it the app silently uses the offline index, so the key is genuinely optional.

**CLI:**

```bash
npx wrangler pages project create webar-spatial-anchor
npx wrangler pages deploy dist --project-name webar-spatial-anchor
```

`wrangler.toml` documents both routes. Add secrets with
`npx wrangler pages secret put POLY_PIZZA_KEY`.

### Netlify

[`netlify.toml`](netlify.toml) already configures build command, publish dir, functions and
the `/api/*` redirect. Connect the repo and add `POLY_PIZZA_KEY` under
*Site configuration → Environment variables*. Free tier is enough.

### GitHub Pages

[`.github/workflows/deploy-pages.yml`](.github/workflows/deploy-pages.yml) builds and deploys
on push to `main`. Enable *Settings → Pages → Source: GitHub Actions* once.

> GitHub Pages cannot run serverless functions, so the **online** model search falls back to
> the bundled offline index there. Marker/hands mode, rooms and export all work fine. The
> workflow sets `BASE_PATH=/<repo>/` so assets resolve under the project sub-path.

---

## 6. Marker image & printable A4

`npm run gen:marker` writes three files into `public/`:

| File | Purpose |
| --- | --- |
| `marker.png` | 1024×1024 high-contrast asymmetric tracking target (also used by `gen:target`). |
| `marker-a4.png` | A4 @ 300 DPI print sheet: the marker at **160 mm** plus print notes. |
| `marker.svg` | Vector version (scale it, then recompile the target). |

In the app, the onboarding screen and the *"Get the marker"* button open a modal where you can
view and download the marker — print it, or show it full-screen on a second device and point
the first camera at it (screen markers track well if the brightness is high).

---

## 7. Keyboard & gesture reference

### Keyboard (desktop)

| Key | Action |
| --- | --- |
| `R` | Reset transform |
| `S` | Take a snapshot |
| `T` | Toggle theme (light / dark / system) |
| `L` | Cycle language (EN → FR → AR) |
| `Space` | Toggle auto-rotate |
| `1`–`7` | Select object 1–7 |
| `H` | Toggle Hands mode |
| `F` | Open the search sheet |
| `M` | Open the room panel |
| `V` | Toggle fullscreen |
| `D` | Toggle the FPS/debug overlay |
| `?` or `/` | Open the shortcut help ("learning mode") |
| `Esc` | Close the active modal / sheet |

### Pointer & touch

| Input | Action |
| --- | --- |
| Mouse drag / one-finger drag | Rotate |
| Wheel / pinch | Scale |
| Two-finger drag | Height above the marker |
| Double tap | Reset transform |

### Hands mode gestures

| Gesture | Action |
| --- | --- |
| Pinch (thumb ↔ index) | Grab — the object follows your hand |
| Open palm moving | Rotate (yaw/pitch from the palm normal) |
| Two hands pinching | Scale by the distance between hands |
| Fist held 1 s | Reset |
| Point (index only) | Laser UI cursor — hold over a control 600 ms to "click" |

---

## 8. Add a new 3D object

Built-in objects are pure procedural Three.js factories — no downloads. To add one:

1. Create `src/core/objects/factories/myThing.ts`:

   ```ts
   import { Group, Mesh, BoxGeometry, MeshStandardMaterial } from 'three';
   import type { ObjectFactory } from './shared';

   /** A short description shown in the object picker. */
   export const myThing: ObjectFactory = () => {
     const group = new Group();
     const mesh = new Mesh(new BoxGeometry(0.4, 0.4, 0.4), new MeshStandardMaterial());
     mesh.name = 'body';
     group.add(mesh);
     return group;
   };
   ```

2. Register it in `src/core/objects/factories/index.ts` (key → factory).
3. Add a label for it in the i18n files (`objects.<key>` in `en.json`, `fr.json`, `ar.json`).

The registry handles normalization, shadow configuration and disposal automatically — every
geometry, material and texture you create is released when the object changes, so there are no
leaks. Users can also **drag & drop** a `.glb`/`.gltf` on desktop or pick one on mobile; imported
models are normalized to a 1-unit bounding box with their base on the marker plane.

---

## 9. Add a new language

1. Copy `src/ui/i18n/en.json` to `src/ui/i18n/xx.json` and translate the values (keys never change).
2. Register it in `src/ui/i18n/index.ts`:
   - add the code to the `Lang` union and the `LANGS` array,
   - import the JSON and add it to `catalogs`,
   - add a label in `LANG_LABELS`,
   - if it is right-to-left, add it to `RTL_LANGS`.

`en.json` is the source of truth: its flattened keys become the compile-time `TranslationKey`
union, so `t('missing.key')` fails the typecheck. Missing keys in other locales fall back to
English per key, so a half-finished translation never crashes — it just shows English.

Layout mirrors automatically via CSS logical properties (`margin-inline`, `inset-inline`, …);
check the bottom sheet, sidebar and toasts in the new language.

---

## 10. V2 modules

Every V2 module is behind a **feature flag** in [`src/app/config.ts`](src/app/config.ts) and
loaded with a dynamic `import()`, so the base bundle stays small. Set the flags via `VITE_*`
environment variables (see [`.env.example`](.env.example)).

| Flag | Default | Module |
| --- | --- | --- |
| `VITE_FEATURE_HANDS` | `true` | Markerless hand tracking (`src/core/hands/`). |
| `VITE_FEATURE_ROOMS` | `true` | Multi-user rooms (`src/core/network/`). |
| `VITE_FEATURE_SEARCH` | `true` | "Ask for an object" (`src/core/search/`). |
| `VITE_FEATURE_SEMANTIC` | `false` | Optional ~30 MB multilingual MiniLM re-ranking. |
| `VITE_FEATURE_VOICE` | `true` | Web Speech API voice input in the search sheet. |
| `VITE_FEATURE_PWA` | `true` | Service worker / offline shell. |

### Module 1 — Markerless hand tracking

MediaPipe `HandLandmarker` in VIDEO mode with the GPU delegate and a CPU fallback. The wasm and
`hand_landmarker.task` are served from `/public/mediapipe`, so hands mode works **offline** with
zero CDN calls. Detection runs every 2nd frame (3rd when frames are slow) so it can never block
the render loop; the last pose is reused in between and all 21 landmarks pass through a One-Euro
filter. Switching **[Marker] ⇄ [Hands]** stops MindAR and reuses the **same** `<video>` /
`MediaStream` — the camera is never opened twice and permission is never re-prompted. Detection
drops to a 4 FPS poll after 5 s without a hand, and pauses when the tab is hidden.

### Module 2 — Multi-user rooms

WebRTC data channels via PeerJS (free public cloud signalling, swappable for a self-hosted
PeerServer with `VITE_PEER_*`). Create a room → a 5-character code, a QR code and a share link
(`?room=ABC12`). Up to 4 peers in a host-star topology; the host relays to the others and
migrates to the oldest peer if it leaves.

**No video is streamed.** Each user keeps their own camera and their own marker/hand — only
**state** is synced, so everyone sees the same object anchored in their own real space. Synced:
object/model reference, material params, transform (quaternion/scale/height), animation state,
remote cursor/laser position and reaction emojis. Transforms are last-writer-wins with a
timestamp + sequence number, throttled to ~18 Hz with deltas only and slerp interpolation on
receive. A control lock ensures only one user rotates at a time. Late joiners get a full
snapshot; searched models are shared **by reference** (each client downloads and caches it),
with chunked transfer (≤ 5 MB) only for user-imported GLBs. Every incoming message is schema-
validated, size-limited and rate-limited.

### Module 3 — "Ask for an object"

Type or speak in English, French, Arabic or Darija-latin ("bghit qita", "je veux un chat",
"I want a rocket") and get a grid of results. `QueryParser` normalizes text (lowercase, strip
diacritics, Arabic normalization), removes filler words, detects the language and maps the key
noun to English using a bundled dictionary of **147 objects** × 4 word forms, with fuzzy
matching (Fuse.js). Searches are debounced (400 ms) and abortable; offline or on quota errors it
falls back to the local index.

Providers implement a pluggable `SearchProvider` interface:

1. **LocalIndex** (offline-first) — 12 CC0/CC-BY Khronos glTF sample models with trilingual tags,
   cached after first use.
2. **PolyPizza** (online) — via the deployment's own serverless proxy so the API key stays
   server-side; only CC0 and CC-BY results are returned.

`ModelNormalizer` centres the GLB, scales it to a 1-unit box, puts its base on the marker plane
and rejects models over budget (**> 150k triangles** or **> 10 MB**) with a friendly message.
`ModelCache` uses Cache Storage + IndexedDB so previously loaded models work offline and load
instantly. Attribution (author, title, licence, source) is recorded automatically and shown in
the **Credits** dialog.

> **Sketchfab is intentionally not implemented** — its download API requires OAuth and a login,
> which violates the "no account" rule. The `SearchProvider` interface is ready for it if you
> want to add it yourself.

---

## 11. Optional services (search key, TURN)

Both are **optional**: with no configuration the app uses the offline index and the public
PeerJS cloud.

### Poly Pizza API key (online model search)

1. Create a free account at <https://poly.pizza> and copy your API key.
2. Add it as a **secret** on your host (never in the client bundle):
   - **Cloudflare Pages:** Settings → Environment variables → `POLY_PIZZA_KEY` (encrypted), or
     `npx wrangler pages secret put POLY_PIZZA_KEY`.
   - **Netlify:** Site configuration → Environment variables → `POLY_PIZZA_KEY`.

The `functions/api/*` handler reads the key from the environment, adds CORS + cache headers and
a basic rate limit (`RATE_LIMIT_PER_MINUTE`, default 30).

### TURN relay (reliable rooms)

STUN alone works for most home Wi-Fi, but strict NAT / symmetric CGNAT (typical on mobile data)
needs a TURN relay. Grab free credentials from [Open Relay](https://www.metered.ca/tools/openrelay/)
or the Metered free tier and set:

```bash
VITE_TURN_URL=turn:relay.example.com:3478
VITE_TURN_USER=your-user
VITE_TURN_CREDENTIAL=your-credential
```

Without TURN the app still works and shows a friendly "connection couldn't be established — try
Wi-Fi" message instead of failing silently.

---

## 12. Self-hosting MediaPipe & decoders

The app is **offline-first**: it always prefers the runtime it hosts itself, so hands mode works
inside the PWA with zero third-party requests. `npm run prepare:assets` runs:

- `copy:mediapipe` — copies `@mediapipe/tasks-vision`'s wasm runtime **and**
  `hand_landmarker.task` into `public/mediapipe/`;
- `copy:decoders` — copies Three.js's Draco and Basis (KTX2) decoders into `public/draco/` and
  `public/basis/`.

### CDN fallback (deployed builds)

The MediaPipe runtime weighs **~40 MB**, which does not fit every host's upload budget
(Sites caps a deploy at 10 MiB / 1000 assets). `HandTracker` therefore probes
`<wasmRoot>/vision_wasm_internal.js` at init and:

- **local files present** → use them, no third-party request is made;
- **local files absent** → fall back to the CDN, so hands mode still works while online.

The probe is a `HEAD` whose **content-type is checked**, not just `res.ok` — an SPA host answers
`200 text/html` for missing files, which would otherwise look like a valid runtime. The probe
only runs once, on first use of hands mode; marker mode never touches any of these files.

Fallback roots are configurable in `config.ts` and via env vars
(`VITE_MEDIAPIPE_CDN`, `VITE_MEDIAPIPE_MODEL_CDN`); jsDelivr is used for the wasm and Google
Storage for the model, both serving `Access-Control-Allow-Origin: *`.

The paths are configurable in `config.ts` (`hands.wasmRoot`, `hands.modelPath`). Draco, Meshopt
and KTX2 decoders are wired into the loader, so compressed glTF models load correctly.

---

## 13. Add words to the search dictionary

`src/core/search/dictionary.json` is a plain map from an English canonical key to its variants:

```json
{
  "rocket": ["rocket", "صاورخ", "صاروخ", "fusée", "fusee", "sawarikh"]
}
```

Add a new entry (or extra synonyms — accents, Arabic forms, Darija-latin spellings) and the
parser will match it. Fuzzy matching means small typos and missing diacritics still resolve. A
unit test in `tests/query-parser.test.ts` guards the normalization rules.

---

## 14. Architecture

```
src/
  main.ts                     bootstrap
  app/       App.ts           orchestrator + single rAF frame loop
             store.ts         tiny typed reactive store
             appStore.ts      the application state store instance
             events.ts        typed event bus
             actions.ts       every side effect the UI can trigger
             runtime.ts       lazy subsystem registry
             state.ts         state shape + initial value
             config.ts        feature flags, tuning, URLs
  core/
    ar/         ARManager.ts            MindAR lifecycle, target events
    scene/      SceneManager.ts         camera/renderer/object host
                LightingRig.ts          RoomEnvironment/PMREM PBR lighting
                GlowEffect.ts           alpha-safe emissive bloom over video
                Shadow.ts               contact shadow on the marker plane
    objects/    ObjectRegistry.ts       id → factory, swap + dispose
                factories/*.ts          procedural objects
                GLBLoader.ts            Draco/Meshopt/KTX2-aware loader
    input/      InputController.ts      mouse/touch/keyboard → actions
    capture/    Snapshot.ts             video + canvas composite
                ExportGLB.ts            GLTFExporter wrapper
    hands/      HandTracker.ts          MediaPipe lifecycle + throttling
                GestureRecognizer.ts    pure, unit-tested gesture math
                HandCursor.ts           hover-to-click laser cursor
                projection.ts           screen ⇄ world projection
    network/    RoomManager.ts          room lifecycle, host election
                PeerTransport.ts        PeerJS data channels + reconnect
                StateSync.ts            versioned state merge & interpolation
                RemoteCursor.ts         remote laser/emoji rendering
    search/     ModelSearch.ts          orchestration, debounce, abort
                QueryParser.ts          normalization + multilingual matching
                dictionary.json         147 objects × en/fr/ar/darija
                local-index.json        offline model index
                providers/              LocalIndex, PolyPizza, types
                ModelNormalizer.ts      centre/scale/budget enforcement
                ModelCache.ts           Cache Storage + IndexedDB
                SemanticIndex.ts        optional embeddings client
  ui/
    components/  TopBar, StatusChip, BottomSheet, Sidebar, PanelHost, Tabs,
                 ColorPicker, Slider, controls, Toast, Modal, Onboarding,
                 ErrorScreen, ObjectPicker, SearchSheet, StylePanel,
                 TransformPanel, ExportPanel, RoomPanel, CreditsModal,
                 MarkerModal, SnapshotModal, DebugOverlay, HandModeToggle,
                 HandsTutorial
    theme/       tokens.css, light.css, dark.css, ThemeManager.ts
    i18n/        index.ts, en.json, fr.json, ar.json
    dom.ts, icon.ts
  styles/        base.css, layout.css, components.css
  utils/         device.ts, storage.ts, math.ts, raf.ts, assets.ts
  workers/       semantic.worker.ts       optional embeddings worker
functions/       _shared.ts, api/search.ts, api/model.ts
public/          marker.png, marker-a4.png, marker.svg, targets.mind,
                 mediapipe/, draco/, basis/, icons/, manifest.webmanifest, sw.js
tests/           gesture, query-parser, state-sync, model-normalizer, math
```

**Rules enforced across the codebase**

- No global mutable state outside the store.
- The UI never touches Three.js / MediaPipe / PeerJS / `fetch` directly — only via actions and
  the event bus.
- Every geometry, material and texture is disposed on object change; the frame loop is a single
  `requestAnimationFrame`; rendering pauses when the tab is hidden or the target has been lost
  for a while; pixel ratio is capped at 2 and quality auto-downgrades on slow frames.
- Strict TypeScript, JSDoc on public APIs, small pure functions.

---

## 15. Known limitations

- **iOS hand tracking.** Safari on iOS runs MediaPipe on the CPU (no reliable WebGL delegate for
  this workload in all versions), so hands mode is slower there. The app detects slow frames and
  degrades quality, but marker mode is the safer choice on older iPhones.
- **NAT traversal.** Without a TURN relay, users behind strict NAT / symmetric CGNAT (common on
  mobile data) may be unable to connect rooms. The app explains this and suggests Wi-Fi.
- **Self-signed dev certificate.** Some mobile browsers refuse the local HTTPS cert; use a tunnel
  if that happens.
- **GitHub Pages** cannot host the search proxy, so online search is unavailable there (offline
  index still works).
- **Licence obligations.** Poly Pizza results are filtered to CC0/CC-BY, but for CC-BY you are
  responsible for keeping the attribution. The app records it and shows it in the Credits dialog;
  keep the snapshot caption option enabled when you publish.
- **Large models.** Anything over the triangle/size budget is rejected rather than stuttering on
  the user's phone.
- **Deploy size budget.** `npm run prune:deploy` shrinks a build to ~8 MiB so it fits a 10 MiB
  upload cap (MediaPipe wasm, the Draco *encoders* and the optional semantic-search chunk are
  dropped). Marker mode stays fully self-hosted; hands mode then loads its runtime from the CDN,
  so it needs the internet once per device instead of working fully offline.
- **MindAR console warning (harmless).** MindAR's bundle sets `renderer.outputEncoding`, which
  Three.js r152+ renamed — so the browser console logs
  *"Property .outputEncoding has been removed. Use .outputColorSpace instead."* once at startup.
  This comes from MindAR's own code (`mindar-image-three.prod.js`), not from this project — our
  `ARManager` correctly sets `renderer.outputColorSpace`. Three's deprecated setter still maps the
  value across, so rendering is unaffected; the warning will disappear when MindAR updates.
- **Sketchfab** is not integrated (OAuth/login required) — see [Module 3](#module-3--ask-for-an-object).

---

## 16. Tuning tips

- **Jitter vs. lag.** `VITE_FILTER_MIN_CF` (lower = steadier, laggier) and `VITE_FILTER_BETA`
  (higher = snappier on fast motion) in `config.ts` tune MindAR's One-Euro pose filter.
- **Frame budget.** `perf.slowFrameMs` and `perf.slowSamples` control when quality auto-downgrades;
  `perf.maxPixelRatio` caps the resolution.
- **Hands cadence.** `hands.detectEvery` / `detectEverySlow` and `hands.idleIntervalMs` trade CPU
  for responsiveness. `hands.pinchOn`/`pinchOff` set the pinch hysteresis — widen the gap if the
  grab flickers.
- **Marker quality.** Recompile after changing the marker. A 160–200 mm print under bright,
  diffuse light tracks furthest; glossy paper and backlight hurt tracking.
- **Search fallback.** `search.debounceMs` and the `maxTriangleCount`/`maxDownloadBytes` budgets
  are in `config.ts`.
- **Debug overlay.** Press `D` for FPS, frame time, pixel ratio and tracking state.

---

## 17. License & credits

MIT. Model sources, licences and library attributions are listed in
[`public/model-credits.json`](public/model-credits.json) and shown in the in-app **Credits**
dialog. Bundled libraries: three.js (MIT), MindAR (MIT), MediaPipe (Apache-2.0), PeerJS (MIT),
lucide (ISC), Fuse.js (Apache-2.0), Inter & Cairo (OFL-1.1).
