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
import { simulateMove } from '../utils/gameLogic';
import { playStoneSound, playCaptureSound, playPassSound, playNewGameSound } from '../utils/sound';
import { formatSgfDate } from '../utils/sgf';
import { createEmptyBoard, getMaxHandicap, normalizeBoardSize } from '../utils/boardSize';
import {
  continuousSearchMsByNodeId,
  invalidateAiRequests,
  invalidateContinuousAnalysis,
  type AnalysisRequestOptions,
} from './analysis';
import {
  applyHandicapStones,
  createNode,
  createRootNodeId,
  initialRoot,
  isPassMove,
  nodeToState,
  syncRootSetupPropertiesFromBoard,
} from './gameTree';
import { runAiMove, scheduleAiMove, setAiPlayerState, toggleAiPlayer } from './aiPlayer';
import { toggleAnalysisMode, toggleContinuousAnalysis, runEngineAnalysis, runEngineQuickEval } from './analysisActions';
import { initialSettings, rulesToSgfRu, saveStoredSettings } from './settings';
import { analysisQueue } from '../utils/analysisQueue';
import { rememberActiveBranchPath, type ActiveBranchMap } from '../utils/branchNavigation';
import { loadStoredGame, saveStoredGame } from './gamePersistence';

const CAPTURE_SOUND_DELAY_MS = 100;
const AI_MOVE_SCHEDULE_DELAY_MS = 500;

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
  /** Network-only read (no search) for the node it was computed on. */
  quickEvalData: { nodeId: string; result: AnalysisResult } | null;
  settings: GameSettings;
  engineStatus: 'idle' | 'loading' | 'ready' | 'error';
  engineError: string | null;
  engineBackend: string | null;
  /** True while an AI move request is in flight, so the UI can say so. */
  isAiThinking: boolean;
  /**
   * Node id whose recommendation search has settled (early-stopped). Null when
   * the current position is still being searched or no search is running.
   */
  recommendationSettledNodeId: string | null;
  /** True when the initial state was hydrated from a saved local game. */
  restoredFromStorage: boolean;

  // Actions
  toggleAi: (color: Player) => void;
  setAiPlayer: (color: Player | null, enabled?: boolean) => void;
  toggleAnalysisMode: () => void;
  toggleContinuousAnalysis: () => void;
  playMove: (x: number, y: number, isLoad?: boolean) => void;
  makeAiMove: (opts?: { force?: boolean }) => void;
  undoMove: () => void; // Go back
  navigateBack: () => void;
  jumpToNode: (node: GameNode) => void; // Navigate to arbitrary node
  passTurn: () => void;
  runAnalysis: (opts?: AnalysisRequestOptions) => Promise<void>;
  runQuickEval: () => Promise<AnalysisResult | null>;
  updateSettings: (newSettings: Partial<GameSettings>) => void;
  startNewGame: (opts: { komi: number; rules: GameRules; boardSize: BoardSize; handicap: number }) => void;
}

const clearAnalysisTree = (node: GameNode): void => {
  node.analysis = null;
  node.analysisVisitsRequested = 0;
  for (const child of node.children) clearAnalysisTree(child);
};

const restoredGame = loadStoredGame();
const restoredNode = restoredGame?.currentNode ?? initialRoot;

export const useGameStore = create<GameStore>((set, get) => ({
  // Flat properties (mirrored from currentNode.gameState for easy access)
  board: restoredNode.gameState.board,
  currentPlayer: restoredNode.gameState.currentPlayer,
  moveHistory: restoredNode.gameState.moveHistory,
  capturedBlack: restoredNode.gameState.capturedBlack,
  capturedWhite: restoredNode.gameState.capturedWhite,
  komi: restoredNode.gameState.komi,

  // Tree State
  rootNode: restoredGame?.rootNode ?? initialRoot,
  currentNode: restoredNode,
  treeVersion: 0,
  activeBranchChildIds: restoredGame?.activeBranchChildIds ?? {},

  isAiPlaying: restoredGame?.isAiPlaying ?? false,
  aiColor: restoredGame?.aiColor ?? null,
  isAnalysisMode: false,
  isContinuousAnalysis: false,
  analysisData: null,
  quickEvalData: null,
  settings: initialSettings,
  engineStatus: 'idle',
  engineError: null,
  engineBackend: null,
  isAiThinking: false,
  recommendationSettledNodeId: null,
  restoredFromStorage: restoredGame != null,

  toggleAi: (color) => toggleAiPlayer(get, set, color),

  setAiPlayer: (color, enabled = false) => setAiPlayerState(set, color, enabled),

  toggleAnalysisMode: () => toggleAnalysisMode(set),

  toggleContinuousAnalysis: () => toggleContinuousAnalysis(get, set),

  runAnalysis: (opts) => runEngineAnalysis(get, set, opts),

  runQuickEval: () => runEngineQuickEval(get, set),

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
        quickEvalData: null,
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
        if (capturedCount > 0) setTimeout(() => playCaptureSound(capturedCount), CAPTURE_SOUND_DELAY_MS);
      }
      if (nextState.isAiPlaying && nextState.currentPlayer === nextState.aiColor) {
        scheduleAiMove(get, AI_MOVE_SCHEDULE_DELAY_MS);
      }
      return;
    }

    // Validate and simulate in one pass under the same simple-ko/no-suicide
    // rules used by the engine presets exposed in the UI.
    const simulation = simulateMove(state.board, x, y, state.currentPlayer, state.currentNode.parent?.gameState.board);
    if (!simulation.legal) return;
    const { captured, newBoard } = simulation;

    if (!isLoad) {
      if (state.settings.soundEnabled) {
        playStoneSound();
        if (captured.length > 0) setTimeout(() => playCaptureSound(captured.length), CAPTURE_SOUND_DELAY_MS);
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
      ...nodeToState(newNode),
      activeBranchChildIds: rememberActiveBranchPath(state.activeBranchChildIds, newNode),
      treeVersion: state.treeVersion + 1,
    });

    if (!isLoad) {
      const newState = get();
      if (newState.isAiPlaying && newState.currentPlayer === newState.aiColor) {
        scheduleAiMove(get, AI_MOVE_SCHEDULE_DELAY_MS);
      }
    }
  },

  makeAiMove: (opts) => runAiMove(get, set, opts),

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
        ...nodeToState(prevNode),
        // Preserve settings
        isAiPlaying: state.isAiPlaying,
        aiColor: state.aiColor,
      };
    });
  },

  jumpToNode: (node) => {
    invalidateAiRequests('Navigated to node');
    return set((state) => ({
      ...nodeToState(node),
      activeBranchChildIds: rememberActiveBranchPath(state.activeBranchChildIds, node),
    }));
  },

  startNewGame: ({ komi, rules, boardSize, handicap }) => {
    const state = get();
    invalidateAiRequests('Started new game');
    analysisQueue.cancelWhere(() => true, 'Started new game');
    analysisQueue.clearCache();
    if (state.settings.soundEnabled) playNewGameSound();
    const normalizedBoardSize = normalizeBoardSize(boardSize, DEFAULT_BOARD_SIZE);
    const maxHandicap = getMaxHandicap(normalizedBoardSize);
    const safeHandicap = Math.max(0, Math.min(Math.floor(handicap), maxHandicap));
    const nextSettings: GameSettings = {
      ...state.settings,
      gameRules: rules,
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
      rootNode: newRoot,
      ...nodeToState(newRoot),
      komi: rootState.komi,
      isAiPlaying: false,
      isAiThinking: false,
      aiColor: null,
      quickEvalData: null,
      engineStatus: state.engineStatus,
      engineError: state.engineError,

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
        scheduleAiMove(get, AI_MOVE_SCHEDULE_DELAY_MS);
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
      ...nodeToState(newNode),
      activeBranchChildIds: rememberActiveBranchPath(state.activeBranchChildIds, newNode),
      treeVersion: state.treeVersion + 1,
    });

    const after = get();
    const ended = isPassMove(after.currentNode.move) && isPassMove(after.currentNode.parent?.move);
    if (!ended && after.isAiPlaying && after.aiColor && after.currentPlayer === after.aiColor) {
      scheduleAiMove(get, AI_MOVE_SCHEDULE_DELAY_MS);
    }
  },
}));

// Persist the game tree (and AI-player state) whenever the visible position
// changes: moves, passes, navigation, undo, new games, and AI toggles.
// Analysis-progress updates and settings changes don't touch those fields, so
// the shallow identity check keeps the subscription quiet during searches.
useGameStore.subscribe((state, prevState) => {
  if (
    state.rootNode === prevState.rootNode &&
    state.currentNode === prevState.currentNode &&
    state.activeBranchChildIds === prevState.activeBranchChildIds &&
    state.isAiPlaying === prevState.isAiPlaying &&
    state.aiColor === prevState.aiColor
  ) {
    return;
  }
  saveStoredGame({
    rootNode: state.rootNode,
    currentNode: state.currentNode,
    activeBranchChildIds: state.activeBranchChildIds,
    isAiPlaying: state.isAiPlaying,
    aiColor: state.aiColor,
  });
});
