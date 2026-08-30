# Easy Go

Easy Go is a browser-based Go study app inspired by
[KaTrain](https://github.com/sanderland/katrain). It runs KataGo-style neural
network evaluation locally in the browser with TensorFlow.js, keeps the search
work off the main thread in a Web Worker, and can be installed as an offline
PWA. There is no analysis server to run.

**Live app:** https://huazhechen.github.io/easy-go/

## Highlights

**Analyze games**

- Top-move hints, principal variations, ownership, policy, win rate, and score
  lead.
- Quick, fast, and full-game analysis passes with per-position caching.
- KaTrain-style move quality, phase summaries, and game reports.

**Study and play**

- Play against browser KataGo, which always plays the strongest move it finds.
- Teach mode, byo-yomi clocks, resign/pass handling, manual scoring, and 9x9,
  13x13, or 19x19 boards.
- Branching move trees with notes, setup stones, markup, and SGF-compatible
  export.
- Study tools: interactive fundamentals lessons, a score-estimation quiz, a
  "climb the ranks" tournament ladder against calibrated bots, and a
  searchable pro game library. Open any of them from the menu's Study &
  Practice section or the command palette.

**Load and save**

- Import SGF files by picker, paste, drag and drop, or Online-Go game URL.
- Import board positions from a photo or live camera capture.
- Store games in an IndexedDB library with folders, bundled famous games, and
  zip backup/restore.
- Auto-save the current session and recover after a crash or reload.

**Use it anywhere**

- Responsive desktop and mobile layouts.
- UI themes, keyboard shortcuts, command palette, gamepad
  navigation, sound, and haptics.
- Document language metadata for 13 languages, which tags the page and the SGF
  you export. The interface itself is English only.
- Offline app shell, default model, TensorFlow.js WASM files, and board assets
  are cached by the production service worker.

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
| `npm test` | Run the Vitest suite. |
| `npm run test:typecheck` | Type-check the tests. |
| `npm run lint` | Run ESLint. |
| `npm run build` | Type-check and build the production app. |
| `npm run preview` | Serve the production build locally with preview headers. |

## Models and Performance

Three model tiers are hosted locally on the site and selectable from the new
game dialog:

- **B6 (6M)** — KataGo's tiny test network, loads almost instantly.
- **B10 (10M)** — the default; a 10-block 128-channel network. If the local
  copy is missing the app starts on B6 and silently upgrades to B10 in the
  background.
- **B18 (96M)** — the recommended b18c384nbt network. Selecting it opens a
  download dialog with a progress bar; the file is hosted as four ≤24 MiB
  chunks (compatible with Cloudflare's 25 MiB limit), fetched and concatenated
  in order, then cached in IndexedDB and reused on later visits without
  re-downloading. Cached bytes are verified against the model's MD5 and
  re-fetched when they mismatch.

Each tier has its own independent per-move thinking-time slider in whole
seconds — B6: 1–15 s, B10: 2–30 s, B18: 5–60 s. Switching to a tier resets
its slider to the middle default (B6 5 s, B10 10 s, B18 30 s). Model buttons
show "tier + seconds" (e.g. B6 13s) and update live while dragging the slider;
no size labels are shown. The slider sits directly under the model buttons and
follows the current wood theme color. Download progress uses real byte sizes
instead of a hardcoded size label. Hint recommendations deliberately keep a
huge fixed budget (5000 visits / 60 s) regardless of tier or thinking time.

The parser supports KataGo model versions 8 through 16. Uploaded browser
models are capped at 128 MB.

The engine prefers TensorFlow.js WebGPU, then falls back to WASM, then CPU.
Threaded WASM needs `SharedArrayBuffer`, which browsers only expose when the
page is cross-origin isolated:

```text
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

Vite dev and preview send these headers. The production build includes
`public/_headers` for hosts that honor it. GitHub Pages still works without
custom headers, but WASM runs single-threaded there; WebGPU is unaffected.

## Documentation

- [Documentation index](docs/README.md)
- [Architecture](docs/architecture.md)
- [Engine](docs/engine.md)
- [Development](docs/development.md)
- [Deployment](docs/deployment.md)
- [Runtime diagrams](docs/diagram.md)

## License

[MIT](LICENSE)
