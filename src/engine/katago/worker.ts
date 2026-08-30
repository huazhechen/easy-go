/// <reference lib="webworker" />

import * as tf from '@tensorflow/tfjs';
import '@tensorflow/tfjs-backend-webgpu';
import '@tensorflow/tfjs-backend-wasm';
import { setThreadsCount, setWasmPaths } from '@tensorflow/tfjs-backend-wasm';

import type { KataGoAnalyzeRequest, KataGoWorkerRequest, KataGoWorkerResponse } from './types';
import { looksLikeMarkup, modelResponseError } from './modelResponse';
import type { GameRules, KataGoBackendPreference, Player, RegionOfInterest } from '../../types';
import { publicUrl } from '../../utils/publicUrl';
import { getAnimationNow } from '../../utils/animationFrame';
import { parseKataGoModelV8 } from './loadModelV8';
import { KataGoModelV8Tf } from './modelV8';
import { ENGINE_MAX_TIME_MS, ENGINE_MAX_VISITS } from './limits';
import { MctsSearch, rootSymmetrySamplesForBackend, type OwnershipMode } from './analyzeMcts';
import { fillInputsV7FastForPosition } from './positionInputsV7';
import {
  getKataGoWarmupFallbackBackend,
  normalizeKataGoBackendPreference,
  shouldCacheKataGoFallbackForRequest,
} from './backendFallback';
import { BOARD_AREA, BOARD_SIZE, PASS_MOVE, setBoardSize } from './fastBoard';
import { postprocessKataGoV8 } from './evalV8';
import { humanSlMetadataRow } from './humanSlProfile';
import { md5Hex } from '../../utils/md5';
import {
  expectedModelMd5,
  KATAGO_MODEL_TIERS,
  KATAGO_SMALL_MODEL_PATH,
} from './modelDefaults';
import {
  modelCacheKeyForUrl,
  normalizeModelBytes,
  readValidatedCachedModel,
  writeCachedModel,
} from './modelCache';

let model: KataGoModelV8Tf | null = null;
let loadedModelName: string | undefined;
let loadedModelUrl: string | null = null;
let humanModel: KataGoModelV8Tf | null = null;
let loadedHumanModelUrl: string | null = null;
let backendPromise: Promise<void> | null = null;
let backendPreference: KataGoBackendPreference | null = null;
let prodModeEnabled = false;
let queue: Promise<void> = Promise.resolve();
let lastRequestedModelUrl: string | null = null;
let backgroundModelUpgrade: Promise<void> | null = null;

const B6_MODEL_URL = publicUrl(KATAGO_SMALL_MODEL_PATH);
const B10_TIER = KATAGO_MODEL_TIERS.find((tier) => tier.id === 'b10');
const B10_MODEL_URLS: string[] = B10_TIER
  ? [publicUrl(B10_TIER.localPath), ...(B10_TIER.remoteUrl ? [B10_TIER.remoteUrl] : [])]
  : [];
const isDefaultB10ModelUrl = (url: string): boolean => B10_MODEL_URLS.includes(url);

let V7_SPATIAL_STRIDE = BOARD_AREA * 22;
const V7_GLOBAL_STRIDE = 19;

let evalSpatialV7 = new Float32Array(V7_SPATIAL_STRIDE);
let evalGlobalV7 = new Float32Array(V7_GLOBAL_STRIDE);

let evalBatchCapacity = 0;
let evalBatchSpatialV7 = new Float32Array(0);
let evalBatchGlobalV7 = new Float32Array(0);
let scratchBoardSize = BOARD_SIZE;
type ParsedKataGoModelV8 = ReturnType<typeof parseKataGoModelV8>;

function regionKey(roi?: RegionOfInterest | null): string | null {
  if (!roi) return null;
  const xMin = Math.max(0, Math.min(BOARD_SIZE - 1, Math.min(roi.xMin, roi.xMax)));
  const xMax = Math.max(0, Math.min(BOARD_SIZE - 1, Math.max(roi.xMin, roi.xMax)));
  const yMin = Math.max(0, Math.min(BOARD_SIZE - 1, Math.min(roi.yMin, roi.yMax)));
  const yMax = Math.max(0, Math.min(BOARD_SIZE - 1, Math.max(roi.yMin, roi.yMax)));
  const isSinglePoint = xMin === xMax && yMin === yMax;
  const isWholeBoard = xMin === 0 && yMin === 0 && xMax === BOARD_SIZE - 1 && yMax === BOARD_SIZE - 1;
  if (isSinglePoint || isWholeBoard) return null;
  return `${xMin},${xMax},${yMin},${yMax}`;
}

function getEvalBatchBuffersV7(batch: number): { spatial: Float32Array; global: Float32Array } {
  if (batch > evalBatchCapacity) {
    evalBatchCapacity = batch;
    evalBatchSpatialV7 = new Float32Array(batch * V7_SPATIAL_STRIDE);
    evalBatchGlobalV7 = new Float32Array(batch * V7_GLOBAL_STRIDE);
  }
  return {
    spatial: evalBatchSpatialV7.subarray(0, batch * V7_SPATIAL_STRIDE),
    global: evalBatchGlobalV7.subarray(0, batch * V7_GLOBAL_STRIDE),
  };
}

let search: MctsSearch | null = null;
let searchKey: {
  positionId: string;
  positionKey: string | null;
  modelUrl: string;
  boardSize: number;
  maxChildren: number;
  ownershipMode: OwnershipMode;
  komi: number;
  currentPlayer: 'black' | 'white';
  wideRootNoise: number;
  rootPolicyTemperature: number;
  fillDameBeforePass: boolean;
  rootSymmetrySamples: number;
  rules: GameRules;
  nnRandomize: boolean;
  conservativePass: boolean;
  roiKey: string | null;
  humanKey: string | null;
  avoidKey: string | null;
} | null = null;
const latestAnalyzeByGroup = new Map<string, number>();
let interactiveToken = 0;
const analyzeMeta = new WeakMap<KataGoAnalyzeRequest, { analysisGroup: 'interactive' | 'background'; interactiveToken: number }>();

// TensorFlow promises resume as microtasks. An extended search that only awaits
// those promises can starve worker message events, preventing a newer position
// from updating the cancellation token until the old search reaches its full
// time limit.
const yieldToWorkerMessages = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0));

function ensureBoardSizeForWorker(boardSize: number): void {
  if (boardSize === scratchBoardSize) return;
  setBoardSize(boardSize);
  scratchBoardSize = BOARD_SIZE;
  V7_SPATIAL_STRIDE = BOARD_AREA * 22;
  evalSpatialV7 = new Float32Array(V7_SPATIAL_STRIDE);
  evalGlobalV7 = new Float32Array(V7_GLOBAL_STRIDE);
  evalBatchCapacity = 0;
  evalBatchSpatialV7 = new Float32Array(0);
  evalBatchGlobalV7 = new Float32Array(0);
  search = null;
  searchKey = null;
}

async function initWasmBackend(): Promise<void> {
  try {
    // Vite serves `public/` at the site root.
    setWasmPaths(publicUrl('tfjs/'));
    // Use a reasonable thread count for XNNPACK when cross-origin isolated (SharedArrayBuffer).
    // Without COOP/COEP headers, browsers disable threads and TFJS will fall back to single-threaded wasm.
    const isCrossOriginIsolated = (globalThis as unknown as { crossOriginIsolated?: boolean }).crossOriginIsolated === true;
    if (isCrossOriginIsolated) {
      const hc = (globalThis as unknown as { navigator?: { hardwareConcurrency?: number } }).navigator?.hardwareConcurrency ?? 1;
      const numThreads = Math.max(1, Math.min(8, Math.floor(hc)));
      setThreadsCount(numThreads);
    }
    await tf.setBackend('wasm');
    await tf.ready();
    return;
  } catch {
    // Fall through to CPU below.
  }

  await tf.setBackend('cpu');
  await tf.ready();
}

async function initBackend(preferredBackend: KataGoBackendPreference): Promise<void> {
  if (preferredBackend === 'cpu') {
    await tf.setBackend('cpu');
    await tf.ready();
    return;
  }

  if (preferredBackend === 'webgpu') {
    try {
      await tf.setBackend('webgpu');
      await tf.ready();
      return;
    } catch {
      // Fall back to WASM/CPU if WebGPU isn't available or fails to initialize.
    }
  }

  await initWasmBackend();
}

async function ensureBackend(backend?: KataGoBackendPreference): Promise<void> {
  const preferredBackend = normalizeKataGoBackendPreference(backend);
  if (backendPromise && backendPreference === preferredBackend) {
    await backendPromise;
    return;
  }

  model?.dispose();
  model = null;
  loadedModelName = undefined;
  loadedModelUrl = null;
  search = null;
  searchKey = null;

  backendPreference = preferredBackend;
  backendPromise = initBackend(preferredBackend)
      .then(() => {
        if (!prodModeEnabled) {
          tf.enableProdMode();
          prodModeEnabled = true;
        }
      })
      .catch((err) => {
        backendPromise = null;
        backendPreference = null;
        throw err;
      });
  await backendPromise;
}

async function warmupModel(candidate: KataGoModelV8Tf): Promise<void> {
  const spatial = tf.zeros([1, 19, 19, 22], 'float32') as tf.Tensor4D;
  const global = tf.zeros([1, 19], 'float32') as tf.Tensor2D;
  let out: ReturnType<KataGoModelV8Tf['forwardValueOnly']> | null = null;
  try {
    out = candidate.forwardValueOnly(spatial, global);
    const results = await Promise.allSettled([out.value.data(), out.scoreValue.data()]);
    for (const result of results) {
      if (result.status === 'rejected') throw result.reason;
    }
  } finally {
    spatial.dispose();
    global.dispose();
    out?.value.dispose();
    out?.scoreValue.dispose();
  }
}

async function createWarmedModel(parsed: ParsedKataGoModelV8): Promise<KataGoModelV8Tf> {
  const candidate = new KataGoModelV8Tf(parsed);
  try {
    await warmupModel(candidate);
    return candidate;
  } catch (err) {
    candidate.dispose();
    throw err;
  }
}

function installModel(nextModel: KataGoModelV8Tf, parsed: ParsedKataGoModelV8, modelUrl: string): void {
  model?.dispose();
  model = nextModel;
  loadedModelName = parsed.modelName;
  loadedModelUrl = modelUrl;
  search = null;
  searchKey = null;
}

async function switchToFallbackBackendForRequest(
  requestedBackend: KataGoBackendPreference,
  fallbackBackend: KataGoBackendPreference
): Promise<void> {
  backendPromise = null;
  backendPreference = null;
  await ensureBackend(fallbackBackend);
  if (shouldCacheKataGoFallbackForRequest({ requestedBackend, fallbackBackend: tf.getBackend() })) {
    backendPreference = requestedBackend;
  }
}

/**
 * Fetches the model bytes, preferring the IndexedDB cache so a model that was
 * already downloaded once is never fetched again unless the cache version
 * changes. blob: URLs (a cached b18 served through an object URL) are already
 * in-memory and are deliberately not written back to the cache.
 */
async function fetchModelBytes(modelUrl: string): Promise<Uint8Array> {
  const cacheKey = modelCacheKeyForUrl(modelUrl);
  const expectedMd5 = expectedModelMd5(modelUrl);
  const cached = await readValidatedCachedModel(cacheKey, expectedMd5);
  if (cached) {
    const bytes = new Uint8Array(cached);
    if (!looksLikeMarkup(bytes)) return bytes;
  }

  const res = await fetch(modelUrl);
  if (!res.ok) throw new Error(`Failed to fetch model: ${res.status} ${res.statusText}`);
  const data = normalizeModelBytes(new Uint8Array(await res.arrayBuffer()));
  if (looksLikeMarkup(data)) throw modelResponseError(modelUrl);
  if (expectedMd5) {
    if (md5Hex(data) !== expectedMd5.toLowerCase()) {
      throw new Error(`Model checksum mismatch for ${modelUrl}: expected MD5 ${expectedMd5}`);
    }
  }
  if (!modelUrl.startsWith('blob:')) {
    await writeCachedModel(cacheKey, data);
  }
  return data;
}

async function loadAndInstallModel(
  modelUrl: string,
  requestedBackend: KataGoBackendPreference
): Promise<void> {
  const data = await fetchModelBytes(modelUrl);
  const parsed = parseKataGoModelV8(data);
  const attemptedFallbacks = new Set<KataGoBackendPreference>();
  while (true) {
    try {
      installModel(await createWarmedModel(parsed), parsed, modelUrl);
      return;
    } catch (err) {
      const fallbackBackend = getKataGoWarmupFallbackBackend({
        requestedBackend,
        activeBackend: tf.getBackend(),
        stage: 'warmup',
      });
      if (!fallbackBackend || attemptedFallbacks.has(fallbackBackend)) {
        throw err;
      }

      attemptedFallbacks.add(fallbackBackend);
      await switchToFallbackBackendForRequest(requestedBackend, fallbackBackend);
    }
  }
}

/**
 * Fetches, parses and warms the default b10 model in the background without
 * blocking the request queue. Once ready it is installed between queue tasks,
 * silently replacing the b6 fallback the user has been playing on.
 */
function scheduleBackgroundModelUpgrade(): void {
  if (backgroundModelUpgrade || B10_MODEL_URLS.length === 0) return;
  backgroundModelUpgrade = (async () => {
    let targetUrl: string | null = null;
    let parsed: ParsedKataGoModelV8 | null = null;
    for (const url of B10_MODEL_URLS) {
      try {
        parsed = parseKataGoModelV8(await fetchModelBytes(url));
        targetUrl = url;
        break;
      } catch {
        // Try the next source (local file, then the remote mirror).
      }
    }
    if (!parsed || !targetUrl) return;

    let candidate: KataGoModelV8Tf | null = null;
    try {
      candidate = await createWarmedModel(parsed);
      const modelToInstall = candidate;
      const urlToInstall = targetUrl;
      queue = queue
        .then(() => {
          // Only replace when the user is still on b10 (they may have switched
          // to b6 or started downloading b18 while the upgrade was running).
          if (lastRequestedModelUrl !== null && isDefaultB10ModelUrl(lastRequestedModelUrl)) {
            installModel(modelToInstall, parsed!, urlToInstall);
          } else {
            modelToInstall.dispose();
          }
        })
        .catch(() => modelToInstall.dispose());
    } catch {
      candidate?.dispose();
    } finally {
      backgroundModelUpgrade = null;
    }
  })();
}

async function ensureModel(modelUrl: string, backend?: KataGoBackendPreference): Promise<void> {
  const requestedBackend = normalizeKataGoBackendPreference(backend);
  await ensureBackend(requestedBackend);
  if (
    model &&
    (loadedModelUrl === modelUrl ||
      // The local and remote b10 files are the same network, so once either is
      // installed a request for the other counts as satisfied.
      (isDefaultB10ModelUrl(modelUrl) && loadedModelUrl !== null && isDefaultB10ModelUrl(loadedModelUrl)))
  ) {
    return;
  }
  lastRequestedModelUrl = modelUrl;

  try {
    await loadAndInstallModel(modelUrl, requestedBackend);
  } catch (err) {
    if (!isDefaultB10ModelUrl(modelUrl)) throw err;
    // The local b10 is not available yet. Serve b6 immediately and fetch b10
    // in the background so the stronger default replaces it silently when ready.
    await loadAndInstallModel(B6_MODEL_URL, requestedBackend);
    scheduleBackgroundModelUpgrade();
  }
}

/**
 * Loads KataGo's human SL net, which is a second network used only to predict how a
 * human of a given rank would move. It is kept separate from the main model: the
 * analysis itself always comes from the strong net.
 */
async function ensureHumanModel(modelUrl: string): Promise<KataGoModelV8Tf> {
  if (humanModel && loadedHumanModelUrl === modelUrl) return humanModel;

  const res = await fetch(modelUrl);
  if (!res.ok) throw new Error(`Failed to fetch human model: ${res.status} ${res.statusText}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  if (looksLikeMarkup(buf)) throw modelResponseError(modelUrl);
  const parsed = parseKataGoModelV8(normalizeModelBytes(buf));
  if (parsed.metaEncoderVersion !== 1) {
    throw new Error('That model is not a human SL net (it has no metadata encoder)');
  }
  humanModel = new KataGoModelV8Tf(parsed);
  loadedHumanModelUrl = modelUrl;
  return humanModel;
}

/** Softmax over the board points of a logit array, ignoring the pass at the end. */
function softmaxOverBoard(logits: Float32Array): Float32Array {
  const out = new Float32Array(BOARD_AREA);
  let max = -Infinity;
  for (let p = 0; p < BOARD_AREA; p++) if (logits[p]! > max) max = logits[p]!;
  let sum = 0;
  for (let p = 0; p < BOARD_AREA; p++) {
    const v = Math.exp(logits[p]! - max);
    out[p] = v;
    sum += v;
  }
  if (sum > 0) for (let p = 0; p < BOARD_AREA; p++) out[p]! /= sum;
  return out;
}

/** Raw human-net policy logits for one position, including the pass at the end. */
async function computeHumanPolicyLogits(args: {
  modelUrl: string;
  profile: string;
  board: KataGoAnalyzeRequest['board'];
  previousBoard?: KataGoAnalyzeRequest['previousBoard'];
  previousPreviousBoard?: KataGoAnalyzeRequest['previousPreviousBoard'];
  currentPlayer: KataGoAnalyzeRequest['currentPlayer'];
  moveHistory: KataGoAnalyzeRequest['moveHistory'];
  komi: number;
  rules: GameRules;
  conservativePass: boolean;
}): Promise<Float32Array> {
  const net = await ensureHumanModel(args.modelUrl);
  const metaRow = humanSlMetadataRow({
    profile: args.profile,
    nextPlayer: args.currentPlayer,
    boardArea: BOARD_AREA,
  });
  if (!metaRow) throw new Error(`Unknown human profile "${args.profile}"`);

  fillInputsV7FastForPosition({
    board: args.board,
    previousBoard: args.previousBoard,
    previousPreviousBoard: args.previousPreviousBoard,
    currentPlayer: args.currentPlayer,
    moveHistory: args.moveHistory,
    komi: args.komi,
    rules: args.rules,
    conservativePassAndIsRoot: args.conservativePass,
    outSpatial: evalSpatialV7,
    outGlobal: evalGlobalV7,
  });

  const spatial = tf.tensor4d(evalSpatialV7, [1, BOARD_SIZE, BOARD_SIZE, 22]);
  const global = tf.tensor2d(evalGlobalV7, [1, 19]);
  const meta = tf.tensor2d(metaRow, [1, metaRow.length]);
  const out = net.forwardPolicyValue(spatial, global, meta);
  try {
    const [policyArr, passArr] = await Promise.all([out.policy.data(), out.policyPass.data()]);
    const channels = net.policyOutChannels;
    const logits = new Float32Array(BOARD_AREA + 1);
    for (let p = 0; p < BOARD_AREA; p++) logits[p] = (policyArr as Float32Array)[p * channels]!;
    logits[BOARD_AREA] = (passArr as Float32Array)[0]!;
    return logits;
  } finally {
    spatial.dispose();
    global.dispose();
    meta.dispose();
    out.policy.dispose();
    out.policyPass.dispose();
    out.value.dispose();
    out.scoreValue.dispose();
  }
}

/**
 * Turns raw human logits into a probability per legal move, using the search's own
 * policy array to say which moves are legal (illegal stays -1, as there).
 */
function humanPolicyFromLogits(logits: Float32Array, legality: ArrayLike<number>): Float32Array {
  const out = new Float32Array(BOARD_AREA + 1);
  let max = -Infinity;
  for (let p = 0; p <= BOARD_AREA; p++) {
    if (legality[p]! < 0) continue;
    if (logits[p]! > max) max = logits[p]!;
  }
  if (!Number.isFinite(max)) {
    out.fill(-1);
    return out;
  }
  let sum = 0;
  for (let p = 0; p <= BOARD_AREA; p++) {
    if (legality[p]! < 0) {
      out[p] = -1;
      continue;
    }
    const v = Math.exp(logits[p]! - max);
    out[p] = v;
    sum += v;
  }
  if (sum > 0) {
    for (let p = 0; p <= BOARD_AREA; p++) {
      if (out[p]! >= 0) out[p]! /= sum;
    }
  }
  return out;
}

function post(msg: KataGoWorkerResponse, transfer?: Transferable[]) {
  if (transfer && transfer.length > 0) self.postMessage(msg, transfer);
  else self.postMessage(msg);
}

async function handleMessage(msg: KataGoWorkerRequest): Promise<void> {
  if (msg.type === 'katago:init') {
    await ensureModel(msg.modelUrl, msg.backend);
    post({
      type: 'katago:init_result',
      ok: true,
      backend: tf.getBackend(),
      modelName: loadedModelName,
    });
    return;
  }

  if (msg.type === 'katago:eval') {
    await ensureModel(msg.modelUrl, msg.backend);
    if (!model) throw new Error('Model not loaded');
    ensureBoardSizeForWorker(msg.board.length);
    const boardSize = BOARD_SIZE;

    const conservativePass = msg.conservativePass !== false;
    const rules: GameRules = msg.rules === 'chinese' ? 'chinese' : msg.rules === 'korean' ? 'korean' : 'japanese';

    fillInputsV7FastForPosition({
      board: msg.board,
      previousBoard: msg.previousBoard,
      previousPreviousBoard: msg.previousPreviousBoard,
      currentPlayer: msg.currentPlayer,
      moveHistory: msg.moveHistory,
      komi: msg.komi,
      rules,
      conservativePassAndIsRoot: conservativePass,
      outSpatial: evalSpatialV7,
      outGlobal: evalGlobalV7,
    });

    const spatial = tf.tensor4d(evalSpatialV7, [1, boardSize, boardSize, 22]);
    const global = tf.tensor2d(evalGlobalV7, [1, 19]);
    const out = model.forwardValueOnly(spatial, global);
    const [valueLogitsArr, scoreValueArr] = await Promise.all([out.value.data(), out.scoreValue.data()]);
    spatial.dispose();
    global.dispose();
    out.value.dispose();
    out.scoreValue.dispose();

    const evaled = postprocessKataGoV8({
      nextPlayer: msg.currentPlayer,
      valueLogits: valueLogitsArr,
      scoreValue: scoreValueArr,
      postProcessParams: model.postProcessParams,
      modelVersion: model.modelVersion,
    });

    post({
      type: 'katago:eval_result',
      id: msg.id,
      ok: true,
      backend: tf.getBackend(),
      modelName: loadedModelName,
      eval: {
        rootWinRate: evaled.blackWinProb,
        rootScoreLead: evaled.blackScoreLead,
        rootScoreSelfplay: evaled.blackScoreMean,
        rootScoreStdev: evaled.blackScoreStdev,
      },
    });
    return;
  }

  if (msg.type === 'katago:eval_batch') {
    await ensureModel(msg.modelUrl, msg.backend);
    if (!model) throw new Error('Model not loaded');

    const conservativePass = msg.conservativePass !== false;
    const rules: GameRules = msg.rules === 'chinese' ? 'chinese' : msg.rules === 'korean' ? 'korean' : 'japanese';

    const batch = msg.positions.length;
    if (batch <= 0) {
      post({
        type: 'katago:eval_batch_result',
        id: msg.id,
        ok: true,
        backend: tf.getBackend(),
        modelName: loadedModelName,
        evals: [],
      });
      return;
    }

    const boardSize = msg.positions[0] ? msg.positions[0].board.length : BOARD_SIZE;
    ensureBoardSizeForWorker(boardSize);
    const size = BOARD_SIZE;

    const { spatial: spatialBatch, global: globalBatch } = getEvalBatchBuffersV7(batch);

    for (let i = 0; i < batch; i++) {
      const pos = msg.positions[i]!;
      fillInputsV7FastForPosition({
        board: pos.board,
        previousBoard: pos.previousBoard,
        previousPreviousBoard: pos.previousPreviousBoard,
        currentPlayer: pos.currentPlayer,
        moveHistory: pos.moveHistory,
        komi: pos.komi,
        rules,
        conservativePassAndIsRoot: conservativePass,
        outSpatial: spatialBatch.subarray(i * V7_SPATIAL_STRIDE, (i + 1) * V7_SPATIAL_STRIDE),
        outGlobal: globalBatch.subarray(i * V7_GLOBAL_STRIDE, (i + 1) * V7_GLOBAL_STRIDE),
      });
    }

    const spatial = tf.tensor4d(spatialBatch, [batch, size, size, 22]);
    const global = tf.tensor2d(globalBatch, [batch, 19]);
    const out = model.forwardValueOnly(spatial, global);
    const [valueLogitsArr, scoreValueArr] = await Promise.all([out.value.data(), out.scoreValue.data()]);
    spatial.dispose();
    global.dispose();
    out.value.dispose();
    out.scoreValue.dispose();

    const scoreChannels = model.scoreValueChannels;
    const evals = new Array(batch);
    for (let i = 0; i < batch; i++) {
      const evaled = postprocessKataGoV8({
        nextPlayer: msg.positions[i]!.currentPlayer,
        valueLogits: valueLogitsArr.subarray(i * 3, i * 3 + 3),
        scoreValue: scoreValueArr.subarray(i * scoreChannels, i * scoreChannels + scoreChannels),
        postProcessParams: model.postProcessParams,
        modelVersion: model.modelVersion,
      });
      evals[i] = {
        rootWinRate: evaled.blackWinProb,
        rootScoreLead: evaled.blackScoreLead,
        rootScoreSelfplay: evaled.blackScoreMean,
        rootScoreStdev: evaled.blackScoreStdev,
      };
    }

    post({
      type: 'katago:eval_batch_result',
      id: msg.id,
      ok: true,
      backend: tf.getBackend(),
      modelName: loadedModelName,
      evals,
    });
    return;
  }

  if (msg.type === 'katago:analyze') {
    const meta = analyzeMeta.get(msg);
    const analysisGroup = meta?.analysisGroup ?? msg.analysisGroup ?? 'background';
    const interactiveTokenAtEnqueue = meta?.interactiveToken ?? interactiveToken;
    const isStale = () => latestAnalyzeByGroup.get(analysisGroup) !== msg.id;
    const isPreemptedByInteractive =
      analysisGroup !== 'interactive' && interactiveToken !== interactiveTokenAtEnqueue;
    const shouldAbort = () => isStale() || isPreemptedByInteractive;
    const postCanceled = () =>
      post({
        type: 'katago:analyze_result',
        id: msg.id,
        ok: false,
        canceled: true,
        error: 'canceled',
      });

    if (shouldAbort()) {
      postCanceled();
      return;
    }

    await ensureModel(msg.modelUrl, msg.backend);
    if (!model) throw new Error('Model not loaded');
    if (shouldAbort()) {
      postCanceled();
      return;
    }

    ensureBoardSizeForWorker(msg.board.length);
    const boardSize = BOARD_SIZE;

    const maxVisits = Math.max(16, Math.min(msg.visits ?? 256, ENGINE_MAX_VISITS));
    const maxTimeMs = Math.max(25, Math.min(msg.maxTimeMs ?? 800, ENGINE_MAX_TIME_MS));
    const batchSize = Math.max(1, Math.min(msg.batchSize ?? (tf.getBackend() === 'webgpu' ? 16 : 4), 64));
    const maxChildren = Math.max(4, Math.min(msg.maxChildren ?? 64, BOARD_AREA));
    const topK = Math.max(1, Math.min(msg.topK ?? 10, 50));
    const includeMovesOwnership = msg.includeMovesOwnership === true;
    const requestedOwnershipMode: OwnershipMode = msg.ownershipMode ?? 'root';
    const ownershipMode: OwnershipMode = includeMovesOwnership ? 'tree' : requestedOwnershipMode;
    const analysisPvLen = Math.max(0, Math.min(msg.analysisPvLen ?? 15, 60));
    const wideRootNoise = Math.max(0, Math.min(msg.wideRootNoise ?? 0.04, 5));
    const rootPolicyTemperature = Math.max(0.01, Math.min(msg.rootPolicyTemperature ?? 1, 100));
    const fillDameBeforePass = msg.fillDameBeforePass !== false;
    const rules: GameRules = msg.rules === 'chinese' ? 'chinese' : msg.rules === 'korean' ? 'korean' : 'japanese';
    const nnRandomize = msg.nnRandomize !== false;
    const rootSymmetrySamples = rootSymmetrySamplesForBackend(tf.getBackend());
    const conservativePass = msg.conservativePass !== false;
    const roiKey = regionKey(msg.regionOfInterest);
    const reportEveryMsRaw = msg.reportDuringSearchEveryMs;
    const reportEveryMs =
      typeof reportEveryMsRaw === 'number' && Number.isFinite(reportEveryMsRaw)
        ? Math.max(0, reportEveryMsRaw)
        : 0;
    const shouldReport = reportEveryMs > 0;
    const cloneBuffers = msg.reuseTree === true || shouldReport;
    const humanSlRootExploreProb = Math.max(0, Math.min(1, msg.humanSlRootExploreProb ?? 0));
    const humanKey =
      msg.humanModelUrl && msg.humanSlProfile
        ? `${msg.humanSlProfile}@${msg.humanModelUrl}#${humanSlRootExploreProb}`
        : null;

    // KataGo avoidMoveUntilByLoc: how deep into the search each move stays off
    // limits for each player, which is how an analysis answers "and if that move
    // were not available?". An untilDepth of 1 bans it at the root alone.
    const avoidParts: string[] = [];
    let avoidMoveUntilBlack: Int32Array | null = null;
    let avoidMoveUntilWhite: Int32Array | null = null;
    const avoidArrayFor = (player: Player): Int32Array => {
      if (player === 'black') return (avoidMoveUntilBlack ??= new Int32Array(BOARD_AREA + 1));
      return (avoidMoveUntilWhite ??= new Int32Array(BOARD_AREA + 1));
    };
    const moveIndexOf = (move: { x: number; y: number }): number => {
      if (move.x < 0 || move.y < 0) return BOARD_AREA;
      if (move.x >= BOARD_SIZE || move.y >= BOARD_SIZE) return -1;
      return move.y * BOARD_SIZE + move.x;
    };
    for (const move of msg.avoidMoves ?? []) {
      const idx = moveIndexOf(move);
      if (idx < 0) continue;
      const untilDepth = Math.max(1, Math.min(Math.floor(move.untilDepth ?? 1), 1000));
      const player: Player = move.player ?? msg.currentPlayer;
      avoidArrayFor(player)[idx] = untilDepth;
      avoidParts.push(`a${player[0]}${idx}:${untilDepth}`);
    }
    // allowMoves is the complement: everything else is off limits for that player.
    for (const allow of msg.allowMoves ?? []) {
      const player: Player = allow.player ?? msg.currentPlayer;
      const untilDepth = Math.max(1, Math.min(Math.floor(allow.untilDepth ?? 1), 1000));
      const allowed = new Set<number>();
      for (const move of allow.moves) {
        const idx = moveIndexOf(move);
        if (idx >= 0) allowed.add(idx);
      }
      if (allowed.size === 0) continue;
      const array = avoidArrayFor(player);
      for (let p = 0; p <= BOARD_AREA; p++) {
        if (!allowed.has(p)) array[p] = untilDepth;
      }
      avoidParts.push(`l${player[0]}${[...allowed].sort((x, y) => x - y).join(',')}:${untilDepth}`);
    }
    const avoidKey = avoidParts.length > 0 ? avoidParts.sort().join(' ') : null;

    // The human policy is about the position, not the search, so it is computed up
    // front: its favourite moves are added to the root so the report says what they
    // are worth, and the same numbers are reported alongside the analysis.
    let humanLogits: Float32Array | null = null;
    let humanPolicyError: string | undefined;
    if (msg.humanModelUrl && msg.humanSlProfile) {
      try {
        humanLogits = await computeHumanPolicyLogits({
          modelUrl: msg.humanModelUrl,
          profile: msg.humanSlProfile,
          board: msg.board,
          previousBoard: msg.previousBoard,
          previousPreviousBoard: msg.previousPreviousBoard,
          currentPlayer: msg.currentPlayer,
          moveHistory: msg.moveHistory,
          komi: msg.komi,
          rules,
          conservativePass,
        });
      } catch (err) {
        // A missing or broken human net must not take the real analysis down with it.
        humanPolicyError = err instanceof Error ? err.message : String(err);
      }
    }
    const humanMovePriors = humanLogits ? softmaxOverBoard(humanLogits) : null;

    const canReuse =
      msg.reuseTree === true &&
      typeof msg.positionId === 'string' &&
      !!search &&
      !!searchKey &&
      searchKey.positionId === msg.positionId &&
      searchKey.positionKey === (msg.positionKey ?? null) &&
      searchKey.modelUrl === msg.modelUrl &&
      searchKey.boardSize === boardSize &&
      searchKey.maxChildren === maxChildren &&
      searchKey.ownershipMode === ownershipMode &&
      searchKey.komi === msg.komi &&
      searchKey.currentPlayer === msg.currentPlayer &&
      searchKey.wideRootNoise === wideRootNoise &&
      searchKey.rootPolicyTemperature === rootPolicyTemperature &&
      searchKey.fillDameBeforePass === fillDameBeforePass &&
      searchKey.rootSymmetrySamples === rootSymmetrySamples &&
      searchKey.rules === rules &&
      searchKey.nnRandomize === nnRandomize &&
      searchKey.conservativePass === conservativePass &&
      searchKey.roiKey === roiKey &&
      searchKey.humanKey === humanKey &&
      searchKey.avoidKey === avoidKey;

    let reusedSearch = canReuse;

    // Re-root the existing search when the new position is a direct child of the current root.
    if (
      !reusedSearch &&
      msg.reuseTree === true &&
      search &&
      searchKey &&
      typeof msg.positionId === 'string' &&
      typeof msg.parentPositionId === 'string'
    ) {
      const canReRoot =
        searchKey.positionId === msg.parentPositionId &&
        searchKey.positionKey === (msg.parentPositionKey ?? null) &&
        searchKey.modelUrl === msg.modelUrl &&
        searchKey.maxChildren === maxChildren &&
        searchKey.ownershipMode === ownershipMode &&
        searchKey.komi === msg.komi &&
        searchKey.wideRootNoise === wideRootNoise &&
        searchKey.rootPolicyTemperature === rootPolicyTemperature &&
        searchKey.fillDameBeforePass === fillDameBeforePass &&
        searchKey.rootSymmetrySamples === rootSymmetrySamples &&
        searchKey.rules === rules &&
        searchKey.nnRandomize === nnRandomize &&
        searchKey.conservativePass === conservativePass &&
        searchKey.roiKey === roiKey &&
        searchKey.humanKey === humanKey &&
        searchKey.avoidKey === avoidKey;

      if (canReRoot) {
        const lastMove = msg.moveHistory[msg.moveHistory.length - 1] ?? null;
        const move =
          lastMove && lastMove.x >= 0 && lastMove.y >= 0 ? lastMove.y * BOARD_SIZE + lastMove.x : PASS_MOVE;
        if (lastMove) {
          const reRooted = await search.reRootToChild({
            move,
            board: msg.board,
            previousBoard: msg.previousBoard,
            previousPreviousBoard: msg.previousPreviousBoard,
            currentPlayer: msg.currentPlayer,
            moveHistory: msg.moveHistory,
            komi: msg.komi,
            rules,
            regionOfInterest: msg.regionOfInterest,
          });
          if (reRooted) {
            reusedSearch = true;
            searchKey = {
              positionId: msg.positionId,
              positionKey: msg.positionKey ?? null,
              modelUrl: msg.modelUrl,
              boardSize,
              maxChildren,
              ownershipMode,
              komi: msg.komi,
              currentPlayer: msg.currentPlayer,
              wideRootNoise,
              rootPolicyTemperature,
              fillDameBeforePass,
              rootSymmetrySamples,
              rules,
              nnRandomize,
              conservativePass,
              roiKey,
              humanKey,
              avoidKey,
            };
          }
        }
      }
    }

    if (!reusedSearch) {
      search = await MctsSearch.create({
        model,
        board: msg.board,
        previousBoard: msg.previousBoard,
        previousPreviousBoard: msg.previousPreviousBoard,
        currentPlayer: msg.currentPlayer,
        moveHistory: msg.moveHistory,
        komi: msg.komi,
        rules,
        nnRandomize,
        conservativePass,
        maxChildren,
        ownershipMode,
        wideRootNoise,
        rootPolicyTemperature,
        fillDameBeforePass,
        rootSymmetrySamples,
        regionOfInterest: msg.regionOfInterest,
        humanPolicy: humanMovePriors,
        humanSlRootExploreProbWeightless: humanSlRootExploreProb,
        avoidMoveUntilBlack,
        avoidMoveUntilWhite,
      });
      if (typeof msg.positionId === 'string') {
        searchKey = {
          positionId: msg.positionId,
          positionKey: msg.positionKey ?? null,
          modelUrl: msg.modelUrl,
          boardSize,
          maxChildren,
          ownershipMode,
          komi: msg.komi,
          currentPlayer: msg.currentPlayer,
          wideRootNoise,
          rootPolicyTemperature,
          fillDameBeforePass,
          rootSymmetrySamples,
          rules,
          nnRandomize,
          conservativePass,
          roiKey,
          humanKey,
          avoidKey,
        };
      } else {
        searchKey = null;
      }
    }

    const postAnalysis = (analysis: ReturnType<MctsSearch['getAnalysis']>, type: 'katago:analyze_update' | 'katago:analyze_result') => {
      const transfer: Transferable[] = [];
      const push = (value?: unknown) => {
        if (value && ArrayBuffer.isView(value)) transfer.push(value.buffer);
      };
      if (humanLogits) {
        const humanPolicy = humanPolicyFromLogits(humanLogits, analysis.policy);
        analysis.humanPolicy = humanPolicy;
        for (const move of analysis.moves) {
          const pos = move.x < 0 || move.y < 0 ? BOARD_AREA : move.y * BOARD_SIZE + move.x;
          const prior = humanPolicy[pos] ?? -1;
          if (prior >= 0) move.humanPrior = prior;
        }
      }
      push(analysis.ownership);
      push(analysis.ownershipStdev);
      push(analysis.policy);
      push(analysis.humanPolicy);
      for (const move of analysis.moves) push(move.ownership);

      post(
        {
          type,
          id: msg.id,
          ok: true,
          backend: tf.getBackend(),
          modelName: loadedModelName,
          analysis,
          humanPolicyError,
        },
        transfer
      );
    };

    const buildAnalysis = () =>
      search!.getAnalysis({
        topK,
        includeMovesOwnership,
        analysisPvLen,
        cloneBuffers,
        ownershipRefreshIntervalMs: msg.ownershipRefreshIntervalMs,
      });

    if (!shouldReport) {
      const aborted = await search!.run({ visits: maxVisits, maxTimeMs, batchSize, shouldAbort });
      if (aborted || shouldAbort()) {
        postCanceled();
        if (msg.reuseTree !== true) {
          search = null;
          searchKey = null;
        }
        return;
      }
      postAnalysis(buildAnalysis(), 'katago:analyze_result');
      if (msg.reuseTree !== true) {
        search = null;
        searchKey = null;
      }
      return;
    }

    const deadline = getAnimationNow() + maxTimeMs;
    let lastReportVisits = -1;
    while (true) {
      if (shouldAbort()) {
        postCanceled();
        if (msg.reuseTree !== true) {
          search = null;
          searchKey = null;
        }
        return;
      }
      const now = getAnimationNow();
      const remaining = deadline - now;
      if (remaining <= 0) break;
      const sliceMs = Math.min(reportEveryMs, remaining);
      const aborted = await search!.run({ visits: maxVisits, maxTimeMs: sliceMs, batchSize, shouldAbort });
      // Give onmessage a task boundary so a newly queued position can mark this
      // search stale before it starts another reporting slice.
      await yieldToWorkerMessages();
      if (aborted || shouldAbort()) {
        postCanceled();
        if (msg.reuseTree !== true) {
          search = null;
          searchKey = null;
        }
        return;
      }
      const analysis = buildAnalysis();
      const done = analysis.rootVisits >= maxVisits || getAnimationNow() >= deadline;
      if (done) {
        postAnalysis(analysis, 'katago:analyze_result');
        if (msg.reuseTree !== true) {
          search = null;
          searchKey = null;
        }
        return;
      }
      if (analysis.rootVisits > lastReportVisits) {
        lastReportVisits = analysis.rootVisits;
        postAnalysis(analysis, 'katago:analyze_update');
      }
    }

    postAnalysis(buildAnalysis(), 'katago:analyze_result');
    if (msg.reuseTree !== true) {
      search = null;
      searchKey = null;
    }
  }
}

self.onmessage = (ev: MessageEvent<KataGoWorkerRequest>) => {
  const msg = ev.data;
  if (msg.type === 'katago:analyze') {
    const analysisGroup = msg.analysisGroup ?? 'background';
    latestAnalyzeByGroup.set(analysisGroup, msg.id);
    if (analysisGroup === 'interactive') interactiveToken++;
    analyzeMeta.set(msg, { analysisGroup, interactiveToken });
  }
  queue = queue
    .then(() => handleMessage(msg))
    .catch((err: unknown) => {
      if (msg.type === 'katago:init') {
        post({
          type: 'katago:init_result',
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
        return;
      }
      if (msg.type === 'katago:eval') {
        post({
          type: 'katago:eval_result',
          id: msg.id,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
        return;
      }
      if (msg.type === 'katago:eval_batch') {
        post({
          type: 'katago:eval_batch_result',
          id: msg.id,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
        return;
      }
      if (msg.type === 'katago:analyze') {
        post({
          type: 'katago:analyze_result',
          id: msg.id,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
        return;
      }
    });
};
