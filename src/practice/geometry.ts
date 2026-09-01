import type { BoardState, Move } from '../types';

export interface BoardRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export const rectWidth = (rect: BoardRect): number => rect.right - rect.left;
export const rectHeight = (rect: BoardRect): number => rect.bottom - rect.top;

export function unionRects(a: BoardRect, b: BoardRect): BoardRect {
  return {
    left: Math.min(a.left, b.left),
    top: Math.min(a.top, b.top),
    right: Math.max(a.right, b.right),
    bottom: Math.max(a.bottom, b.bottom),
  };
}

export function expandRect(rect: BoardRect, margin: number, size: number): BoardRect {
  return {
    left: Math.max(0, rect.left - margin),
    top: Math.max(0, rect.top - margin),
    right: Math.min(size, rect.right + margin),
    bottom: Math.min(size, rect.bottom + margin),
  };
}

export function boardBoundingRect(board: BoardState): BoardRect | null {
  let left = board.length;
  let top = board.length;
  let right = 0;
  let bottom = 0;
  let found = false;
  for (let y = 0; y < board.length; y++) {
    for (let x = 0; x < board.length; x++) {
      if (!board[y]?.[x]) continue;
      found = true;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x + 1);
      bottom = Math.max(bottom, y + 1);
    }
  }
  return found ? { left, top, right, bottom } : null;
}

export function rectForPoints(points: Array<{ x: number; y: number }>): BoardRect | null {
  if (points.length === 0) return null;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return {
    left: Math.min(...xs),
    top: Math.min(...ys),
    right: Math.max(...xs) + 1,
    bottom: Math.max(...ys) + 1,
  };
}

export function movesToPoints(moves: Move[]): Array<{ x: number; y: number }> {
  return moves
    .filter((move) => move.x >= 0 && move.y >= 0)
    .map((move) => ({ x: move.x, y: move.y }));
}

export function pointsInRect(rect: BoardRect): Array<{ x: number; y: number }> {
  const points: Array<{ x: number; y: number }> = [];
  for (let y = rect.top; y < rect.bottom; y++) {
    for (let x = rect.left; x < rect.right; x++) {
      points.push({ x, y });
    }
  }
  return points;
}

export function intersectionMask(
  rect: BoardRect,
  size: number,
  additionalPoints: Array<{ x: number; y: number }> = []
): boolean[] {
  const mask = new Array<boolean>(size * size).fill(false);
  for (const point of pointsInRect(rect)) {
    if (point.x >= 0 && point.y >= 0 && point.x < size && point.y < size) {
      mask[point.y * size + point.x] = true;
    }
  }
  for (const point of additionalPoints) {
    if (point.x >= 0 && point.y >= 0 && point.x < size && point.y < size) {
      mask[point.y * size + point.x] = true;
    }
  }
  return mask;
}

export function compactBoardRect(
  board: BoardState,
  solutionPoints: Array<{ x: number; y: number }>,
  margin = 1
): BoardRect {
  const stoneRect = boardBoundingRect(board);
  const pointRect = rectForPoints(solutionPoints);
  const fullSize = board.length;
  if (!stoneRect && !pointRect) {
    return { left: 0, top: 0, right: fullSize, bottom: fullSize };
  }
  const base = stoneRect && pointRect ? unionRects(stoneRect, pointRect) : stoneRect ?? pointRect!;
  const expanded = expandRect(base, margin, fullSize);
  const width = rectWidth(expanded);
  const height = rectHeight(expanded);
  if (width === 1 && height === 1) {
    return expandRect(expanded, 1, fullSize);
  }
  return expanded;
}

export function cropBoard(board: BoardState, rect: BoardRect): BoardState {
  const rows: BoardState = [];
  for (let y = rect.top; y < rect.bottom; y++) {
    rows.push(board[y]!.slice(rect.left, rect.right));
  }
  return rows;
}

export function localMove(move: Move | null, rect: BoardRect): Move | null {
  if (!move || move.x < 0 || move.y < 0) return null;
  return {
    ...move,
    x: move.x - rect.left,
    y: move.y - rect.top,
  };
}
