# Engine

The engine is a browser-native KataGo-style pipeline built from TypeScript,
TensorFlow.js, and a dedicated Web Worker. It is not a wrapper around the KataGo
binary and does not require a backend server.

## Key Files

| File | Role |
| --- | --- |
| `src/engine/katago/client.ts` | Main-thread worker client and request bookkeeping. |
| `src/engine/katago/worker.ts` | Model loading, backend selection, feature extraction, request queue, and worker responses. |
| `src/engine/katago/loadModelV8.ts` | Parser for KataGo `.bin` model versions 8 through 16. |
| `src/engine/katago/modelV8.ts` | TensorFlow.js model graph construction and forward passes. |
| `src/engine/katago/featuresV7Fast.ts` | Fast feature tensor filling for KataGo v7-style inputs. |
| `src/engine/katago/fastBoard.ts` | Compact board representation, legal move checks, ko, captures, ladders, and board-size setup. |
| `src/engine/katago/analyzeMcts.ts` | PUCT/MCTS search, expansion, rollout evaluation, PVs, and ownership aggregation. |
| `src/engine/katago/evalV8.ts` | Post-processing of network value and score outputs. |
| `src/engine/katago/positionInputsV7.ts` | Board position to v7 input planes, including ko, ladder, and area features. |
| `src/engine/katago/backendFallback.ts` | TensorFlow.js backend preference and fallback helpers. |

## Model Loading

The app ships three locally-hosted model tiers under `public/models/`:

| Tier | File | Size | 思考时间滑块 |
| --- | --- | --- | --- |
| B6 | `models/katago-small.bin.gz` | ~6M | 1–10 秒 |
| B10 (default) | `models/katago-b10.bin.gz` | ~10M | 1–20 秒 |
| B18 | `models/katago-b18.bin.gz` | ~96M | 1–60 秒 |

每个档位有自己独立的思考时间滑块范围（整数秒），切换模型时思考时间会
重置为该档位默认中间值（B6 5 秒 / B10 10 秒 / B18 30 秒）；滑块直接贴在
模型三个按钮下方，颜色跟随当前木色主题。模型按钮默认只显示档位名，只有
选中档位才额外显示当前思考秒数（如 B10 10s），拖动滑块会实时刷新选中按钮
上的秒数，不再显示 M 数。
新对局开始时使用当前档位所选时间作为 AI 每步思考上限。下载进度条使用
真实字节大小（压缩/解压后按实际收到的字节显示），不再写死 96M。
推荐落点/持续分析使用独立的连续搜索预算：从 32 次访问起步、逐轮增长到
16,384 次上限，单轮搜索最多 1 秒、同一局面累计最多 5 分钟，不随档位或
思考时间变化。推荐提示关闭且 AI 不在思考时，持续搜索会暂停以省电。

The default tier is B10. B6 and B10 are both warmed into the local IndexedDB
cache (`easy-go-model-cache`); when B10 is not in the cache yet the app starts
on B6 immediately (优先降档), downloads B10 in the background, and silently
swaps it in when ready. The worker also falls back to B6 when a B10 fetch
fails for any other reason. B18 is ~96 MB, so the new-game dialog asks for
confirmation, shows a streaming download progress bar, and caches the bytes in
IndexedDB; later visits rebuild a blob URL from the cache and never re-download
it unless the cache version changes. B18 is hosted as four ≤24 MiB chunks
(`katago-b18.bin.gz.001`–`.004`) — compatible with Cloudflare's 25 MiB per-file
limit — and the client fetches them in order, concatenates them, then
normalizes and MD5-checks the result.

Every cached or downloaded copy is verified against the tier's MD5 (of the
decompressed `.bin` bytes) before use. Static hosts often serve `.gz` files
with `Content-Encoding: gzip`, which the browser auto-decodes, so the app
normalizes the bytes after fetch and checks the decompressed hash. If the
bytes no longer match (corruption, a replaced model file that kept the same
version number), the stale cache entry is discarded and the model is re-fetched
automatically.

At runtime, the worker:

1. Normalizes the requested backend.
2. Reads the model bytes from the IndexedDB cache and verifies their MD5 when present.
3. Otherwise fetches the model URL (or blob URL) and writes the bytes to the cache.
4. Decompresses gzip weights with `pako` when needed.
5. Parses the KataGo binary model.
6. Builds and warms the TensorFlow.js model.
7. Keeps the loaded model in memory until the model URL changes.

Supported model versions are 8 through 16. Models with unsupported meta encoder
versions or unsupported trunk block kinds fail fast with a visible engine error.

Uploaded models are accepted as `.bin`, `.gz`, or `.bin.gz` files and are capped
at 128 MB for browser practicality.

## Backends

The default backend preference is `webgpu`. If WebGPU is unavailable or warmup
fails, the worker can fall back to `wasm`, then `cpu`.

Threaded WASM depends on `SharedArrayBuffer`, which requires cross-origin
isolation headers:

```text
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

The app still runs without those headers; it just cannot use threaded WASM.

## Feature Extraction

The worker converts the current `BoardState` plus previous boards, recent moves,
komi, rules, and conservative-pass setting into KataGo v7-style tensors:

- Spatial input: 22 channels over the active board.
- Global input: 19 values.
- Recent history: up to the last five moves.
- Ko and previous-ko features.
- Liberty maps and ladder features.
- Area features for Chinese rules.

This work is optimized with reusable typed-array scratch buffers so repeated
analysis does not allocate heavily.

## MCTS Analysis

`MctsSearch` combines neural network policy/value outputs with PUCT-style tree
search. A normal analysis request can control:

- Visits and maximum time.
- Batch size.
- Maximum child moves.
- Top-K candidate count.
- Principal variation length.
- Region of interest.
- Root noise.
- Random symmetry sampling.
- Tree reuse.
- Ownership mode: `none`, `root`, or `tree`.

The returned payload includes root win rate, root score lead, score self-play,
score standard deviation, visits, policy, ownership, ownership standard
deviation, and candidate moves with visits, priors, point loss, win-rate loss,
score, PV, per-move PV visits, LCB, and optional move ownership.

Root values are stored from Black's perspective.

### What the search does, and where it comes from

The search follows KataGo's own behaviour rather than a generic PUCT loop. The
ported pieces, with the C++ they mirror:

- Node statistics are rebuilt from a node's children after every playout
  (`recomputeNodeStats`), so noise pruning and sibling downweighting apply at
  every node rather than only in the final report.
- Move ranking uses play selection values with LCB, not raw visit counts
  (`getPlaySelectionValues`, `getSelfUtilityLCBAndRadius`), and the principal
  variation follows the same values at every depth.
- Root symmetry pruning searches one copy of each symmetrically equivalent move
  and puts the copies back into the output with `isSymmetryOf`
  (`markDuplicateMoveLocs`).
- The root ending bonus and the four-passes pruning keep the endgame tidy
  (`getEndingWhiteScoreBonus`, `isAllowedRootMove`).
- Subtree value bias corrects a node's own evaluation using what the search has
  learned about positions with the same local pattern (`SubtreeValueBiasTable`).
- Uncertainty weighting gives a visit less weight when the network says its own
  judgement is still moving (`computeWeightFromNNOutput`). Only networks from
  model version 10 on predict this; older ones, including the bundled small
  network, weight every visit equally.

### Finished games

Two passes end the game. Under area scoring the result is then a matter of
counting, so the search scores such a node exactly instead of asking the network
about a filled board, which is off-distribution and unreliable. Territory rules
need the dead stones agreed first — what KataGo's encore is for — so under those
the network keeps judging the position as before.

## Analysis Modes

The store uses the engine in several ways:

- Interactive analysis: current-position search for the board UI.
- Continuous analysis: automatically refreshes as the current node changes.
- AI move selection: runs analysis and plays the search's top-ranked move.

The main-thread `analysisQueue` handles cancellation, staleness, priority, and
cache reuse before requests reach the worker.

The worker also answers `quickEval` requests: a single batched network forward
pass with no MCTS search, returning the raw win rate, score read and ownership
map. The store uses it for instant score judgment and for the self-play win
rate when hints are off; a newer quick eval makes an older one stale.

## AI Moves

AI moves (playing against the bot or self-play) always take the search's
top-ranked candidate: the move with the best play-selection value at the root,
same ranking the recommendation overlay draws. The earlier KaTrain-style
strategy system (`rank`, `scoreloss`, `pick`, `local`, ...) and its settings
were removed.

## Verifying Evaluation Accuracy

The engine is a from-scratch reimplementation, so "is it strong?" and "is it
telling the truth?" are separate questions. Two test files answer the second.

`test/engineGolden.test.ts` pins the raw network against KataGo itself. KataGo's
repository records the output of its own binary running
`g170-b6c96-s175395328-d26788732` -- the model this repo ships -- on a 5x5
position, in `cpp/tests/results/runNNOnTinyBoardTest.txt` (white to play,
Tromp-Taylor, komi 7.5, default symmetry 3). The test rebuilds that position,
runs it through the shipped parser, graph, input planes, and post-processing,
and compares win rate, score mean, score mean squared, lead, the full policy,
and the full ownership map. Everything matches to within a permille, so a
failure means one of those layers changed meaning.

`test/engineAccuracy.test.ts` checks properties that must hold regardless of
what the network says:

- **Colour-swap antisymmetry.** Swapping every stone, swapping who is to move,
  and negating komi produces a bit-identical input tensor, because the net only
  sees "me" and "them". Any asymmetry in the reported black-perspective numbers
  is a sign-convention bug. This is checked exactly, not approximately.
- **Komi direction and magnitude.** Raising komi must lower black's score lead
  and win rate, and a point of komi must be worth roughly a point of lead.
- **Ownership against score.** Under area scoring the ownership map sums to
  black's area minus white's, so the sum minus the reported score should recover
  komi. This ties the two heads together and catches a transposed board.
- **Rotation independence.** The net is only approximately equivariant, so this
  bounds the noise rather than asserting equality; a spread far beyond that
  bound means an indexing bug in the planes or the ownership readout.
- **Reproducibility.** The same position analysed twice must give the same
  territory estimate, or the ownership overlay flickers and a user cannot tell a
  real change from noise. See root symmetry handling below.
- **Frame consistency in search.** Per-move win rate and score lead must sit in
  the same black-perspective frame as the root, and `pointsLost` must be
  measured from the mover's point of view for both colours.

Both files skip themselves when `public/models/katago-small.bin.gz` is absent,
so `npm test` still works before `npm run fetch:model`.

### Root Symmetry

Leaf evaluations inside the search use randomized symmetries, which decorrelates
their errors and is what KataGo does. The root is different: it is evaluated
once and its numbers are what the user reads. Randomizing it there adds noise
without averaging anything away, so the root always uses a fixed symmetry, and
averages several of them when the backend is fast enough
(`rootSymmetrySamplesForBackend`). On the shipped 6x96 network a single view can
be off by as much as 0.25 of ownership on a point compared to another view of
the same position.
