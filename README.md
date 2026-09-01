# Easy Go

Easy Go is a browser-based Go study app inspired by
[KaTrain](https://github.com/sanderland/katrain). It runs KataGo-style neural
network evaluation locally in the browser with TensorFlow.js, keeps the search
work off the main thread in a Web Worker, and needs no analysis server.

## Highlights

- Play against browser KataGo, which always plays the strongest move it finds,
  or watch it play itself in self-play mode.
- New games from 5×5 to 19×19, choosing to play Black or White and one of three
  locally-hosted model tiers, each with its own per-move thinking time.
  Self-play always uses the bundled B10 model.
- Live win rate, top-move recommendation hints that keep improving while you
  play, undo, pass, and an instant territory score judgment (temporary or
  locked-on) that renders from a cheap network-only read without a search.
- A local practice library built from the bundled Go data: browse a tree of
  life-and-death collections, famous/hikaru games, and Kogo's joseki
  dictionary, then use decomposition, attempt, or reversal modes. Practice
  boards crop to the relevant region and restrict KataGo to that region.
- The strongest B18 model downloads in the background with progress, is cached
  in IndexedDB, and is verified by MD5 before it is used.

## Quick Start

Use Node.js 24 or newer for the closest match to CI.

```sh
npm install
npm run dev
```

The first dev or production build may take a moment. The `predev` and
`prebuild` hooks copy TensorFlow.js WASM files into `public/tfjs/` and ensure
the small KataGo test model exists at `public/models/katago-small.bin.gz`.

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the Vite dev server with COOP/COEP headers. |
| `npm test` | Run the fast Vitest suite (basic cases; model/search cases are tagged `perf` and skipped). |
| `npm run test:perf` | Run the performance cases (KataGo model load + MCTS search/benchmark). |
| `npm run test:all` | Run the entire Vitest suite. |
| `npm run test:typecheck` | Type-check the tests. |
| `npm run lint` | Run ESLint. |
| `npm run build` | Type-check and build the production app. |
| `npm run preview` | Serve the production build locally with preview headers. |

## Models and Performance

Three model tiers are hosted locally on the site and selectable from the new
game dialog:

- **B6 (6M)** — KataGo's tiny test network, loads almost instantly; kept in
  the local IndexedDB cache after first use.
- **B10 (10M)** — the default; a 10-block 128-channel network. B6 and B10 are
  both warmed into the local IndexedDB cache in the background. When B10 is
  not cached yet the app starts on B6 immediately, downloads B10 in the
  background, and silently switches to it when ready.
- **B18 (96M)** — the recommended b18c384nbt network. Selecting it opens a
  download dialog with a progress bar; the file is hosted as four ≤24 MiB
  chunks (compatible with Cloudflare's 25 MiB limit), fetched and concatenated
  in order, then cached in IndexedDB and reused on later visits without
  re-downloading. Cached bytes are verified against the model's MD5 and
  re-fetched when they mismatch.

Each tier has its own independent per-move thinking-time slider in whole
seconds — B6: 1–10 s, B10: 1–20 s, B18: 1–60 s. Switching to a tier resets
its slider to the middle default (B6 5 s, B10 10 s, B18 30 s). Model buttons
show only the tier name until selected; the selected button also shows its
seconds (e.g. B10 10s) and updates live while dragging the slider. No size
labels are shown. Download progress uses real byte sizes instead of a hardcoded
size label. Hint recommendations keep improving through an independent
continuous search budget, separate from the per-move thinking time.

The parser supports KataGo model versions 8 through 16. Uploaded browser
models are capped at 128 MB.

The engine prefers TensorFlow.js WebGPU, then falls back to WASM, then CPU.
Threaded WASM needs `SharedArrayBuffer`, which browsers only expose when the
page is cross-origin isolated:

```text
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

Vite dev and preview send these headers. The Cloudflare Worker deployment sets
them on every response, so threaded WASM is available in production too.

## Documentation

- [Documentation index](docs/README.md)
- [Architecture](docs/architecture.md)
- [Engine](docs/engine.md)
- [Development](docs/development.md)
- [Deployment](docs/deployment.md)
- [Runtime diagrams](docs/diagram.md)

## License

[MIT](LICENSE)
