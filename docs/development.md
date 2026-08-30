# Development

## Requirements

- Node.js 24 or newer.
- npm.

Install dependencies once:

```sh
npm install
```

Start the app:

```sh
npm run dev
```

The Vite dev server sends the COOP/COEP headers required for threaded WASM.

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start Vite. Runs `copy:tfjs-wasm` and `fetch:model` first. |
| `npm test` | Run all Vitest tests. |
| `npm run test:typecheck` | Type-check the test project. |
| `npm run lint` | Run ESLint. |
| `npm run build` | Run `tsc -b` and build Vite output into `dist/`. |
| `npm run preview` | Serve `dist/` locally with preview headers. |
| `npm run fetch:model` | Ensure the locally-hosted model tiers exist (`katago-small.bin.gz`, `katago-b10.bin.gz`, `katago-b18.bin.gz`). |
| `npm run copy:tfjs-wasm` | Copy TensorFlow.js WASM binaries into `public/tfjs/`. |
| `npm run audit` | Run `npm audit --audit-level=moderate`. |

## Project Layout

| Path | Contents |
| --- | --- |
| `src/components/` | React UI: match card, board grid, actions, dialogs, and toasts. |
| `src/hooks/` | UI orchestration hooks (model manager, hint modes, score judgment). |
| `src/store/` | Global game state and actions (`gameStore.ts`) with settings, game-tree, and analysis helpers. |
| `src/engine/katago/` | Browser KataGo parser, TensorFlow.js model, worker, search, and board logic. |
| `src/utils/` | Game logic, board size, storage, sound, analysis queue, and locale helpers. |
| `public/` | Static assets and model files. |
| `scripts/` | Model and TensorFlow.js WASM setup. |
| `test/` | Vitest unit and component tests. |
| `docs/` | Project documentation. |

## Model Assets

Normal dev and build commands keep two generated asset groups ready:

- `public/models/katago-small.bin.gz`: the B6 tier, KataGo's small test network.
- `public/models/katago-b10.bin.gz`: the B10 tier, a 10-block 128-channel network (~11 MB). This is the default tier.
- `public/models/katago-b18.bin.gz.001` – `.004`: the B18 tier, split into four
  ≤24 MiB chunks so Cloudflare's 25 MiB per-file limit can host it. The app
  fetches the chunks in order, concatenates them, verifies MD5 and caches the
  result in IndexedDB.
- `public/tfjs/*.wasm`: copied from `@tensorflow/tfjs-backend-wasm`.

These files are runtime assets, not application source. If they are missing,
rerun `npm run fetch:model` or `npm run copy:tfjs-wasm`.

`npm run fetch:model` fills in any missing files. The ~96 MB b18 file is
skipped when absent unless you run with `FETCH_B18_MODEL=1`, so normal builds
keep whatever copy is already committed under `public/models/`.

To fetch or refresh the b18 model explicitly:

```sh
FETCH_B18_MODEL=1 npm run fetch:model
```

## Testing

Use focused tests while developing, then run the broader checks before handing
off larger changes:

```sh
npm test
npm run test:typecheck
npm run lint
npm run build
```

## Local Storage During Development

Browser state can affect manual testing. Useful storage locations:

- Settings: versioned `easy-go:settings:*` localStorage keys.
- Downloaded model cache (b18 and worker-fetched models): IndexedDB
  `easy-go-model-cache`. Keys include a version number; bumping
  `MODEL_CACHE_VERSION` in `src/engine/katago/modelCache.ts` invalidates it
  after a model update. Every cache hit is also checked against the model's
  MD5 (`tier.md5` in `src/engine/katago/modelDefaults.ts`); a mismatch is
  treated as missing and re-downloaded, so corruption or a stale copy is
  replaced even without a version bump.
- Model tier and per-tier thinking time: `easy-go:model-tier` and
  `easy-go:model-thinking-ms` localStorage keys managed by
  `src/hooks/useModelManager.ts`.

For stubborn manual-test state, clear site data in browser devtools.

## Common Troubleshooting

**Model fetch fails**

Run `npm run fetch:model`, then restart Vite. If testing a custom URL, make sure
the server allows browser fetches from the app origin.

**WebGPU is unavailable**

The worker should fall back to WASM or CPU. You can also pin the backend in
Settings.

**Threaded WASM is unavailable**

Check that the page is served with COOP/COEP headers. Vite dev and preview are
already configured.

**Production app looks stale**

The app has no service worker. If the production build looks stale, hard-refresh
or clear site data in browser devtools.
