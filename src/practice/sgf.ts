import type { BoardState, Move, Player } from '../types';
import { checkCaptures } from '../utils/gameLogic';

export interface SgfNode {
  id: string;
  properties: Record<string, string[]>;
  children: SgfNode[];
  parent: SgfNode | null;
  move: Move | null;
}

export interface ParsedSgf {
  text: string;
  roots: SgfNode[];
}

const SGF_CHAR_OFFSET = 97;

export function sgfCoordToPoint(value: string): { x: number; y: number } | null {
  if (value.length < 2) return null;
  const x = value.charCodeAt(0) - SGF_CHAR_OFFSET;
  const y = value.charCodeAt(1) - SGF_CHAR_OFFSET;
  if (x < 0 || y < 0) return null;
  return { x, y };
}

export function sgfCoordToLabel(value: string): string {
  const point = sgfCoordToPoint(value);
  if (!point) return value;
  return `${String.fromCharCode(65 + point.x + (point.x >= 8 ? 1 : 0))}${point.y + 1}`;
}

export function sgfPointToCoord(x: number, y: number): string {
  return `${String.fromCharCode(SGF_CHAR_OFFSET + x)}${String.fromCharCode(SGF_CHAR_OFFSET + y)}`;
}

/**
 * A deliberately small SGF reader for the game trees used by the bundled data.
 * It handles multi-game files, nested variations, escaped property values, and
 * the common move/setup/comment properties without dragging in a dependency.
 */
export function parseSgf(text: string): ParsedSgf {
  let pos = 0;
  const roots: SgfNode[] = [];

  const skipWhitespace = () => {
    while (pos < text.length && /\s/.test(text[pos]!)) pos++;
  };

  const parseGameTrees = (parent: SgfNode | null): SgfNode[] => {
    const games: SgfNode[] = [];
    while (true) {
      skipWhitespace();
      if (pos >= text.length || text[pos] !== '(') break;
      games.push(parseGameTree(parent));
    }
    return games;
  };

  const parseGameTree = (parent: SgfNode | null): SgfNode => {
    skipWhitespace();
    if (pos >= text.length || text[pos] !== '(') {
      throw new Error(`Expected sequence at byte ${pos}`);
    }
    pos++;
    skipWhitespace();
    if (pos < text.length && text[pos] === ';') pos++;
    const first = parseNode(parent);
    let current = first;

    // Nodes joined by ';' inside the same game tree form a linear path.
    while (true) {
      skipWhitespace();
      if (pos >= text.length || text[pos] !== ';') break;
      pos++;
      const next = parseNode(current);
      current.children.push(next);
      current = next;
    }

    // Variations after the last sequence node become its branches.
    while (true) {
      skipWhitespace();
      if (pos >= text.length || text[pos] !== '(') break;
      current.children.push(parseGameTree(current));
    }

    skipWhitespace();
    if (pos < text.length && text[pos] === ')') pos++;
    return first;
  };

  const parseNode = (parent: SgfNode | null): SgfNode => {
    const properties: Record<string, string[]> = {};
    while (pos < text.length) {
      skipWhitespace();
      if (pos >= text.length) break;
      const ch = text[pos]!;
      if (ch === ';' || ch === '(' || ch === ')') break;

      let ident = '';
      while (pos < text.length && /[A-Za-z]/.test(text[pos]!)) {
        ident += text[pos];
        pos++;
      }
      if (!ident) {
        // Tolerate stray characters that should not appear in the data files.
        pos++;
        continue;
      }

      const values: string[] = [];
      while (pos < text.length && text[pos] === '[') {
        pos++;
        let value = '';
        let escaped = false;
        while (pos < text.length) {
          const c = text[pos]!;
          pos++;
          if (escaped) {
            value += c === 'n' ? '\n' : c;
            escaped = false;
            continue;
          }
          if (c === '\\') {
            escaped = true;
            continue;
          }
          if (c === ']') break;
          value += c;
        }
        values.push(value);
      }
      properties[ident] = values;
    }

    const move = parseMove(properties);
    return {
      id: `sgf-${Math.random().toString(36).slice(2, 10)}`,
      properties,
      children: [],
      parent,
      move,
    };
  };

  roots.push(...parseGameTrees(null));
  return { text, roots };
}

function parseMove(properties: Record<string, string[]>): Move | null {
  const moveValue = properties.B?.[0] ?? properties.W?.[0];
  if (!moveValue || moveValue === '') {
    // SGF's empty move is a pass. Keep passes as (-1,-1).
    if (Object.prototype.hasOwnProperty.call(properties, 'B') || Object.prototype.hasOwnProperty.call(properties, 'W')) {
      const player: Player = properties.B ? 'black' : 'white';
      return { x: -1, y: -1, player };
    }
    return null;
  }
  const point = sgfCoordToPoint(moveValue);
  if (!point) return null;
  return {
    x: point.x,
    y: point.y,
    player: properties.B ? 'black' : 'white',
  };
}

export function getPlayerToMove(root: SgfNode, fallback: Player = 'black'): Player {
  const pl = root.properties.PL?.[0]?.toUpperCase();
  if (pl === 'B') return 'black';
  if (pl === 'W') return 'white';
  const firstMove = root.children[0]?.move;
  if (firstMove) return firstMove.player;
  return fallback;
}

export function getBoardSize(root: SgfNode, fallback = 19): number {
  const value = Number(root.properties.SZ?.[0] ?? fallback);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

export function createEmptyBoard(size: number): BoardState {
  return Array.from({ length: size }, () => Array<Player | null>(size).fill(null));
}

function applySetup(board: BoardState, node: SgfNode): void {
  for (const value of node.properties.AB ?? []) {
    const point = sgfCoordToPoint(value);
    if (point && board[point.y]?.[point.x] === null) board[point.y]![point.x] = 'black';
  }
  for (const value of node.properties.AW ?? []) {
    const point = sgfCoordToPoint(value);
    if (point && board[point.y]?.[point.x] === null) board[point.y]![point.x] = 'white';
  }
  for (const value of node.properties.AE ?? []) {
    const point = sgfCoordToPoint(value);
    if (point) board[point.y]![point.x] = null;
  }
}

export interface NodePosition {
  board: BoardState;
  currentPlayer: Player;
  moveHistory: Move[];
  lastMove: Move | null;
}

export function positionForNode(root: SgfNode, target: SgfNode): NodePosition {
  const path: SgfNode[] = [];
  let cursor: SgfNode | null = target;
  while (cursor) {
    path.unshift(cursor);
    cursor = cursor.parent;
  }

  const size = getBoardSize(root);
  const board = createEmptyBoard(size);
  let currentPlayer = getPlayerToMove(root);
  const moveHistory: Move[] = [];
  let lastMove: Move | null = null;

  for (const node of path) {
    applySetup(board, node);
    const move = node.move;
    if (move && node !== root) {
      if (move.x < 0 || move.y < 0) {
        moveHistory.push(move);
        lastMove = move;
      } else {
        const { newBoard } = checkCaptures(board, move.x, move.y, move.player);
        if (newBoard[move.y]?.[move.x] === null) {
          // In SGF trees the move is always assumed legal; recover if the
          // parser saw a coordinate outside the board.
          continue;
        }
        board.forEach((row, y) => row.forEach((_, x) => {
          row[x] = newBoard[y]![x]!;
        }));
        moveHistory.push(move);
        lastMove = move;
      }
      currentPlayer = currentPlayer === 'black' ? 'white' : 'black';
    }
  }

  return { board, currentPlayer, moveHistory, lastMove };
}

export function nodeDepth(node: SgfNode): number {
  let depth = 0;
  let cursor = node.parent;
  while (cursor) {
    depth++;
    cursor = cursor.parent;
  }
  return depth;
}

export function collectBranchLeaves(node: SgfNode): SgfNode[] {
  if (node.children.length === 0) return [node];
  return node.children.flatMap(collectBranchLeaves);
}
