import type { BoardSize, GameNode, GameState, Move, Player } from '../types';
import { readLocalStorage, removeLocalStorage, writeLocalStorage } from '../utils/storage';

export const GAME_STORAGE_KEY = 'easy-go:game:v1';
export const OPENING_STORAGE_KEY = 'easy-go:opening:v1';

const BOARD_SIZES = new Set<number>([5, 7, 9, 11, 13, 15, 17, 19]);

/** The new-game dialog choices that are not already persisted elsewhere. */
export interface OpeningSettings {
  boardSize: BoardSize;
  humanColor: Player;
  selfPlay: boolean;
}

/** Game-tree node shape without parent links or engine analysis results. */
export interface SerializedGameNode {
  id: string;
  move: Move | null;
  gameState: GameState;
  properties?: Record<string, string[]>;
  analysisVisitsRequested?: number;
  children: SerializedGameNode[];
}

export interface StoredGame {
  rootNode: GameNode;
  currentNode: GameNode;
  activeBranchChildIds: Record<string, string>;
  isAiPlaying: boolean;
  aiColor: Player | null;
}

interface StoredGameSnapshot {
  rootNode: GameNode;
  currentNode: GameNode;
  activeBranchChildIds: Record<string, string>;
  isAiPlaying: boolean;
  aiColor: Player | null;
}

export interface StoredGameJson {
  version: 1;
  rootNode: SerializedGameNode;
  currentNodeId: string;
  activeBranchChildIds: Record<string, string>;
  isAiPlaying: boolean;
  aiColor: Player | null;
}

const isPlayer = (value: unknown): value is Player => value === 'black' || value === 'white';

const isMove = (value: unknown): value is Move => {
  if (!value || typeof value !== 'object') return false;
  const move = value as Record<string, unknown>;
  return typeof move.x === 'number' && Number.isFinite(move.x) && typeof move.y === 'number' && Number.isFinite(move.y) && isPlayer(move.player);
};

const isBoardState = (value: unknown): value is GameState['board'] => {
  if (!Array.isArray(value) || value.length === 0 || !BOARD_SIZES.has(value.length)) return false;
  const size = value.length;
  for (const row of value) {
    if (!Array.isArray(row) || row.length !== size) return false;
    for (const cell of row) {
      if (cell !== null && !isPlayer(cell)) return false;
    }
  }
  return true;
};

const isNonNegativeNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

const isGameState = (value: unknown): value is GameState => {
  if (!value || typeof value !== 'object') return false;
  const state = value as Record<string, unknown>;
  if (!isBoardState(state.board)) return false;
  if (!isPlayer(state.currentPlayer)) return false;
  if (!Array.isArray(state.moveHistory) || !state.moveHistory.every(isMove)) return false;
  if (!isNonNegativeNumber(state.capturedBlack) || !isNonNegativeNumber(state.capturedWhite)) return false;
  return typeof state.komi === 'number' && Number.isFinite(state.komi);
};

const isProperties = (value: unknown): value is Record<string, string[]> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.entries(value as Record<string, unknown>).every(
    ([, values]) => Array.isArray(values) && values.every((item) => typeof item === 'string')
  );
};

const isBranchMap = (value: unknown): value is Record<string, string> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.entries(value as Record<string, unknown>).every(([key, id]) => typeof key === 'string' && typeof id === 'string');
};

const serializeNode = (node: GameNode): SerializedGameNode => ({
  id: node.id,
  move: node.move,
  gameState: node.gameState,
  properties: node.properties && Object.keys(node.properties).length > 0 ? node.properties : undefined,
  analysisVisitsRequested: node.analysisVisitsRequested,
  children: node.children.map(serializeNode),
});

const rebuildNode = (
  serialized: unknown,
  parent: GameNode | null,
  nodeById: Map<string, GameNode>
): GameNode | null => {
  if (!serialized || typeof serialized !== 'object') return null;
  const raw = serialized as Record<string, unknown>;
  if (typeof raw.id !== 'string' || !raw.id) return null;
  if (nodeById.has(raw.id)) return null;
  if (!isGameState(raw.gameState)) return null;
  if (raw.move !== null && !isMove(raw.move)) return null;
  const properties = isProperties(raw.properties) ? raw.properties : undefined;
  const analysisVisitsRequested =
    isNonNegativeNumber(raw.analysisVisitsRequested) ? Math.floor(raw.analysisVisitsRequested) : 0;
  const node: GameNode = {
    id: raw.id,
    parent,
    children: [],
    move: raw.move as Move | null,
    gameState: raw.gameState as GameState,
    analysis: null,
    analysisVisitsRequested,
    properties,
  };
  nodeById.set(node.id, node);
  if (!Array.isArray(raw.children)) return null;
  for (const child of raw.children) {
    const childNode = rebuildNode(child, node, nodeById);
    if (!childNode) return null;
    node.children.push(childNode);
  }
  return node;
};

export const serializeStoredGame = (snapshot: StoredGameSnapshot): string => {
  const payload: StoredGameJson = {
    version: 1,
    rootNode: serializeNode(snapshot.rootNode),
    currentNodeId: snapshot.currentNode.id,
    activeBranchChildIds: snapshot.activeBranchChildIds,
    isAiPlaying: snapshot.isAiPlaying,
    aiColor: snapshot.aiColor,
  };
  return JSON.stringify(payload);
};

/** Rebuilds a game tree (parent links included) from a stored JSON string. */
export const parseStoredGame = (raw: string): StoredGame | null => {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object' || parsed.version !== 1) return null;
    const nodeById = new Map<string, GameNode>();
    const rootNode = rebuildNode(parsed.rootNode, null, nodeById);
    if (!rootNode) return null;
    const currentNode = typeof parsed.currentNodeId === 'string' ? nodeById.get(parsed.currentNodeId) : null;
    if (!currentNode) return null;
    return {
      rootNode,
      currentNode,
      activeBranchChildIds: isBranchMap(parsed.activeBranchChildIds) ? parsed.activeBranchChildIds : {},
      isAiPlaying: parsed.isAiPlaying === true,
      aiColor: isPlayer(parsed.aiColor) ? parsed.aiColor : null,
    };
  } catch {
    return null;
  }
};

export const loadStoredGame = (): StoredGame | null => {
  const raw = readLocalStorage(GAME_STORAGE_KEY);
  return raw ? parseStoredGame(raw) : null;
};

export const saveStoredGame = (snapshot: StoredGameSnapshot): boolean =>
  writeLocalStorage(GAME_STORAGE_KEY, serializeStoredGame(snapshot));

export const clearStoredGame = (): boolean => removeLocalStorage(GAME_STORAGE_KEY);

export const serializeOpeningSettings = (settings: OpeningSettings): string => JSON.stringify(settings);

export const parseStoredOpeningSettings = (raw: string): OpeningSettings | null => {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object') return null;
    const boardSize = BOARD_SIZES.has(Number(parsed.boardSize)) ? Number(parsed.boardSize) as BoardSize : null;
    const humanColor = isPlayer(parsed.humanColor) ? parsed.humanColor : null;
    if (!boardSize || !humanColor || typeof parsed.selfPlay !== 'boolean') return null;
    return { boardSize, humanColor, selfPlay: parsed.selfPlay };
  } catch {
    return null;
  }
};

export const loadStoredOpeningSettings = (): OpeningSettings | null => {
  const raw = readLocalStorage(OPENING_STORAGE_KEY);
  return raw ? parseStoredOpeningSettings(raw) : null;
};

export const saveStoredOpeningSettings = (settings: OpeningSettings): boolean =>
  writeLocalStorage(OPENING_STORAGE_KEY, serializeOpeningSettings(settings));
