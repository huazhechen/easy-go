import { create } from 'zustand';
import type {
  AnalysisResult,
  BoardSize,
  GameNode,
  GameRules,
  GameSettings,
  GameState,
  Move,
  Player,
} from '../types';
import { DEFAULT_BOARD_SIZE } from '../types';
import { boardsEqual, checkCaptures, getLiberties, isValidMove } from '../utils/gameLogic';
import { playStoneSound, playCaptureSound, playPassSound, playNewGameSound } from '../utils/sound';
import { formatSgfDate } from '../utils/sgf';
import { getKataGoEngineClient } from '../engine/katago/client';
import type { KataGoAnalysisPayload } from '../engine/katago/types';
import { ENGINE_MAX_TIME_MS, ENGINE_MAX_VISITS } from '../engine/katago/limits';
import { createEmptyBoard, getMaxHandicap, normalizeBoardSize } from '../utils/boardSize';
import {
  ANALYSIS_QUEUE_PRIORITY,
  beginContinuousAnalysis,
  CONTINUOUS_INNER_MAX_TIME_MS,
  CONTINUOUS_MAX_VISITS,
  CONTINUOUS_POSITION_MAX_TIME_MS,
  CONTINUOUS_REPORT_DURING_SEARCH_MS,
  PROGRESS_APPLY_MIN_MS,
  REPORT_DURING_SEARCH_EVERY_MS,
  analysisCacheKey,
  continuousSearchMsByNodeId,
  getAiRequestEpoch,
  invalidateAiRequests,
  invalidateContinuousAnalysis,
  isAnalysisCanceled,
  isContinuousAnalysisCurrent,
  nextContinuousAnalysisVisits,
  sleep,
} from './analysis';
import {
  applyHandicapStones,
  createEmptyTerritory,
  createNode,
  createRootNodeId,
  getBoardSizeFromBoard,
  initialGameState,
  initialRoot,
  isPassMove,
  nodeAnalysisPositionKey,
  nodeAnalysisVisitCount,
  ownershipToTerritoryGrid,
  parentAnalysisPositionKey,
  syncRootSetupPropertiesFromBoard,
} from './gameTree';
import { initialSettings, resolveModelUrlForFetch, rulesToSgfRu, saveStoredSettings } from './settings';
import { analysisQueue } from '../utils/analysisQueue';
import { rememberActiveBranchPath, type ActiveBranchMap } from '../utils/branchNavigation';
import { komiWithHandicapBonus } from '../utils/handicap';
import { getAnimationNow } from '../utils/animationFrame';

interface GameStore extends GameState {
  // Tree State
  rootNode: GameNode;
  currentNode: GameNode;
  treeVersion: number;
  activeBranchChildIds: ActiveBranchMap;

  // Settings & Modes
  isAiPlaying: boolean;
  aiColor: Player | null;
  isAnalysisMode: boolean;
  isContinuousAnalysis: boolean;
  analysisData: AnalysisResult | null;
  settings: GameSettings;
  engineStatus: 'idle' | 'loading' | 'ready' | 'error';
  engineError: string | null;
  engineBackend: string | null;
  /** True while an AI move request is in flight, so the UI can say so. */
  isAiThinking: boolean;

  // Actions
  toggleAi: (color: Player) => void;
  setAiPlayer: (color: Player | null, enabled?: boolean) => void;
  toggleAnalysisMode: () => void;
  toggleContinuousAnalysis: (quiet?: boolean) => void;
  playMove: (x: number, y: number, isLoad?: boolean) => void;
  makeAiMove: (opts?: { force?: boolean }) => void;
  undoMove: () => void; // Go back
  navigateBack: () => void;
  jumpToNode: (node: GameNode) => void; // Navigate to arbitrary node
  passTurn: () => void;
  runAnalysis: (opts?: {
    force?: boolean;
    visits?: number;
    maxTimeMs?: number;
    batchSize?: number;
    maxChildren?: number;
    topK?: number;
    analysisPvLen?: number;
    wideRootNoise?: number;
    nnRandomize?: boolean;
    conservativePass?: boolean;
    reuseTree?: boolean;
    ownershipRefreshIntervalMs?: number;
    reportEveryMs?: number;
    /** Let an outer scheduler handle failures instead of resolving after reporting them. */
    propagateErrors?: boolean;
  }) => Promise<void>;
  updateSettings: (newSettings: Partial<GameSettings>) => void;
  startNewGame: (opts: { komi: number; rules: GameRules; boardSize: BoardSize; handicap: number }) => void;
}

const scheduleAiMove = (getStore: () => GameStore, delayMs: number): void => {
  const scheduledEpoch = getAiRequestEpoch();
  const scheduledNodeId = getStore().currentNode.id;
  setTimeout(() => {
    const latest = getStore();
    if (getAiRequestEpoch() !== scheduledEpoch || latest.currentNode.id !== scheduledNodeId) return;
    if (!latest.isAiThinking) void latest.makeAiMove();
  }, delayMs);
};

const clearAnalysisTree = (node: GameNode): void => {
  node.analysis = null;
  node.analysisVisitsRequested = 0;
  for (const child of node.children) clearAnalysisTree(child);
};

export const useGameStore = create<GameStore>((set, get) => ({
  // Flat properties (mirrored from currentNode.gameState for easy access)
  board: initialGameState.board,
  currentPlayer: initialGameState.currentPlayer,
  moveHistory: initialGameState.moveHistory,
  capturedBlack: initialGameState.capturedBlack,
  capturedWhite: initialGameState.capturedWhite,
  komi: initialGameState.komi,

  // Tree State
  rootNode: initialRoot,
  currentNode: initialRoot,
  treeVersion: 0,
  activeBranchChildIds: {},

  isAiPlaying: false,
  aiColor: null,
  isAnalysisMode: false,
  isContinuousAnalysis: false,
  analysisData: null,
  settings: initialSettings,
  engineStatus: 'idle',
  engineError: null,
  engineBackend: null,
  isAiThinking: false,

  toggleAi: (color) => {
    const s = get();
    const nextOn = !(s.isAiPlaying && s.aiColor === color);
    if (!nextOn) analysisQueue.cancelGroup('move-search');
    set({ isAiPlaying: nextOn, aiColor: nextOn ? color : null });
    const after = get();
    if (after.isAiPlaying && after.aiColor === after.currentPlayer) {
      setTimeout(() => after.makeAiMove(), 0);
    }
  },

  setAiPlayer: (color, enabled = false) => {
    if (!enabled) analysisQueue.cancelGroup('move-search');
    set({ aiColor: color, isAiPlaying: enabled });
  },

  toggleAnalysisMode: () =>
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
    }),

  toggleContinuousAnalysis: (quiet = false) => {
    void quiet;
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
  },

  runAnalysis: async (opts) => {
    const state = get();
    const desiredVisits = Math.max(16, Math.min(opts?.visits ?? state.settings.katagoVisits, ENGINE_MAX_VISITS));
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
      if (nodeAnalysisVisitCount(state.currentNode) >= desiredVisits && ownershipOk) {
        set({ analysisData: existing });
        return;
      }
    }

    const node = state.currentNode;
    const parentBoard = node.parent?.gameState.board;
    const grandparentBoard = node.parent?.parent?.gameState.board;
    const modelUrl = resolveModelUrlForFetch(state.settings.katagoModelUrl);
    const rules = state.settings.gameRules;
    const analysisPvLen = opts?.analysisPvLen ?? state.settings.katagoAnalysisPvLen;
    const wideRootNoise = opts?.wideRootNoise ?? state.settings.katagoWideRootNoise;
    const rootPolicyTemperature = state.settings.katagoRootPolicyTemperature;
    const fillDameBeforePass = state.settings.katagoFillDameBeforePass;
    const nnRandomize = opts?.nnRandomize ?? state.settings.katagoNnRandomize;
    const conservativePass = opts?.conservativePass ?? state.settings.katagoConservativePass;
    const visits = Math.max(16, Math.min(opts?.visits ?? state.settings.katagoVisits, ENGINE_MAX_VISITS));
    const maxTimeMs = Math.max(25, Math.min(opts?.maxTimeMs ?? state.settings.katagoMaxTimeMs, ENGINE_MAX_TIME_MS));
    const batchSize = Math.max(1, Math.min(opts?.batchSize ?? state.settings.katagoBatchSize, 64));
    const boardSize = getBoardSizeFromBoard(state.board);
    const maxChildren = Math.max(4, Math.min(opts?.maxChildren ?? state.settings.katagoMaxChildren, boardSize * boardSize));
    const topK = Math.max(1, Math.min(opts?.topK ?? state.settings.katagoTopK, 50));
    const reuseTree = opts?.reuseTree ?? state.settings.katagoReuseTree;
    const ownershipRefreshIntervalMs = opts?.ownershipRefreshIntervalMs;
    const reportEveryMsRaw = opts?.reportEveryMs;
    const reportEveryMs =
      typeof reportEveryMsRaw === 'number' && Number.isFinite(reportEveryMsRaw)
        ? Math.max(0, reportEveryMsRaw)
        : (state.isContinuousAnalysis ? CONTINUOUS_REPORT_DURING_SEARCH_MS : REPORT_DURING_SEARCH_EVERY_MS);
    const reportDuringSearchEveryMs = reportEveryMs > 0 ? reportEveryMs : undefined;
    const progressApplyMinMs = reportEveryMs > 0 ? Math.max(reportEveryMs, PROGRESS_APPLY_MIN_MS) : 0;
    const treeUpdateEveryMs = reportEveryMs > 0 ? reportEveryMs : 0;
    let lastProgressVisits = -1;
    let lastTreeUpdateAt = 0;
    let lastTerritoryUpdateAt = 0;

    const buildAnalysisResult = (
      analysis: KataGoAnalysisPayload,
      territory: number[][]
    ): AnalysisResult => ({
      rootWinRate: analysis.rootWinRate,
      rootScoreLead: analysis.rootScoreLead,
      rootScoreSelfplay: analysis.rootScoreSelfplay,
      rootScoreStdev: analysis.rootScoreStdev,
      rootVisits: analysis.rootVisits,
      rawWinRate: analysis.rawWinRate,
      rawScoreLead: analysis.rawScoreLead,
      rawScoreSelfplay: analysis.rawScoreSelfplay,
      rawScoreSelfplayStdev: analysis.rawScoreSelfplayStdev,
      rawNoResultProb: analysis.rawNoResultProb,
      rawStWrError: analysis.rawStWrError,
      rawStScoreError: analysis.rawStScoreError,
      rawVarTimeLeft: analysis.rawVarTimeLeft,
      moves: analysis.moves,
      territory,
      policy: analysis.policy,
      ownershipStdev: analysis.ownershipStdev,
      ownershipMode: state.settings.katagoOwnershipMode,
    });

    const applyAnalysis = (analysis: KataGoAnalysisPayload, isFinal: boolean, now = getAnimationNow()) => {
      const shouldUpdateTerritory =
        isFinal || (progressApplyMinMs > 0 && now - lastTerritoryUpdateAt >= progressApplyMinMs);
      if (shouldUpdateTerritory) lastTerritoryUpdateAt = now;
      const fallbackTerritory = node.analysis?.territory ?? createEmptyTerritory(boardSize);
      const analysisWithTerritory = buildAnalysisResult(
        analysis,
        shouldUpdateTerritory ? ownershipToTerritoryGrid(analysis.ownership, boardSize) : fallbackTerritory
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
        const next: Partial<GameStore> = {};
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
            analysisGroup: 'interactive',
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
  },

  updateSettings: (newSettings) =>
    set((state) => {
      const nextSettings: GameSettings = { ...state.settings, ...newSettings };
      saveStoredSettings(nextSettings);
      const engineKeys: Array<keyof GameSettings> = [
        'katagoModelUrl',
        'katagoBackend',
        'katagoVisits',
        'katagoMaxTimeMs',
        'katagoBatchSize',
        'katagoMaxChildren',
        'katagoTopK',
        'katagoOwnershipMode',
        'katagoWideRootNoise',
        'katagoRootPolicyTemperature',
        'katagoFillDameBeforePass',
        'katagoAnalysisPvLen',
        'katagoNnRandomize',
        'katagoConservativePass',
        'gameRules',
      ];

      const engineChanged = engineKeys.some((k) => newSettings[k] !== undefined && newSettings[k] !== state.settings[k]);
      if (!engineChanged) return { settings: nextSettings };

      invalidateContinuousAnalysis();
      continuousSearchMsByNodeId.clear();
      analysisQueue.cancelWhere(() => true, 'Analysis settings changed');
      analysisQueue.clearCache();
      clearAnalysisTree(state.rootNode);

      const rulesChanged = newSettings.gameRules !== undefined && newSettings.gameRules !== state.settings.gameRules;
      if (rulesChanged) {
        state.rootNode.properties = state.rootNode.properties ?? {};
        state.rootNode.properties['RU'] = [rulesToSgfRu(nextSettings.gameRules)];
      }

      return {
        settings: nextSettings,
        analysisData: null,
        engineStatus: 'idle',
        engineError: null,
        engineBackend: null,
        isContinuousAnalysis: false,
        treeVersion: rulesChanged ? state.treeVersion + 1 : state.treeVersion,
      };
    }),

  playMove: (x, y, isLoad = false) => {
    const state = get();
    if (!isLoad) invalidateAiRequests('Position changed by player move');

    // Replaying an undone move may select an already-created branch node.
    const existingChild = state.currentNode.children.find(
      (child) => child.move && child.move.x === x && child.move.y === y && child.move.player === state.currentPlayer
    );
    if (existingChild && !isLoad) {
      if (state.settings.soundEnabled) playStoneSound();
      get().jumpToNode(existingChild);
      const nextState = get();
      if (nextState.settings.soundEnabled) {
        const capturedCount =
          state.currentPlayer === 'white'
            ? nextState.capturedBlack - state.capturedBlack
            : nextState.capturedWhite - state.capturedWhite;
        if (capturedCount > 0) setTimeout(() => playCaptureSound(capturedCount), 100);
      }
      if (nextState.isAiPlaying && nextState.currentPlayer === nextState.aiColor) {
        scheduleAiMove(get, 500);
      }
      return;
    }

    // Validate against the same simple-ko/no-suicide rules used by the engine
    // presets exposed in the UI.
    if (!isValidMove(state.board, x, y, state.currentPlayer, state.currentNode.parent?.gameState.board)) return;

    const { captured, newBoard } = checkCaptures(state.board, x, y, state.currentPlayer);
    if (captured.length === 0) {
      const { liberties } = getLiberties(newBoard, x, y);
      if (liberties === 0) return;
    }
    // Simple ko: the replayed board must not repeat the position from one move ago.
    if (state.currentNode.parent && boardsEqual(newBoard, state.currentNode.parent.gameState.board)) return;

    if (!isLoad) {
      if (state.settings.soundEnabled) {
        playStoneSound();
        if (captured.length > 0) setTimeout(() => playCaptureSound(captured.length), 100);
      }
    }

    const newCapturedBlack = state.capturedBlack + (state.currentPlayer === 'white' ? captured.length : 0);
    const newCapturedWhite = state.capturedWhite + (state.currentPlayer === 'black' ? captured.length : 0);
    const nextPlayer: Player = state.currentPlayer === 'black' ? 'white' : 'black';
    const move: Move = { x, y, player: state.currentPlayer };
    const newGameState: GameState = {
      board: newBoard,
      currentPlayer: nextPlayer,
      moveHistory: [...state.moveHistory, move],
      capturedBlack: newCapturedBlack,
      capturedWhite: newCapturedWhite,
      komi: state.komi,
    };
    const newNode = createNode(state.currentNode, move, newGameState);
    state.currentNode.children.push(newNode);

    set({
      currentNode: newNode,
      board: newGameState.board,
      currentPlayer: newGameState.currentPlayer,
      moveHistory: newGameState.moveHistory,
      capturedBlack: newGameState.capturedBlack,
      capturedWhite: newGameState.capturedWhite,
      analysisData: null, // Clear old analysis
      activeBranchChildIds: rememberActiveBranchPath(state.activeBranchChildIds, newNode),
      treeVersion: state.treeVersion + 1,
    });

    if (!isLoad) {
      const newState = get();
      if (newState.isAiPlaying && newState.currentPlayer === newState.aiColor) {
        scheduleAiMove(get, 500);
      }
    }
  },

  makeAiMove: (opts) => {
    const force = opts?.force ?? false;
    const initial = get();
    if (!force && (!initial.isAiPlaying || !initial.aiColor || initial.currentPlayer !== initial.aiColor)) return;
    const nodeId = initial.currentNode.id;
    const playerAtStart = initial.currentPlayer;
    const epoch = getAiRequestEpoch();
    const thinkingMs = Math.max(25, Math.min(initial.settings.katagoMaxTimeMs, ENGINE_MAX_TIME_MS));
    set({ isAiThinking: true, isAnalysisMode: true });
    if (!initial.isContinuousAnalysis) get().toggleContinuousAnalysis(true);
    void (async () => {
      await sleep(thinkingMs);
      while (true) {
        const latest = get();
        if (getAiRequestEpoch() !== epoch || latest.currentNode.id !== nodeId || latest.currentPlayer !== playerAtStart) return;
        if (!force && (!latest.isAiPlaying || latest.aiColor !== playerAtStart)) return;
        if (latest.currentNode.analysis?.moves?.length) break;
        await sleep(25);
      }
      const latest = get();
      if (getAiRequestEpoch() !== epoch || latest.currentNode.id !== nodeId || latest.currentPlayer !== playerAtStart) return;
      if (!force && (!latest.isAiPlaying || latest.aiColor !== playerAtStart)) return;
      const best = latest.currentNode.analysis?.moves?.[0];
      if (!best) return;
      set({ isAiThinking: false });
      if (best.x < 0 || best.y < 0) latest.passTurn();
      else latest.playMove(best.x, best.y);
    })().catch(() => {
      if (getAiRequestEpoch() === epoch) set({ isAiThinking: false });
    });
  },

  undoMove: () => {
    // A take-back invalidates any in-flight engine result. Otherwise the old
    // request can either overwrite the new position or leave the game stuck
    // after its node-id guard rejects the result.
    invalidateAiRequests('Undo move');
    set({ isAiThinking: false });
    const before = get();
    if (!before.currentNode.parent) return;
    const lastMover = before.currentNode.move?.player ?? null;
    const undoTwice = !!before.isAiPlaying && !!before.aiColor && lastMover === before.aiColor && before.currentPlayer !== before.aiColor;
    before.navigateBack();
    if (undoTwice) get().navigateBack();
    const after = get();
    if (after.isAiPlaying && after.aiColor && after.currentPlayer === after.aiColor) {
      setTimeout(() => {
        const latest = get();
        if (latest.isAiPlaying && latest.aiColor && latest.currentPlayer === latest.aiColor && !latest.isAiThinking) {
          void latest.makeAiMove();
        }
      }, 0);
    }
  },

  navigateBack: () => {
    invalidateAiRequests('Position changed');
    set({ isAiThinking: false });
    return set((state) => {
      if (!state.currentNode.parent) return {};
      const prevNode = state.currentNode.parent;
      return {
        currentNode: prevNode,
        board: prevNode.gameState.board,
        currentPlayer: prevNode.gameState.currentPlayer,
        moveHistory: prevNode.gameState.moveHistory,
        capturedBlack: prevNode.gameState.capturedBlack,
        capturedWhite: prevNode.gameState.capturedWhite,
        analysisData: prevNode.analysis || null,
        // Preserve settings
        isAiPlaying: state.isAiPlaying,
        aiColor: state.aiColor,
      };
    });
  },

  jumpToNode: (node) => {
    invalidateAiRequests('Navigated to node');
    return set((state) => ({
      currentNode: node,
      board: node.gameState.board,
      currentPlayer: node.gameState.currentPlayer,
      moveHistory: node.gameState.moveHistory,
      capturedBlack: node.gameState.capturedBlack,
      capturedWhite: node.gameState.capturedWhite,
      analysisData: node.analysis || null,
      activeBranchChildIds: rememberActiveBranchPath(state.activeBranchChildIds, node),
    }));
  },

  startNewGame: ({ komi, rules, boardSize, handicap }) => {
    const state = get();
    invalidateAiRequests('Started new game');
    analysisQueue.cancelWhere(() => true, 'Started new game');
    analysisQueue.clearCache();
    if (state.settings.soundEnabled) playNewGameSound();
    const normalizedBoardSize = normalizeBoardSize(boardSize, state.settings.defaultBoardSize ?? DEFAULT_BOARD_SIZE);
    const maxHandicap = getMaxHandicap(normalizedBoardSize);
    const safeHandicap = Math.max(0, Math.min(Math.floor(handicap), maxHandicap));
    const nextSettings: GameSettings = {
      ...state.settings,
      gameRules: rules,
      defaultBoardSize: normalizedBoardSize,
      defaultHandicap: safeHandicap,
    };
    saveStoredSettings(nextSettings);

    const board = createEmptyBoard(normalizedBoardSize);
    if (safeHandicap > 0) applyHandicapStones(board, normalizedBoardSize, safeHandicap);

    const rootState: GameState = {
      board,
      currentPlayer: safeHandicap > 0 ? 'white' : 'black',
      moveHistory: [],
      capturedBlack: 0,
      capturedWhite: 0,
      komi,
    };
    const newRoot = createNode(null, null, rootState, createRootNodeId());
    newRoot.properties = { RU: [rulesToSgfRu(rules)], SZ: [String(normalizedBoardSize)], DT: [formatSgfDate()] };
    if (safeHandicap > 0) {
      newRoot.properties.HA = [String(safeHandicap)];
      newRoot.properties.PL = ['W'];
    }
    syncRootSetupPropertiesFromBoard(newRoot.properties, board, normalizedBoardSize, safeHandicap);

    set({
      settings: nextSettings,
      board: rootState.board,
      currentPlayer: rootState.currentPlayer,
      moveHistory: rootState.moveHistory,
      capturedBlack: rootState.capturedBlack,
      capturedWhite: rootState.capturedWhite,
      komi: rootState.komi,
      isAiPlaying: false,
      isAiThinking: false,
      aiColor: null,
      analysisData: null,
      engineStatus: state.engineStatus,
      engineError: state.engineError,

      rootNode: newRoot,
      currentNode: newRoot,
      activeBranchChildIds: {},
      treeVersion: state.treeVersion + 1,
    });
  },

  passTurn: () => {
    invalidateAiRequests('Position changed by pass');
    const state = get();
    if (state.settings.soundEnabled) playPassSound();
    const move: Move = { x: -1, y: -1, player: state.currentPlayer };

    // Re-passing may select an already-created pass branch.
    const existingChild = state.currentNode.children.find(
      (child) => child.move && child.move.x === -1 && child.move.y === -1 && child.move.player === state.currentPlayer
    );
    if (existingChild) {
      get().jumpToNode(existingChild);
      const after = get();
      const ended = isPassMove(after.currentNode.move) && isPassMove(after.currentNode.parent?.move);
      if (!ended && after.isAiPlaying && after.aiColor && after.currentPlayer === after.aiColor) {
        setTimeout(() => after.makeAiMove(), 500);
      }
      return;
    }

    const nextPlayer = state.currentPlayer === 'black' ? 'white' : 'black';
    const newGameState: GameState = {
      board: state.board, // No change
      currentPlayer: nextPlayer,
      moveHistory: [...state.moveHistory, move],
      capturedBlack: state.capturedBlack,
      capturedWhite: state.capturedWhite,
      komi: state.komi,
    };
    const newNode = createNode(state.currentNode, move, newGameState);
    state.currentNode.children.push(newNode);

    set({
      currentNode: newNode,
      currentPlayer: newGameState.currentPlayer,
      moveHistory: newGameState.moveHistory,
      analysisData: null,
      activeBranchChildIds: rememberActiveBranchPath(state.activeBranchChildIds, newNode),
      treeVersion: state.treeVersion + 1,
    });

    const after = get();
    const ended = isPassMove(after.currentNode.move) && isPassMove(after.currentNode.parent?.move);
    if (!ended && after.isAiPlaying && after.aiColor && after.currentPlayer === after.aiColor) {
      setTimeout(() => after.makeAiMove(), 500);
    }
  },
}));
