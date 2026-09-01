import { useState, type CSSProperties } from 'react';
import type { BoardState, Move, Player } from '../types';
import { columnLabel } from '../utils/boardGeometry';
import type { BoardRect } from '../practice/geometry';

interface PracticeBoardGridProps {
  board: BoardState;
  rect: BoardRect;
  currentMove: Move | null;
  currentPlayer: Player;
  canInteract: boolean;
  onPointClick: (x: number, y: number) => void;
}

function localPoint(rect: BoardRect, x: number, y: number): { x: number; y: number } | null {
  const lx = x - rect.left;
  const ly = y - rect.top;
  if (lx < 0 || ly < 0 || lx >= rect.right - rect.left || ly >= rect.bottom - rect.top) return null;
  return { x: lx, y: ly };
}

export function PracticeBoardGrid({
  board,
  rect,
  currentMove,
  currentPlayer,
  canInteract,
  onPointClick,
}: PracticeBoardGridProps) {
  const cols = Math.max(1, rect.right - rect.left);
  const rows = Math.max(1, rect.bottom - rect.top);
  const insetX = cols === 1 ? 18 : (2.4 + 42 / cols) / (1 + 0.84 / cols);
  const insetY = rows === 1 ? 18 : (2.4 + 42 / rows) / (1 + 0.84 / rows);
  const spanX = 100 - insetX * 2;
  const spanY = 100 - insetY * 2;
  const [hoverPoint, setHoverPoint] = useState<{ x: number; y: number } | null>(null);

  const pointX = (x: number): string => `${insetX + (x / Math.max(1, cols - 1)) * spanX}%`;
  const pointY = (y: number): string => `${insetY + (y / Math.max(1, rows - 1)) * spanY}%`;
  const localCurrentMove = currentMove ? localPoint(rect, currentMove.x, currentMove.y) : null;
  const hoverStoneColor: Player | null = (() => {
    if (!hoverPoint || !canInteract) return null;
    const fullX = hoverPoint.x + rect.left;
    const fullY = hoverPoint.y + rect.top;
    if (board[fullY]?.[fullX]) return null;
    return currentPlayer;
  })();

  return (
    <div
      className="board-grid practice-board-grid"
      onMouseLeave={() => setHoverPoint(null)}
      style={
        {
          aspectRatio: `${cols} / ${rows}`,
          '--region-cols': cols,
          '--region-rows': rows,
          '--region-inset-left': `${insetX}%`,
          '--region-inset-top': `${insetY}%`,
          '--region-inset-right': `${insetX}%`,
          '--region-inset-bottom': `${insetY}%`,
        } as CSSProperties
      }
    >
      {Array.from({ length: rows }, (_, y) => (
        <span
          key={`h-${y}`}
          className="board-line horizontal"
          style={{ left: `${insetX}%`, width: `${spanX}%`, top: pointY(y) }}
        />
      ))}
      {Array.from({ length: cols }, (_, x) => (
        <span
          key={`v-${x}`}
          className="board-line vertical"
          style={{ top: `${insetY}%`, height: `${spanY}%`, left: pointX(x) }}
        />
      ))}
      <div className="board-coordinates board-coordinates-top" aria-hidden="true">
        {Array.from({ length: cols }, (_, x) => (
          <span key={`coord-x-${x}`} style={{ left: pointX(x) }}>{columnLabel(rect.left + x)}</span>
        ))}
      </div>
      <div className="board-coordinates board-coordinates-left" aria-hidden="true">
        {Array.from({ length: rows }, (_, y) => (
          <span key={`coord-y-${y}`} style={{ top: pointY(y) }}>{board.length - (rect.top + y)}</span>
        ))}
      </div>
      {Array.from({ length: cols * rows }, (_, index) => {
        const lx = index % cols;
        const ly = Math.floor(index / cols);
        const fullX = rect.left + lx;
        const fullY = rect.top + ly;
        const stone = board[fullY]?.[fullX];
        const isLast = localCurrentMove?.x === lx && localCurrentMove?.y === ly;
        return (
          <button
            key={`${lx}-${ly}`}
            className="intersection"
            style={{ left: pointX(lx), top: pointY(ly) }}
            onClick={() => onPointClick(fullX, fullY)}
            onMouseEnter={() => setHoverPoint({ x: lx, y: ly })}
            onFocus={() => setHoverPoint({ x: lx, y: ly })}
            onBlur={() => setHoverPoint((prev) => (prev?.x === lx && prev?.y === ly ? null : prev))}
            aria-label={`${board.length - fullY}-${columnLabel(fullX)}`}
          >
            {stone && <span className={`board-stone ${stone === 'black' ? 'black-stone' : 'white-stone'}`} />}
            {isLast && <span className="last-move-marker" />}
          </button>
        );
      })}
      {hoverStoneColor && hoverPoint && (
        <span
          className="hover-stone-hitbox"
          style={{ left: pointX(hoverPoint.x), top: pointY(hoverPoint.y) }}
          aria-hidden="true"
        >
          <span className={`hover-stone ${hoverStoneColor}-stone`} />
        </span>
      )}
    </div>
  );
}
