import type { BoardSize } from '../types';
import { getHoshiPoints } from './boardSize';

export interface BoardGeometry {
  /** Stone/line inset from each board edge, as a percentage of the board. */
  pointInset: number;
  /** Distance spanned by the grid lines, as a percentage of the board. */
  pointSpan: number;
  /** Star-point coordinates keyed as "x-y". */
  hoshiPoints: Set<string>;
}

export function getBoardGeometry(boardSize: number): BoardGeometry {
  // Keep a consistent outer margin on every side: 2.4% of the board plus half
  // the stone width (stones occupy about 84% of one grid cell). Solve
  // inset = 2.4% + halfStone, where the stone radius is based on the actual
  // CSS cell width (available span / boardSize), not boardSize - 1.
  const pointInset = (2.4 + 42 / boardSize) / (1 + 0.84 / boardSize);
  const pointSpan = 100 - pointInset * 2;
  const hoshi = getHoshiPoints(boardSize as BoardSize);
  if ((boardSize === 5 || boardSize === 7) && hoshi.length === 0) {
    hoshi.push([Math.floor(boardSize / 2), Math.floor(boardSize / 2)]);
  }
  return {
    pointInset,
    pointSpan,
    hoshiPoints: new Set(hoshi.map(([x, y]) => `${x}-${y}`)),
  };
}

export function pointPosition(
  geometry: BoardGeometry,
  boardSize: number,
  x: number,
  y: number
): { left: string; top: string } {
  return {
    left: `${geometry.pointInset + (x / (boardSize - 1)) * geometry.pointSpan}%`,
    top: `${geometry.pointInset + (y / (boardSize - 1)) * geometry.pointSpan}%`,
  };
}

export function linePosition(geometry: BoardGeometry, boardSize: number, index: number): { offset: string; length: string } {
  return {
    offset: `${geometry.pointInset + (index / (boardSize - 1)) * geometry.pointSpan}%`,
    length: `${geometry.pointSpan}%`,
  };
}

export function columnLabel(index: number): string {
  // Go coordinates skip the letter I to avoid confusion with J.
  const letterCode = 65 + index + (index >= 8 ? 1 : 0);
  return String.fromCharCode(letterCode);
}
