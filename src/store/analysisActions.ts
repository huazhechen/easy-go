import type { AnalysisResult, BoardState, GameNode, GameSettings, Move, Player } from '../types';
import { getKataGoEngineClient } from '../engine/katago/client';
import type { KataGoAnalysisPayload } from '../engine/katago/types';
import { analysisQueue } from '../utils/analysisQueue';
import { getAnimationNow } from '../utils/animationFrame';
import { komiWithHandicapBonus } from '../utils/handicap';
import {
  ANALYSIS_QUEUE_PRIORITY,
  analysisCacheKey,
  beginContinuousAnalysis,
  buildAnalysisResult,
  CONTINUOUS_INNER_MAX_TIME_MS,
  CONTINUOUS_MAX_VISITS,
  CONTINUOUS_POSITION_MAX_TIME_MS,
  continuousSearchMsByNodeId,
  invalidateContinuousAnalysis,
  isAnalysisCanceled,
  isContinuousAnalysisCurrent,
  nextContinuousAnalysisVisits,
  resolveAnalysisRequest,
  sleep,
  type AnalysisRequestOptions,
} from './analysis';
import {
  createEmptyTerritory,
  getBoardSizeFromBoard,
  nodeAnalysisPositionKey,
  nodeAnalysisVisitCount,
  ownershipToTerritoryGrid,
  parentAnalysisPositionKey,
} from './gameTree';
import { resolveModelUrlForFetch } from './settings';

export type EngineStatus = 'idle' | 'loading' | 'ready' | 'error';

/** The slice of the game store the analysis orchestrator reads and drives. */
export interface AnalysisStore {
  currentNode: GameNode;
  currentPlayer: Player;
  board: BoardState;
  moveHistory: Move[];
  rootNode: GameNode;
  komi: number;
  settings: GameSettings;
  isAnalysisMode: boolean;
  isContinuousAnalysis: boolean;
  analysisData: AnalysisResult | null;
  quickEvalData: { nodeId: string; result: AnalysisResult } | null;
  engineStatus: EngineStatus;
  engineError: string | null;
  engineBackend: string | null;
  treeVersion: number;
  runAnalysis: (opts?: AnalysisRequestOptions) => Promise<void>;
}

export type AnalysisSetter = (
  patch: Partial<AnalysisStore> | ((state: AnalysisStore) => Partial<AnalysisStore>)
) => void;
type AnalysisGetter = () => AnalysisStore;

export function toggleAnalysisMode(set: AnalysisSetter): void {
  set((state) => {
    const newMode = !state.isAnalysisMode;
    if (!newMode) analysisQueue.cancelGroup('move-search');
    return {
      isAnalysisMode: newMode,
      isContinuousAnalysis: newMode ? state.isContinuousAnalysis : false,
      analysisData: state.currentNode.analysis || null,
      engineStatus: newMode ? state.engineStatus : 'idle',
      engineError: newMode ? state.engineError : null,
    };
  });
}

export function toggleContinuousAnalysis(get: AnalysisGetter, set: AnalysisSetter): void {
  const next = !get().isContinuousAnalysis;
  set((state) => ({ isContinuousAnalysis: next, isAnalysisMode: next ? true : state.isAnalysisMode }));
  if (!next) {
    invalidateContinuousAnalysis();
    return;
  }

  const token = beginContinuousAnalysis();
  void (async () => {
    while (true) {
      const state = get();
      if (!isContinuousAnalysisCurrent(token)) return;
      if (!state.isContinuousAnalysis || !state.isAnalysisMode) return;

      const node = state.currentNode;
      const currentVisits = nodeAnalysisVisitCount(node);
      const elapsedMs = continuousSearchMsByNodeId.get(node.id) ?? 0;
      if (currentVisits >= CONTINUOUS_MAX_VISITS || elapsedMs >= CONTINUOUS_POSITION_MAX_TIME_MS) {
        await sleep(500);
        continue;
      }

      const nextVisits = nextContinuousAnalysisVisits(currentVisits);
      const startedAt = Date.now();
      try {
        await get().runAnalysis({
          force: true,
          visits: nextVisits,
          maxTimeMs: CONTINUOUS_INNER_MAX_TIME_MS,
          topK: 3,
          analysisPvLen: 4,
          wideRootNoise: 0,
          nnRandomize: false,
          reuseTree: true,
          reportEveryMs: 0,
          propagateErrors: true,
          ownershipRefreshIntervalMs: state.settings.katagoOwnershipMode === 'tree' ? 500 : undefined,
        });
      } catch (err) {
        if (!isAnalysisCanceled(err)) {
          const message = err instanceof Error ? err.message : String(err);
          set({ engineStatus: 'error', engineError: message });
          await sleep(1_000);
        }
      } finally {
        const spentMs = Math.min(CONTINUOUS_INNER_MAX_TIME_MS, Math.max(0, Date.now() - startedAt));
        continuousSearchMsByNodeId.set(node.id, elapsedMs + spentMs);
      }
    }
  })();
}

export async function runEngineAnalysis(
  get: AnalysisGetter,
  set: AnalysisSetter,
  opts?: AnalysisRequestOptions
): Promise<void> {
  const state = get();
  const boardSize = getBoardSizeFromBoard(state.board);
  const request = resolveAnalysisRequest(state.settings, boardSize, opts, state.isContinuousAnalysis);
  if (!opts?.force && state.currentNode.analysis) {
    const existing = state.currentNode.analysis;
    const existingOwnershipMode = existing.ownershipMode ?? 'root';
    const requiredOwnershipMode = state.settings.katagoOwnershipMode;
    const ownershipOk =
      requiredOwnershipMode === 'tree'
        ? existingOwnershipMode === 'tree'
        : requiredOwnershipMode === 'root'
          ? existingOwnershipMode === 'root' || existingOwnershipMode === 'tree'
          : true;
    if (nodeAnalysisVisitCount(state.currentNode) >= request.visits && ownershipOk) {
      set({ analysisData: existing });
      return;
    }
  }

  const node = state.currentNode;
  const parentBoard = node.parent?.gameState.board;
  const grandparentBoard = node.parent?.parent?.gameState.board;
  const modelUrl = resolveModelUrlForFetch(state.settings.katagoModelUrl);
  const rules = state.settings.gameRules;
  const {
    visits,
    maxTimeMs,
    batchSize,
    maxChildren,
    topK,
    analysisPvLen,
    wideRootNoise,
    rootPolicyTemperature,
    fillDameBeforePass,
    nnRandomize,
    conservativePass,
    reuseTree,
    ownershipRefreshIntervalMs,
    reportDuringSearchEveryMs,
    progressApplyMinMs,
    treeUpdateEveryMs,
  } = request;
  let lastProgressVisits = -1;
  let lastTreeUpdateAt = 0;
  let lastTerritoryUpdateAt = 0;

  const applyAnalysis = (analysis: KataGoAnalysisPayload, isFinal: boolean, now = getAnimationNow()) => {
    const shouldUpdateTerritory =
      isFinal || (progressApplyMinMs > 0 && now - lastTerritoryUpdateAt >= progressApplyMinMs);
    if (shouldUpdateTerritory) lastTerritoryUpdateAt = now;
    const fallbackTerritory = node.analysis?.territory ?? createEmptyTerritory(boardSize);
    const analysisWithTerritory = buildAnalysisResult(
      analysis,
      shouldUpdateTerritory ? ownershipToTerritoryGrid(analysis.ownership, boardSize) : fallbackTerritory,
      state.settings.katagoOwnershipMode
    );
    node.analysis = analysisWithTerritory;
    if (isFinal) node.analysisVisitsRequested = Math.max(node.analysisVisitsRequested ?? 0, visits);

    const latest = get();
    const isCurrent = latest.currentNode.id === node.id;
    const updateNow = getAnimationNow();
    const shouldBumpTree =
      isFinal || (isCurrent && treeUpdateEveryMs > 0 && updateNow - lastTreeUpdateAt >= treeUpdateEveryMs);
    if (shouldBumpTree) lastTreeUpdateAt = updateNow;
    if (!isCurrent && !isFinal && !shouldBumpTree) return;

    const engineInfo = isFinal ? getKataGoEngineClient().getEngineInfo() : null;
    set((s) => {
      const next: Partial<AnalysisStore> = {};
      if (isCurrent) next.analysisData = analysisWithTerritory;
      if (isFinal && engineInfo) {
        next.engineStatus = 'ready';
        next.engineError = null;
        next.engineBackend = engineInfo.backend;
      }
      if (shouldBumpTree) next.treeVersion = s.treeVersion + 1;
      return next;
    });
  };

  const onProgress = reportDuringSearchEveryMs
    ? (analysis: KataGoAnalysisPayload) => {
        const visitsCount = typeof analysis.rootVisits === 'number' ? analysis.rootVisits : 0;
        if (visitsCount <= lastProgressVisits) return;
        const now = getAnimationNow();
        lastProgressVisits = visitsCount;
        applyAnalysis(analysis, false, now);
      }
    : undefined;

  const interactiveCacheKey = analysisCacheKey(
    'interactive',
    node.id,
    nodeAnalysisPositionKey(node, rules),
    modelUrl,
    state.settings.katagoBackend,
    rules,
    topK,
    analysisPvLen,
    state.settings.katagoOwnershipMode,
    wideRootNoise,
    rootPolicyTemperature,
    fillDameBeforePass,
    nnRandomize,
    conservativePass,
    visits,
    maxTimeMs,
    batchSize,
    maxChildren,
    reuseTree,
    ownershipRefreshIntervalMs,
  );
  // "Loading" is about the model, not about a request being in flight.
  // Flagging it on every live-analysis pass left the pill reading
  // "Loading model" — and the notes panel "Loading engine..." — for the
  // whole session while results were already on the board. A reported
  // backend means the net is resident, so only a cold or failed engine
  // goes back to loading.
  const engineClient = getKataGoEngineClient();
  const needsEngineLoad = state.engineStatus !== 'ready' || !state.engineBackend;
  if (needsEngineLoad) set({ engineStatus: 'loading', engineError: null });
  await engineClient.init(modelUrl, state.settings.katagoBackend);
  const initializedInfo = engineClient.getEngineInfo();
  set({ engineStatus: 'ready', engineBackend: initializedInfo.backend });

  set((s) =>
    s.engineBackend && s.engineStatus !== 'error'
      ? { engineError: null }
      : { engineStatus: 'loading', engineError: null }
  );

  return analysisQueue
    .enqueue<KataGoAnalysisPayload>({
      id: `interactive:${node.id}`,
      label: 'Live analysis',
      group: 'interactive',
      priority: ANALYSIS_QUEUE_PRIORITY.interactive,
      staleKey: 'interactive-analysis',
      cacheKey: interactiveCacheKey,
      bypassCache: opts?.force === true,
      preempt: true,
      run: (ctx) =>
        getKataGoEngineClient().analyze({
          positionId: node.id,
          parentPositionId: node.parent?.id,
          positionKey: nodeAnalysisPositionKey(node, rules),
          parentPositionKey: parentAnalysisPositionKey(node, rules),
          modelUrl,
          backend: state.settings.katagoBackend,
          board: state.board,
          previousBoard: parentBoard,
          previousPreviousBoard: grandparentBoard,
          currentPlayer: state.currentPlayer,
          moveHistory: state.moveHistory,
          komi: komiWithHandicapBonus(state.rootNode.gameState.board, rules, state.komi),
          rules,
          topK,
          includeMovesOwnership: state.settings.katagoOwnershipMode === 'tree',
          analysisPvLen,
          wideRootNoise,
          rootPolicyTemperature,
          fillDameBeforePass,
          nnRandomize,
          conservativePass,
          visits,
          maxTimeMs,
          batchSize,
          maxChildren,
          reportDuringSearchEveryMs,
          ownershipRefreshIntervalMs,
          reuseTree,
          ownershipMode: state.settings.katagoOwnershipMode,
          onProgress: onProgress
            ? (analysis) => {
                if (ctx.signal.aborted || ctx.isStale()) return;
                onProgress(analysis);
              }
            : undefined,
        }),
    })
    .then((analysis) => {
      applyAnalysis(analysis, true);
    })
    .catch((err: unknown) => {
      if (isAnalysisCanceled(err)) return;
      const msg = err instanceof Error ? err.message : String(err);
      set({
        engineStatus: 'error',
        engineError: msg,
      });
      if (opts?.propagateErrors) throw err;
    });
}

export async function runEngineQuickEval(get: AnalysisGetter, set: AnalysisSetter): Promise<AnalysisResult | null> {
  const state = get();
  const node = state.currentNode;
  const boardSize = getBoardSizeFromBoard(state.board);
  const modelUrl = resolveModelUrlForFetch(state.settings.katagoModelUrl);
  const parentBoard = node.parent?.gameState.board;
  const grandparentBoard = node.parent?.parent?.gameState.board;
  if (!getKataGoEngineClient().getEngineInfo().backend) {
    set({ engineStatus: 'loading', engineError: null });
  }
  try {
    const payload = await getKataGoEngineClient().quickEval({
      modelUrl,
      backend: state.settings.katagoBackend,
      board: state.board,
      previousBoard: parentBoard,
      previousPreviousBoard: grandparentBoard,
      currentPlayer: state.currentPlayer,
      moveHistory: state.moveHistory,
      komi: komiWithHandicapBonus(state.rootNode.gameState.board, state.settings.gameRules, state.komi),
      rules: state.settings.gameRules,
    });
    const latest = get();
    if (latest.currentNode.id !== node.id) return null;
    const result = buildAnalysisResult(payload, ownershipToTerritoryGrid(payload.ownership, boardSize), 'root');
    const engineInfo = getKataGoEngineClient().getEngineInfo();
    set({
      quickEvalData: { nodeId: node.id, result },
      engineStatus: engineInfo.backend ? 'ready' : latest.engineStatus,
      engineBackend: engineInfo.backend ?? latest.engineBackend,
      engineError: null,
    });
    return result;
  } catch (err) {
    if (isAnalysisCanceled(err)) return null;
    const msg = err instanceof Error ? err.message : String(err);
    set({ engineStatus: 'error', engineError: msg });
    return null;
  }
}
