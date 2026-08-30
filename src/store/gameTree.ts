import type { AnalysisResult, BoardState, BoardSize, GameNode, GameRules, GameState, Move, Player } from '../types';
import { DEFAULT_BOARD_SIZE } from '../types';
import { createEmptyBoard, getHandicapPoints, normalizeBoardSize } from '../utils/boardSize';
import { coordinateToSgf } from '../utils/sgf';
import { makeGameStateAnalysisPositionKey } from '../utils/analysisPositionKey';
import { rulesToSgfRu } from './settings';

export const createEmptyTerritory = (boardSize: number): number[][] =>
  Array.from({ length: boardSize }, () => Array.from({ length: boardSize }, () => 0));

export const getBoardSizeFromBoard = (board: BoardState): BoardSize =>
  normalizeBoardSize(board.length, DEFAULT_BOARD_SIZE);

export const applyHandicapStones = (board: BoardState, boardSize: BoardSize, handicap: number): void => {
  for (const [x, y] of getHandicapPoints(boardSize, handicap)) {
    if (x >= 0 && x < boardSize && y >= 0 && y < boardSize) {
      board[y]![x] = 'black';
    }
  }
};

export const ownershipToTerritoryGrid = (ownership: ArrayLike<number>, boardSize: number): number[][] => {
  const territory = createEmptyTerritory(boardSize);
  for (let y = 0; y < boardSize; y++) {
    for (let x = 0; x < boardSize; x++) {
      const value = ownership[y * boardSize + x];
      territory[y]![x] = typeof value === 'number' ? value : 0;
    }
  }
  return territory;
};

export const isPassMove = (move: Move | null | undefined): boolean => !!move && (move.x < 0 || move.y < 0);

export interface NodeStateSlice {
  currentNode: GameNode;
  board: BoardState;
  currentPlayer: Player;
  moveHistory: Move[];
  capturedBlack: number;
  capturedWhite: number;
  analysisData: AnalysisResult | null;
}

/** The flat store fields mirrored from a game-tree node's GameState. */
export const nodeToState = (node: GameNode): NodeStateSlice => ({
  currentNode: node,
  board: node.gameState.board,
  currentPlayer: node.gameState.currentPlayer,
  moveHistory: node.gameState.moveHistory,
  capturedBlack: node.gameState.capturedBlack,
  capturedWhite: node.gameState.capturedWhite,
  analysisData: node.analysis || null,
});

export const createNode = (
  parent: GameNode | null,
  move: Move | null,
  gameState: GameState,
  idOverride?: string
): GameNode => {
  return {
    id: idOverride || Math.random().toString(36).substring(2, 9),
    parent,
    children: [],
    move,
    gameState,
    analysis: null,
    analysisVisitsRequested: 0,
    properties: {},
  };
};

export const createRootNodeId = (): string => `root-${Math.random().toString(36).slice(2, 11)}`;

export const nodeAnalysisPositionKey = (node: GameNode, rules: GameRules): string =>
  makeGameStateAnalysisPositionKey(node.gameState, rules);

export const parentAnalysisPositionKey = (node: GameNode, rules: GameRules): string | undefined =>
  node.parent ? nodeAnalysisPositionKey(node.parent, rules) : undefined;

export const nodeAnalysisVisitCount = (node: GameNode): number => {
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

export const syncRootSetupPropertiesFromBoard = (
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

export const initialBoard = createEmptyBoard(DEFAULT_BOARD_SIZE);

export const initialGameState: GameState = {
  board: initialBoard,
  currentPlayer: 'black',
  moveHistory: [],
  capturedBlack: 0,
  capturedWhite: 0,
  komi: 6.5,
};

export const initialRoot: GameNode = createNode(null, null, initialGameState, createRootNodeId());
initialRoot.properties = { RU: [rulesToSgfRu('japanese')] };
