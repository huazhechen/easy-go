import { useState, type CSSProperties } from 'react';
import type { BoardState, CandidateMove, Move, Player } from '../types';
import { isValidMove } from '../utils/gameLogic';
import { columnLabel, getBoardGeometry, linePosition, pointPosition } from '../utils/boardGeometry';
import { percent } from '../utils/format';
import type { TriStateMode } from '../hooks/useTriStateMode';

interface BoardGridProps {
  board: BoardState;
  currentPlayer: Player;
  currentMove: Move | null;
  previousBoard: BoardState | undefined;
  /** Top recommendation moves (already trimmed to the desired rank count). */
  hints: CandidateMove[];
  hintMode: TriStateMode;
  showTerritory: boolean;
  territory: number[][];
  /** True while the AI is thinking (scanline shows and clicks are ignored). */
  thinkingActive: boolean;
  /** Engine per-move thinking time; paces the scanline animation. */
  thinkingTimeMs: number;
  /** False while it is the AI's turn, so hover stones are suppressed. */
  canInteract: boolean;
  /** Changes whenever the visible game position changes. */
  positionKey: string;
  onPointClick: (x: number, y: number) => void;
}

export function BoardGrid({
  board,
  currentPlayer,
  currentMove,
  previousBoard,
  hints,
  hintMode,
  showTerritory,
  territory,
  thinkingActive,
  thinkingTimeMs,
  canInteract,
  positionKey,
  onPointClick,
}: BoardGridProps) {
  const boardSize = board.length;
  const geometry = getBoardGeometry(boardSize);
  const [hoverPoint, setHoverPoint] = useState<{ x: number; y: number } | null>(null);
  const [scanlineDone, setScanlineDone] = useState(false);
  const [lastPositionKey, setLastPositionKey] = useState(positionKey);

  // A new position starts a fresh scanline.
  if (lastPositionKey !== positionKey) {
    setLastPositionKey(positionKey);
    setScanlineDone(false);
  }

  const hintsVisible = hintMode !== 'off';
  // Analysis win rates are always black-perspective; the board shows them
  // from the side to move's point of view.
  const hintRates = hints.map((move) => (currentPlayer === 'white' ? 1 - move.winRate : move.winRate));
  const minHintRate = hintRates.length ? Math.min(...hintRates) : 0;
  const maxHintRate = hintRates.length ? Math.max(...hintRates) : 1;
  const showScanline = !scanlineDone && thinkingActive;

  const hintAt = (x: number, y: number): CandidateMove | undefined => hints.find((move) => move.x === x && move.y === y);

  // Show a translucent stone of the side to move wherever a real click would
  // actually place one: the point must be empty, it must be the human's turn,
  // and the move must pass the same legality checks playMove uses.
  const hoverStoneColor: Player | null = (() => {
    if (!hoverPoint || !canInteract) return null;
    const { x, y } = hoverPoint;
    if (board[y]?.[x]) return null;
    if (!isValidMove(board, x, y, currentPlayer, previousBoard)) return null;
    return currentPlayer;
  })();

  return (
    <div
      className="board-grid"
      onMouseLeave={() => setHoverPoint(null)}
      style={
        {
          '--board-size': boardSize,
          '--board-inset-left': `${geometry.pointInset}%`,
          '--board-inset-top': `${geometry.pointInset}%`,
          '--board-inset-right': `${geometry.pointInset}%`,
          '--board-inset-bottom': `${geometry.pointInset}%`,
        } as CSSProperties
      }
    >
      {Array.from({ length: boardSize }, (_, index) => {
        const line = linePosition(geometry, boardSize, index);
        const start = pointPosition(geometry, boardSize, 0, index);
        return <span key={`h-${index}`} className="board-line horizontal" style={{ left: start.left, width: line.length, top: start.top }} />;
      })}
      {Array.from({ length: boardSize }, (_, index) => {
        const line = linePosition(geometry, boardSize, index);
        const start = pointPosition(geometry, boardSize, index, 0);
        return <span key={`v-${index}`} className="board-line vertical" style={{ top: start.top, height: line.length, left: start.left }} />;
      })}
      {showScanline && (
        <span
          className="ai-thinking-scanline"
          data-ai-thinking-scanline="true"
          aria-hidden="true"
          onAnimationEnd={() => setScanlineDone(true)}
          // Keep the scanline slightly ahead of the engine timeout so the
          // animation reaches its end after the result is handed back.
          style={{ animationDuration: `${Math.max(25, thinkingTimeMs) * 1.1}ms` }}
        />
      )}
      <div className="board-coordinates board-coordinates-top" aria-hidden="true">
        {Array.from({ length: boardSize }, (_, index) => (
          <span key={`coord-x-${index}`} style={{ left: linePosition(geometry, boardSize, index).offset }}>{columnLabel(index)}</span>
        ))}
      </div>
      <div className="board-coordinates board-coordinates-left" aria-hidden="true">
        {Array.from({ length: boardSize }, (_, index) => (
          <span key={`coord-y-${index}`} style={{ top: linePosition(geometry, boardSize, index).offset }}>{boardSize - index}</span>
        ))}
      </div>
      {Array.from({ length: boardSize * boardSize }, (_, index) => {
        const x = index % boardSize;
        const y = Math.floor(index / boardSize);
        const stone = board[y]?.[x];
        const hint = hintsVisible ? hintAt(x, y) : undefined;
        const hintSideWinRate = hint ? (currentPlayer === 'white' ? 1 - hint.winRate : hint.winRate) : 0;
        const hintAlpha = hint
          ? 0.35 + (maxHintRate === minHintRate ? 0.6 : ((hintSideWinRate - minHintRate) / (maxHintRate - minHintRate)) * 0.6)
          : 0;
        const territoryValue = territory[y]?.[x];
        const territoryOwner = typeof territoryValue === 'number' ? (territoryValue >= 0 ? 'black' : 'white') : null;
        const pointStyle = pointPosition(geometry, boardSize, x, y);
        return (
          <button
            key={`${x}-${y}`}
            style={pointStyle}
            className={`intersection ${geometry.hoshiPoints.has(`${x}-${y}`) ? 'hoshi' : ''}`}
            onClick={() => onPointClick(x, y)}
            onMouseEnter={() => setHoverPoint({ x, y })}
            onFocus={() => setHoverPoint({ x, y })}
            onBlur={() => setHoverPoint((prev) => (prev?.x === x && prev?.y === y ? null : prev))}
            aria-label={`${x + 1},${y + 1}`}
          >
            {hint && !stone && (
              <span className={`hint-dot rank-${hints.findIndex((move) => move === hint)}`} style={{ backgroundColor: `rgba(211,47,47,${hintAlpha.toFixed(3)})` }}>{percent(hintSideWinRate)}</span>
            )}
            {stone && <span className={`board-stone ${stone === 'black' ? 'black-stone' : 'white-stone'}`} />}
            {currentMove?.x === x && currentMove?.y === y && <span className="last-move-marker" />}
            {showTerritory && territoryOwner && !hint && (!stone || territoryOwner !== stone) && (
              <span className={`score-mark ${territoryOwner}`} />
            )}
          </button>
        );
      })}
      {hoverStoneColor && hoverPoint && (
        <span
          className="hover-stone-hitbox"
          style={pointPosition(geometry, boardSize, hoverPoint.x, hoverPoint.y)}
          aria-hidden="true"
        >
          <span className={`hover-stone ${hoverStoneColor}-stone`} />
        </span>
      )}
    </div>
  );
}
