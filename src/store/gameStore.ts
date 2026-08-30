import { createWithEqualityFn as create } from 'zustand/traditional';
import { DEFAULT_BOARD_SIZE, type GameRules, type GameState, type BoardState, type Player, type AnalysisResult, type GameNode, type Move, type GameSettings, type BoardSize, type KataGoBackendPreference } from '../types';
import { applyCapturesInPlace, boardsEqual, getLiberties, isValidMove } from '../utils/gameLogic';
import { playStoneSound, playCaptureSound, playPassSound, playNewGameSound } from '../utils/sound';
import { coordinateToSgf, formatSgfDate } from '../utils/sgf';
import { getKataGoEngineClient, isKataGoCanceledError } from '../engine/katago/client';
import type { KataGoAnalysisPayload } from '../engine/katago/types';
import { ENGINE_MAX_TIME_MS, ENGINE_MAX_VISITS } from '../engine/katago/limits';
import {
  defaultModelUrl,
  KATAGO_RECOMMENDED_MODEL_URL,
  KATAGO_SMALL_MODEL_PATH,
} from '../engine/katago/modelDefaults';
import { publicUrl } from '../utils/publicUrl';
import { getPreferredAppLocaleId, isAppLocaleId } from '../utils/locales';
import { createEmptyBoard, getHandicapPoints, getMaxHandicap, normalizeBoardSize } from '../utils/boardSize';
import { makeGameStateAnalysisPositionKey } from '../utils/analysisPositionKey';
import {
  analysisQueue,
  isAnalysisQueueCanceledError,
  isAnalysisQueueStaleError,
} from '../utils/analysisQueue';
import { rememberActiveBranchPath, type ActiveBranchMap } from '../utils/branchNavigation';
import { komiWithHandicapBonus } from '../utils/handicap';
import { readLocalStorage, writeLocalStorage } from '../utils/storage';
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
    /** Moves the search may not play at the root (KataGo avoidMoves). */
    avoidMoves?: Array<{ x: number; y: number }>;
  }) => Promise<void>;
  updateSettings: (newSettings: Partial<GameSettings>) => void;
  startNewGame: (opts: { komi: number; rules: GameRules; boardSize: BoardSize; handicap: number }) => void;
}

const createEmptyTerritory = (boardSize: number): number[][] =>
  Array.from({ length: boardSize }, () => Array.from({ length: boardSize }, () => 0));

const getBoardSizeFromBoard = (board: BoardState): BoardSize =>
  normalizeBoardSize(board.length, DEFAULT_BOARD_SIZE);

const applyHandicapStones = (board: BoardState, boardSize: BoardSize, handicap: number): void => {
  const points = getHandicapPoints(boardSize, handicap);
  for (const [x, y] of points) {
    if (x >= 0 && x < boardSize && y >= 0 && y < boardSize) {
      board[y]![x] = 'black';
    }
  }
};

const SETTINGS_STORAGE_KEY = 'easy-go:settings:v3';
const LEGACY_SETTINGS_STORAGE_KEYS = ['easy-go:settings:v2', 'easy-go:settings:v1'] as const;
const OLD_DEFAULT_KATAGO_VISITS = 500;
export const DEFAULT_KATAGO_VISITS = 5000;

const normalizeModelUrl = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^(blob:|data:)/i.test(trimmed)) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.startsWith('/')) {
    if (trimmed.startsWith('/models/')) return publicUrl(trimmed.slice(1));
    return trimmed;
  }
  if (trimmed.startsWith('models/')) return publicUrl(trimmed);
  return trimmed;
};

const normalizeKataGoBackend = (value: unknown): KataGoBackendPreference | null => {
  return value === 'wasm' || value === 'webgpu' || value === 'cpu' ? value : null;
};

const isLegacyDefaultModelUrl = (value: string): boolean => {
  const legacyPath = `/${KATAGO_SMALL_MODEL_PATH}`;
  return (
    value === KATAGO_RECOMMENDED_MODEL_URL ||
    value === publicUrl(KATAGO_SMALL_MODEL_PATH) ||
    value === KATAGO_SMALL_MODEL_PATH ||
    value === legacyPath ||
    value.endsWith(legacyPath)
  );
};

const resolveModelUrlForFetch = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  if (/^(blob:|data:|https?:|file:)/i.test(trimmed)) return trimmed;
  if (trimmed.startsWith('//')) return trimmed;
  if (typeof window === 'undefined') return trimmed;
  // Absolute paths (starting with /) resolve against the origin
  if (trimmed.startsWith('/')) {
    return new URL(trimmed, window.location.origin).toString();
  }
  // Relative paths resolve against the current page href
  return new URL(trimmed, window.location.href).toString();
};

const loadStoredSettings = (): Partial<GameSettings> | null => {
  try {
    const rawCurrent = readLocalStorage(SETTINGS_STORAGE_KEY);
    const legacyEntry = rawCurrent
      ? null
      : LEGACY_SETTINGS_STORAGE_KEYS.map((key) => ({ key, raw: readLocalStorage(key) })).find((entry) => entry.raw);
    const raw = rawCurrent ?? legacyEntry?.raw;
    if (!raw) return null;
    const isLegacySettings = legacyEntry != null;
    const isV1Settings = legacyEntry?.key === 'easy-go:settings:v1';
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    // An uploaded human net lives in a blob: URL that dies with the page, so a
    // stored one would only produce a failing fetch on the next load.
    if ('katagoModelUrl' in parsed) {
      const normalized = normalizeModelUrl((parsed as { katagoModelUrl?: unknown }).katagoModelUrl);
      if (normalized) {
        (parsed as { katagoModelUrl: string }).katagoModelUrl = isLegacySettings && isLegacyDefaultModelUrl(normalized)
          ? publicUrl(KATAGO_SMALL_MODEL_PATH)
          : normalized;
      } else {
        delete (parsed as { katagoModelUrl?: unknown }).katagoModelUrl;
      }
    }
    if ('katagoBackend' in parsed) {
      const backend = normalizeKataGoBackend((parsed as { katagoBackend?: unknown }).katagoBackend);
      if (backend) {
        (parsed as { katagoBackend: KataGoBackendPreference }).katagoBackend =
          isV1Settings && backend === 'wasm' ? 'webgpu' : backend;
      } else {
        delete (parsed as { katagoBackend?: unknown }).katagoBackend;
      }
    }
    if ((parsed as { katagoVisits?: unknown }).katagoVisits === OLD_DEFAULT_KATAGO_VISITS) {
      (parsed as { katagoVisits: number }).katagoVisits = DEFAULT_KATAGO_VISITS;
    }
    if ('appLocale' in parsed) {
      if (!isAppLocaleId((parsed as { appLocale?: unknown }).appLocale)) {
        delete (parsed as { appLocale?: unknown }).appLocale;
      }
    }
    if ('defaultBoardSize' in parsed) {
      const sizeRaw = (parsed as { defaultBoardSize?: unknown }).defaultBoardSize;
      const sizeNum = typeof sizeRaw === 'number' ? sizeRaw : Number.parseInt(String(sizeRaw ?? ''), 10);
      (parsed as { defaultBoardSize: BoardSize }).defaultBoardSize = normalizeBoardSize(sizeNum, DEFAULT_BOARD_SIZE);
    }
    if ('defaultHandicap' in parsed) {
      const size = (parsed as { defaultBoardSize?: BoardSize }).defaultBoardSize ?? DEFAULT_BOARD_SIZE;
      const max = getMaxHandicap(size);
      const raw = (parsed as { defaultHandicap?: unknown }).defaultHandicap;
      const num = typeof raw === 'number' ? raw : Number.parseInt(String(raw ?? ''), 10);
      (parsed as { defaultHandicap: number }).defaultHandicap = Number.isFinite(num)
        ? Math.max(0, Math.min(Math.floor(num), max))
        : 0;
    }
    return parsed as Partial<GameSettings>;
  } catch {
    return null;
  }
};

const saveStoredSettings = (settings: GameSettings): void => {
  writeLocalStorage(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
};

const rulesToSgfRu = (rules: GameRules): string => {
  switch (rules) {
    case 'japanese':
      return 'Japanese';
    case 'chinese':
      return 'Chinese';
    case 'korean':
      return 'Korean';
  }
};

const ownershipToTerritoryGrid = (ownership: ArrayLike<number>, boardSize: number): number[][] => {
  const territory: number[][] = Array(boardSize)
    .fill(0)
    .map(() => Array(boardSize).fill(0));
  for (let y = 0; y < boardSize; y++) {
    for (let x = 0; x < boardSize; x++) {
      const v = ownership[y * boardSize + x];
      territory[y][x] = typeof v === 'number' ? v : 0;
    }
  }
  return territory;
};

const isPassMove = (m: Move | null | undefined): boolean => !!m && (m.x < 0 || m.y < 0);

const createNode = (
    parent: GameNode | null,
    move: Move | null,
    gameState: GameState,
    idOverride?: string
): GameNode => {
    return {
        id: idOverride || Math.random().toString(36).substr(2, 9),
        parent,
        children: [],
        move,
        gameState,
        analysis: null,
        analysisVisitsRequested: 0,
        properties: {}
    };
};

const createRootNodeId = (): string => `root-${Math.random().toString(36).slice(2, 11)}`;

const nodeAnalysisPositionKey = (node: GameNode, rules: GameRules): string =>
  makeGameStateAnalysisPositionKey(node.gameState, rules);

const parentAnalysisPositionKey = (node: GameNode, rules: GameRules): string | undefined =>
  node.parent ? nodeAnalysisPositionKey(node.parent, rules) : undefined;

const nodeAnalysisVisitCount = (node: GameNode): number => {
  const rootVisits = node.analysis?.rootVisits;
  if (typeof rootVisits === 'number' && Number.isFinite(rootVisits)) return Math.max(0, Math.floor(rootVisits));
  const requested = node.analysisVisitsRequested ?? 0;
  return Number.isFinite(requested) ? Math.max(0, Math.floor(requested)) : 0;
};

const rootSetupPropertiesFromBoard = (
  board: BoardState,
  boardSize: BoardSize,
  handicap: number
): { AB?: string[]; AW?: string[] } => {
  const ab: string[] = [];
  const aw: string[] = [];
  const seenBlack = new Set<string>();
  const addBlack = (x: number, y: number) => {
    if (board[y]?.[x] !== 'black') return;
    const coord = coordinateToSgf(x, y);
    if (!seenBlack.has(coord)) {
      seenBlack.add(coord);
      ab.push(coord);
    }
  };

  for (const [x, y] of getHandicapPoints(boardSize, handicap)) addBlack(x, y);
  for (let y = 0; y < boardSize; y++) {
    for (let x = 0; x < boardSize; x++) {
      const stone = board[y]?.[x] ?? null;
      if (stone === 'black') addBlack(x, y);
      else if (stone === 'white') aw.push(coordinateToSgf(x, y));
    }
  }

  return {
    ...(ab.length > 0 ? { AB: ab } : {}),
    ...(aw.length > 0 ? { AW: aw } : {}),
  };
};

const syncRootSetupPropertiesFromBoard = (
  props: Record<string, string[]>,
  board: BoardState,
  boardSize: BoardSize,
  handicap: number
): void => {
  const setup = rootSetupPropertiesFromBoard(board, boardSize, handicap);
  delete props.AB;
  delete props.AW;
  delete props.AE;
  if (setup.AB) props.AB = setup.AB;
  if (setup.AW) props.AW = setup.AW;
};

// Initial state helpers
const initialBoard = createEmptyBoard(DEFAULT_BOARD_SIZE);
const initialGameState: GameState = {
    board: initialBoard,
    currentPlayer: 'black',
    moveHistory: [],
    capturedBlack: 0,
    capturedWhite: 0,
    komi: 6.5
};
const initialRoot = createNode(null, null, initialGameState, createRootNodeId());
initialRoot.properties = { RU: [rulesToSgfRu('japanese')] };

const defaultSettings: GameSettings = {
  appLocale: 'en',
  soundEnabled: true,
  defaultBoardSize: DEFAULT_BOARD_SIZE,
  defaultHandicap: 0,
  gameRules: 'japanese',
  analysisShowChildren: true,
  analysisShowEval: true,
  analysisShowHints: true,
  analysisShowPolicy: false,
  analysisShowOwnership: true,
  katagoModelUrl: defaultModelUrl(),
  katagoBackend: 'webgpu',
  katagoVisits: DEFAULT_KATAGO_VISITS,
  // Continuous recommendation search starts at 32 visits.
  // Matches the default B10 tier's per-move thinking time (see modelDefaults).
  katagoMaxTimeMs: 2000,
  katagoBatchSize: 16,
  katagoMaxChildren: DEFAULT_BOARD_SIZE * DEFAULT_BOARD_SIZE,
  katagoTopK: 10,
  katagoReuseTree: true,
  katagoOwnershipMode: 'root',
  katagoWideRootNoise: 0.04,
  katagoRootPolicyTemperature: 1.0,
  katagoFillDameBeforePass: true,
  katagoAnalysisPvLen: 15,
  katagoNnRandomize: true,
  katagoConservativePass: true,
};

const initialSettings: GameSettings = {
  ...defaultSettings,
  appLocale: getPreferredAppLocaleId(),
  ...(loadStoredSettings() ?? {}),
};

let continuousToken = 0;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const CONTINUOUS_INITIAL_VISITS = 32;
const CONTINUOUS_MAX_VISITS = 16_384;
const CONTINUOUS_INNER_MAX_TIME_MS = 1_000;
const CONTINUOUS_POSITION_MAX_TIME_MS = 5 * 60_000;
const continuousSearchMsByNodeId = new Map<string, number>();

export const nextContinuousAnalysisVisits = (currentVisits: number): number => {
  if (currentVisits < 1) return CONTINUOUS_INITIAL_VISITS;
  return Math.min(
    CONTINUOUS_MAX_VISITS,
    Math.max(currentVisits + 1, Math.ceil(currentVisits * 1.2 + 32))
  );
};
const ANALYSIS_QUEUE_PRIORITY = {
  interactive: 100,
  // Playing a move must win over background continuous recommendations.
  aiMove: 110,
} as const;
// KaTrain-style report cadence (seconds -> ms).
const REPORT_DURING_SEARCH_EVERY_MS = 1000;
const CONTINUOUS_REPORT_DURING_SEARCH_MS = 250;
// Throttle UI updates during progress reports to reduce main-thread churn.
const PROGRESS_APPLY_MIN_MS = 500;

const isAnalysisCanceled = (err: unknown): boolean =>
  isKataGoCanceledError(err) || isAnalysisQueueCanceledError(err) || isAnalysisQueueStaleError(err);

const analysisCacheKey = (...parts: unknown[]): string => JSON.stringify(parts);
// Invalidates asynchronous AI callbacks whenever the visible game position
// changes. Cancellation alone is not sufficient because an engine may resolve
// concurrently with the cancel request.
let aiRequestEpoch = 0;
const invalidateAiRequests = (reason: string): void => {
  aiRequestEpoch += 1;
  analysisQueue.cancelGroup('ai-move', reason);
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

  toggleAnalysisMode: () => set((state) => {
      const newMode = !state.isAnalysisMode;
      if (!newMode) {
          analysisQueue.cancelGroup('move-search');
      }
      return {
        isAnalysisMode: newMode,
        isContinuousAnalysis: newMode ? state.isContinuousAnalysis : false,
        analysisData: state.currentNode.analysis || null,
        engineStatus: newMode ? state.engineStatus : 'idle',
        engineError: newMode ? state.engineError : null,
        settings: newMode && !state.settings.analysisShowHints
          ? { ...state.settings, analysisShowHints: true }
          : state.settings,
      };
  }),

  toggleContinuousAnalysis: (quiet = false) => {
      void quiet;
      const next = !get().isContinuousAnalysis;
      set((state) => ({ isContinuousAnalysis: next, isAnalysisMode: next ? true : state.isAnalysisMode }));
      if (next) {
          // Live analysis should never run with a blank board, but an overlay
          // setup the user already chose is theirs to keep — only fill in top
          // move hints when nothing at all would be drawn.
          const s = get().settings;
          const anyOverlayVisible =
            s.analysisShowChildren ||
            s.analysisShowEval ||
            s.analysisShowHints ||
            s.analysisShowPolicy ||
            s.analysisShowOwnership;
          if (!anyOverlayVisible) get().updateSettings({ analysisShowHints: true });
      }
      if (!next) {
          continuousToken++;
          return;
      }

      const token = ++continuousToken;
      void (async () => {
          while (true) {
              const state = get();
              if (token !== continuousToken) return;
              if (!state.isContinuousAnalysis) return;
              if (!state.isAnalysisMode) return;

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

      // Check if current node already has analysis
      const desiredVisits = Math.max(16, Math.min(opts?.visits ?? state.settings.katagoVisits, ENGINE_MAX_VISITS));
      const avoidMoves = opts?.avoidMoves && opts.avoidMoves.length > 0 ? opts.avoidMoves : undefined;
      if (!opts?.force && !avoidMoves && state.currentNode.analysis) {
        const existing = state.currentNode.analysis;
        const existingOwnershipMode = existing.ownershipMode ?? 'root';
        const requiredOwnershipMode = state.settings.katagoOwnershipMode;
        const ownershipOk =
          requiredOwnershipMode === 'tree'
            ? existingOwnershipMode === 'tree'
            : requiredOwnershipMode === 'root'
              ? existingOwnershipMode === 'root' || existingOwnershipMode === 'tree'
              : true;
        const needsPolicy = state.settings.analysisShowPolicy;
        const policyOk = !needsPolicy || !!existing.policy;
        if (nodeAnalysisVisitCount(state.currentNode) >= desiredVisits && ownershipOk && policyOk) {
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
          let lastProgressVisits = -1;
          let lastTreeUpdateAt = 0;
          let lastTerritoryUpdateAt = 0;
          const treeUpdateEveryMs = reportEveryMs > 0 ? reportEveryMs : 0;

          const buildAnalysisResult = (
            analysis: KataGoAnalysisPayload,
            opts: { includeTerritory: boolean; fallbackTerritory: number[][] }
          ): AnalysisResult => {
            const analysisWithTerritory: AnalysisResult = {
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
              territory: opts.includeTerritory ? ownershipToTerritoryGrid(analysis.ownership, boardSize) : opts.fallbackTerritory,
              policy: analysis.policy,
              ownershipStdev: analysis.ownershipStdev,
              ownershipMode: state.settings.katagoOwnershipMode,
            };

            return analysisWithTerritory;
          };

          const applyAnalysis = (analysis: KataGoAnalysisPayload, isFinal: boolean, now = getAnimationNow()) => {
            const showOwnership = get().settings.analysisShowOwnership;
            const shouldUpdateTerritory =
              isFinal || (showOwnership && progressApplyMinMs > 0 && now - lastTerritoryUpdateAt >= progressApplyMinMs);
            if (shouldUpdateTerritory) lastTerritoryUpdateAt = now;
            const fallbackTerritory = node.analysis?.territory ?? createEmptyTerritory(boardSize);
            const analysisWithTerritory = buildAnalysisResult(analysis, {
              includeTerritory: shouldUpdateTerritory,
              fallbackTerritory,
            });
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
                const visits = typeof analysis.rootVisits === 'number' ? analysis.rootVisits : 0;
                if (visits <= lastProgressVisits) return;
                const now = getAnimationNow();
                lastProgressVisits = visits;
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
        avoidMoves ? avoidMoves.map((m) => `${m.x},${m.y}`).sort().join(' ') : ''
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

      set((s) => (s.engineBackend && s.engineStatus !== 'error'
        ? { engineError: null }
        : { engineStatus: 'loading', engineError: null }));

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
          run: (ctx) => getKataGoEngineClient().analyze({
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
            avoidMoves: avoidMoves?.map((m) => ({ x: m.x, y: m.y, player: state.currentPlayer })),
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

      continuousToken++;
      continuousSearchMsByNodeId.clear();
      analysisQueue.cancelWhere(() => true, 'Analysis settings changed');
      analysisQueue.clearCache();

      const clearAnalysis = (node: GameNode) => {
        node.analysis = null;
        node.analysisVisitsRequested = 0;
        for (const child of node.children) clearAnalysis(child);
      };
      clearAnalysis(state.rootNode);

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

  playMove: (x: number, y: number, isLoad = false) => {
    const state = get();
    if (!isLoad) invalidateAiRequests('Position changed by player move');

    // Check if we are loading or playing normally.
    // First, check if move exists in children (Navigation)
    const existingChild = state.currentNode.children.find(child =>
        child.move && child.move.x === x && child.move.y === y && child.move.player === state.currentPlayer
    );

    if (existingChild && !isLoad) {
       // Replaying an undone move may select an already-created branch node.
       // Treat it like a real play action: provide feedback and hand the turn
       // back to the AI when appropriate.
       if (state.settings.soundEnabled) playStoneSound();
       get().jumpToNode(existingChild);
       const nextState = get();
       if (nextState.settings.soundEnabled) {
         const capturedCount = state.currentPlayer === 'white'
           ? nextState.capturedBlack - state.capturedBlack
           : nextState.capturedWhite - state.capturedWhite;
         if (capturedCount > 0) setTimeout(() => playCaptureSound(capturedCount), 100);
       }
       if (nextState.isAiPlaying && nextState.currentPlayer === nextState.aiColor) {
         const scheduledEpoch = aiRequestEpoch;
         const scheduledNodeId = nextState.currentNode.id;
         setTimeout(() => {
           const latest = get();
           if (aiRequestEpoch !== scheduledEpoch || latest.currentNode.id !== scheduledNodeId) return;
           if (!latest.isAiThinking) void latest.makeAiMove();
         }, 500);
       }
       return;
    }

    // New Move Logic
    // Validate against the same simple-ko/no-suicide rules used by the engine presets exposed in the UI.
    if (!isValidMove(state.board, x, y, state.currentPlayer, state.currentNode.parent?.gameState.board)) return;

	    const tentativeBoard = state.board.map((row) => [...row]);
	    tentativeBoard[y][x] = state.currentPlayer;

	    const captured = applyCapturesInPlace(tentativeBoard, x, y, state.currentPlayer);
	    const newBoard = tentativeBoard;

	    // Suicide check
	    if (captured.length === 0) {
	      const { liberties } = getLiberties(newBoard, x, y);
      if (liberties === 0) return;
    }

    // Ko check
    // Simple Ko: Check just the state from 2 moves ago?
    // Let's traverse up one step (parent).
    if (state.currentNode.parent && boardsEqual(newBoard, state.currentNode.parent.gameState.board)) {
        // Found Ko, illegal move
        return;
    }

    if (!isLoad) {
      if (state.settings.soundEnabled) {
          playStoneSound();
          if (captured.length > 0) {
              setTimeout(() => playCaptureSound(captured.length), 100);
          }
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
        const scheduledEpoch = aiRequestEpoch;
        const scheduledNodeId = newState.currentNode.id;
        setTimeout(() => {
          const latest = get();
          if (aiRequestEpoch !== scheduledEpoch || latest.currentNode.id !== scheduledNodeId) return;
          if (!latest.isAiThinking) void latest.makeAiMove();
        }, 500);
      }
	    }
	  },

  makeAiMove: (opts) => {
    const force = opts?.force ?? false;
    const initial = get();
    if (!force && (!initial.isAiPlaying || !initial.aiColor || initial.currentPlayer !== initial.aiColor)) return;
    const nodeId = initial.currentNode.id;
    const playerAtStart = initial.currentPlayer;
    const epoch = aiRequestEpoch;
    const thinkingMs = Math.max(25, Math.min(initial.settings.katagoMaxTimeMs, ENGINE_MAX_TIME_MS));
    set({ isAiThinking: true, isAnalysisMode: true });
    if (!initial.isContinuousAnalysis) get().toggleContinuousAnalysis(true);
    void (async () => {
      await sleep(thinkingMs);
      while (true) {
        const latest = get();
        if (aiRequestEpoch !== epoch || latest.currentNode.id !== nodeId || latest.currentPlayer !== playerAtStart) return;
        if (!force && (!latest.isAiPlaying || latest.aiColor !== playerAtStart)) return;
        if (latest.currentNode.analysis?.moves?.length) break;
        await sleep(25);
      }
      const latest = get();
      if (aiRequestEpoch !== epoch || latest.currentNode.id !== nodeId || latest.currentPlayer !== playerAtStart) return;
      if (!force && (!latest.isAiPlaying || latest.aiColor !== playerAtStart)) return;
      const best = latest.currentNode.analysis?.moves?.[0];
      if (!best) return;
      set({ isAiThinking: false });
      if (best.x < 0 || best.y < 0) latest.passTurn(); else latest.playMove(best.x, best.y);
    })().catch(() => {
      if (aiRequestEpoch === epoch) set({ isAiThinking: false });
    });
  },

  undoMove: () => {
    // A take-back invalidates any in-flight engine result.  Otherwise the old
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
        aiColor: state.aiColor
    };
    });
  },

  jumpToNode: (node: GameNode) => {
    invalidateAiRequests('Navigated to node');
    return set((state) => {
      // Just set current node and sync state
      return {
          currentNode: node,
          board: node.gameState.board,
          currentPlayer: node.gameState.currentPlayer,
          moveHistory: node.gameState.moveHistory,
          capturedBlack: node.gameState.capturedBlack,
          capturedWhite: node.gameState.capturedWhite,
          analysisData: node.analysis || null,
          activeBranchChildIds: rememberActiveBranchPath(state.activeBranchChildIds, node),
      };
    });
  },

  startNewGame: ({ komi, rules, boardSize, handicap }) => {
    const state = get();
    invalidateAiRequests('Started new game');
    analysisQueue.cancelWhere(() => true, 'Started new game');
    analysisQueue.clearCache();
    if (state.settings.soundEnabled) {
      playNewGameSound();
    }
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
    if (safeHandicap > 0) {
      applyHandicapStones(board, normalizedBoardSize, safeHandicap);
    }

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
      if (state.settings.soundEnabled) {
        playPassSound();
      }
      const move: Move = { x: -1, y: -1, player: state.currentPlayer };

      // Check for existing pass child
      const existingChild = state.currentNode.children.find(child =>
        child.move && child.move.x === -1 && child.move.y === -1 && child.move.player === state.currentPlayer
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
        komi: state.komi
      };

      const newNode = createNode(state.currentNode, move, newGameState);
      state.currentNode.children.push(newNode);

      set({
          currentNode: newNode,
          currentPlayer: newGameState.currentPlayer,
          moveHistory: newGameState.moveHistory,
          // board doesn't change
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
