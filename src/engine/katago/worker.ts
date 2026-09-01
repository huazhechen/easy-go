/// <reference lib="webworker" />

import * as tf from '@tensorflow/tfjs';

import type {
  KataGoAnalysisPayload,
  KataGoAnalyzeRequest,
  KataGoWorkerRequest,
  KataGoWorkerResponse,
} from './types';
import type { GameRules, KataGoBackendPreference } from '../../types';
import { publicUrl } from '../../utils/publicUrl';
import { getAnimationNow } from '../../utils/animationFrame';
import { parseKataGoModelV8 } from './loadModelV8';
import { KataGoModelV8Tf } from './modelV8';
import { ENGINE_MAX_TIME_MS, ENGINE_MAX_VISITS } from './limits';
import { MctsSearch, type OwnershipMode } from './analyzeMcts';
import { rootSymmetrySamplesForBackend } from './symmetry';
import { initBackend } from './backendInit';
import { createWarmedModel } from './modelWarmup';
import { fetchModelBytes } from './modelLoading';
import {
  getKataGoWarmupFallbackBackend,
  normalizeKataGoBackendPreference,
  shouldCacheKataGoFallbackForRequest,
} from './backendFallback';
import { BOARD_AREA, BOARD_SIZE, PASS_MOVE, setBoardSize } from './fastBoard';
import {
  KATAGO_MODEL_TIERS,
  KATAGO_SMALL_MODEL_PATH,
} from './modelDefaults';

let model: KataGoModelV8Tf | null = null;
let loadedModelName: string | undefined;
let loadedModelUrl: string | null = null;
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

let scratchBoardSize = BOARD_SIZE;
type ParsedKataGoModelV8 = ReturnType<typeof parseKataGoModelV8>;

interface SearchKey {
  positionId: string;
  positionKey: string | null;
  modelUrl: string;
  boardSize: number;
  interestMaskKey: string;
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
}

let search: MctsSearch | null = null;
let searchKey: SearchKey | null = null;
let latestAnalyzeId = 0;
let latestQuickEvalId = 0;

function makeSearchKey(args: {
  msg: KataGoAnalyzeRequest;
  boardSize: number;
  interestMaskKey: string;
  maxChildren: number;
  ownershipMode: OwnershipMode;
  wideRootNoise: number;
  rootPolicyTemperature: number;
  fillDameBeforePass: boolean;
  rootSymmetrySamples: number;
  rules: GameRules;
  nnRandomize: boolean;
  conservativePass: boolean;
}): SearchKey {
  return {
    positionId: args.msg.positionId!,
    positionKey: args.msg.positionKey ?? null,
    modelUrl: args.msg.modelUrl,
    boardSize: args.boardSize,
    interestMaskKey: args.interestMaskKey,
    maxChildren: args.maxChildren,
    ownershipMode: args.ownershipMode,
    komi: args.msg.komi,
    currentPlayer: args.msg.currentPlayer,
    wideRootNoise: args.wideRootNoise,
    rootPolicyTemperature: args.rootPolicyTemperature,
    fillDameBeforePass: args.fillDameBeforePass,
    rootSymmetrySamples: args.rootSymmetrySamples,
    rules: args.rules,
    nnRandomize: args.nnRandomize,
    conservativePass: args.conservativePass,
  };
}

function collectTransferables(analysis: {
  ownership?: unknown;
  ownershipStdev?: unknown;
  policy?: unknown;
  moves?: readonly { ownership?: unknown }[];
}): Transferable[] {
  const transfer: Transferable[] = [];
  const push = (value?: unknown) => {
    if (value && ArrayBuffer.isView(value)) transfer.push(value.buffer);
  };
  push(analysis.ownership);
  push(analysis.ownershipStdev);
  push(analysis.policy);
  for (const move of analysis.moves ?? []) push(move.ownership);
  return transfer;
}

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
  search = null;
  searchKey = null;
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

  if (msg.type === 'katago:quick_eval') {
    // One batched network forward pass, no MCTS search. A newer quick eval
    // makes an older one stale, so per-move evaluations never pile up.
    const isStale = () => latestQuickEvalId !== msg.id;
    const postCanceled = () =>
      post({
        type: 'katago:analyze_result',
        id: msg.id,
        ok: false,
        canceled: true,
        error: 'canceled',
      });
    if (isStale()) {
      postCanceled();
      return;
    }

    await ensureModel(msg.modelUrl, msg.backend);
    if (!model) throw new Error('Model not loaded');
    if (isStale()) {
      postCanceled();
      return;
    }

    ensureBoardSizeForWorker(msg.board.length);
    const boardSize = BOARD_SIZE;
    const rules: GameRules = msg.rules === 'chinese' ? 'chinese' : msg.rules === 'korean' ? 'korean' : 'japanese';
    const quick = await MctsSearch.create({
      model,
      board: msg.board,
      previousBoard: msg.previousBoard,
      previousPreviousBoard: msg.previousPreviousBoard,
      currentPlayer: msg.currentPlayer,
      moveHistory: msg.moveHistory,
      komi: msg.komi,
      rules,
      nnRandomize: false,
      conservativePass: true,
      maxChildren: boardSize * boardSize,
      ownershipMode: 'root',
      wideRootNoise: 0,
      rootPolicyTemperature: 1.0,
      fillDameBeforePass: true,
      rootSymmetrySamples: rootSymmetrySamplesForBackend(tf.getBackend()),
    });
    if (isStale()) {
      postCanceled();
      return;
    }

    const analysis = quick.getAnalysis({
      topK: 3,
      analysisPvLen: 4,
      includeMovesOwnership: false,
      cloneBuffers: true,
      ownershipRefreshIntervalMs: 0,
    });
    const payload: KataGoAnalysisPayload = {
      ...analysis,
      // No search ran, so the search-root stats are still the 50% placeholder;
      // surface the network's own read of the position instead.
      rootWinRate: analysis.rawWinRate ?? analysis.rootWinRate,
      rootScoreLead: analysis.rawScoreLead ?? analysis.rootScoreLead,
      rootVisits: 0,
      moves: [],
    };
    const transfer = collectTransferables(payload);
    post(
      {
        type: 'katago:analyze_result',
        id: msg.id,
        ok: true,
        backend: tf.getBackend(),
        modelName: loadedModelName,
        analysis: payload,
      },
      transfer
    );
    return;
  }

  if (msg.type === 'katago:analyze') {
    // A request is stale as soon as a newer one has been posted; the message
    // queue keeps the checks correct even while an older search is running.
    const isStale = () => latestAnalyzeId !== msg.id;
    const shouldAbort = () => isStale();
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
    const interestMaskKey = msg.allowedMoves ? msg.allowedMoves.join(',') : '';
    const interestMask = msg.allowedMoves
      ? new Uint8Array(BOARD_AREA).map((_, index) => (msg.allowedMoves![index] ? 1 : 0))
      : undefined;
    const topK = Math.max(1, Math.min(msg.topK ?? 10, 50));
    const includeMovesOwnership = msg.includeMovesOwnership === true;
    const ownershipMode: OwnershipMode = includeMovesOwnership ? 'tree' : (msg.ownershipMode ?? 'root');
    const analysisPvLen = Math.max(0, Math.min(msg.analysisPvLen ?? 15, 60));
    const wideRootNoise = Math.max(0, Math.min(msg.wideRootNoise ?? 0.04, 5));
    const rootPolicyTemperature = Math.max(0.01, Math.min(msg.rootPolicyTemperature ?? 1, 100));
    const fillDameBeforePass = msg.fillDameBeforePass !== false;
    const rules: GameRules = msg.rules === 'chinese' ? 'chinese' : msg.rules === 'korean' ? 'korean' : 'japanese';
    const nnRandomize = msg.nnRandomize !== false;
    const rootSymmetrySamples = rootSymmetrySamplesForBackend(tf.getBackend());
    const conservativePass = msg.conservativePass !== false;
    const reportEveryMsRaw = msg.reportDuringSearchEveryMs;
    const reportEveryMs =
      typeof reportEveryMsRaw === 'number' && Number.isFinite(reportEveryMsRaw)
        ? Math.max(0, reportEveryMsRaw)
        : 0;
    const shouldReport = reportEveryMs > 0;
    const cloneBuffers = msg.reuseTree === true || shouldReport;

    const canReuse =
      msg.reuseTree === true &&
      typeof msg.positionId === 'string' &&
      !!search &&
      !!searchKey &&
      searchKey.positionId === msg.positionId &&
      searchKey.positionKey === (msg.positionKey ?? null) &&
      searchKey.modelUrl === msg.modelUrl &&
      searchKey.boardSize === boardSize &&
      searchKey.interestMaskKey === interestMaskKey &&
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
      searchKey.conservativePass === conservativePass;

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
        searchKey.interestMaskKey === interestMaskKey &&
        searchKey.maxChildren === maxChildren &&
        searchKey.ownershipMode === ownershipMode &&
        searchKey.komi === msg.komi &&
        searchKey.wideRootNoise === wideRootNoise &&
        searchKey.rootPolicyTemperature === rootPolicyTemperature &&
        searchKey.fillDameBeforePass === fillDameBeforePass &&
        searchKey.rootSymmetrySamples === rootSymmetrySamples &&
        searchKey.rules === rules &&
        searchKey.nnRandomize === nnRandomize &&
        searchKey.conservativePass === conservativePass;

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
          });
          if (reRooted) {
            reusedSearch = true;
            searchKey = makeSearchKey({
              msg,
              boardSize,
              interestMaskKey,
              maxChildren,
              ownershipMode,
              wideRootNoise,
              rootPolicyTemperature,
              fillDameBeforePass,
              rootSymmetrySamples,
              rules,
              nnRandomize,
              conservativePass,
            });
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
        interestMask,
      });
      if (typeof msg.positionId === 'string') {
        searchKey = makeSearchKey({
          msg,
          boardSize,
          interestMaskKey,
          maxChildren,
          ownershipMode,
          wideRootNoise,
          rootPolicyTemperature,
          fillDameBeforePass,
          rootSymmetrySamples,
          rules,
          nnRandomize,
          conservativePass,
        });
      } else {
        searchKey = null;
      }
    }

    const postAnalysis = (analysis: ReturnType<MctsSearch['getAnalysis']>, type: 'katago:analyze_update' | 'katago:analyze_result') => {
      const transfer = collectTransferables(analysis);

      post(
        {
          type,
          id: msg.id,
          ok: true,
          backend: tf.getBackend(),
          modelName: loadedModelName,
          analysis,
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
    latestAnalyzeId = msg.id;
  } else if (msg.type === 'katago:quick_eval') {
    latestQuickEvalId = msg.id;
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
      if (msg.type === 'katago:analyze') {
        post({
          type: 'katago:analyze_result',
          id: msg.id,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
        return;
      }
      if (msg.type === 'katago:quick_eval') {
        post({
          type: 'katago:analyze_result',
          id: msg.id,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    });
};
