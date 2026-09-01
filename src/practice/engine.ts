import type { BoardState, GameRules, Move, Player } from '../types';
import { getKataGoEngineClient } from '../engine/katago/client';
import { resolveModelUrlForFetch } from '../store/settings';
import { useGameStore } from '../store/gameStore';
import { simulateMove } from '../utils/gameLogic';

export interface PracticeAiChoice {
  x: number;
  y: number;
  winRate: number;
  scoreLead: number;
  visits: number;
}

export interface PracticeAnalysisOptions {
  board: BoardState;
  previousBoard?: BoardState;
  previousPreviousBoard?: BoardState;
  currentPlayer: Player;
  moveHistory: Move[];
  komi: number;
  rules: GameRules;
  interestMask: boolean[];
}

const PRACTICE_VISITS = 240;
const PRACTICE_TIME_MS = 1600;

export async function analyzePracticePosition(options: PracticeAnalysisOptions): Promise<PracticeAiChoice[]> {
  const settings = useGameStore.getState().settings;
  const client = getKataGoEngineClient();
  await client.init(
    resolveModelUrlForFetch(settings.katagoModelUrl),
    settings.katagoBackend
  );

  const allowedMoves = options.interestMask.map((allowed) => (allowed ? 1 : 0));
  const payload = await client.analyze({
    modelUrl: resolveModelUrlForFetch(settings.katagoModelUrl),
    backend: settings.katagoBackend,
    board: options.board,
    previousBoard: options.previousBoard,
    previousPreviousBoard: options.previousPreviousBoard,
    currentPlayer: options.currentPlayer,
    moveHistory: options.moveHistory,
    komi: options.komi,
    rules: options.rules,
    topK: 6,
    analysisPvLen: 4,
    includeMovesOwnership: false,
    wideRootNoise: 0,
    nnRandomize: false,
    conservativePass: true,
    visits: PRACTICE_VISITS,
    maxTimeMs: PRACTICE_TIME_MS,
    maxChildren: Math.max(8, allowedMoves.filter(Boolean).length),
    reuseTree: false,
    ownershipMode: 'root',
    allowedMoves,
  });

  return payload.moves
    .filter((move) => move.x >= 0 && move.y >= 0)
    .map((move) => ({
      x: move.x,
      y: move.y,
      winRate: move.winRate,
      scoreLead: move.scoreLead,
      visits: move.visits,
    }));
}

function fallbackLegalMove(
  board: BoardState,
  currentPlayer: Player,
  interestMask: boolean[],
  previousBoard?: BoardState
): PracticeAiChoice | null {
  for (let y = 0; y < board.length; y++) {
    for (let x = 0; x < board.length; x++) {
      if (!interestMask[y * board.length + x]) continue;
      if (board[y]?.[x]) continue;
      if (simulateMove(board, x, y, currentPlayer, previousBoard).legal) {
        return { x, y, winRate: 0.5, scoreLead: 0, visits: 0 };
      }
    }
  }
  return null;
}

export async function pickPracticeAiMove(options: PracticeAnalysisOptions): Promise<PracticeAiChoice | null> {
  try {
    const moves = await analyzePracticePosition(options);
    return moves[0] ?? fallbackLegalMove(
      options.board,
      options.currentPlayer,
      options.interestMask,
      options.previousBoard
    );
  } catch {
    return fallbackLegalMove(
      options.board,
      options.currentPlayer,
      options.interestMask,
      options.previousBoard
    );
  }
}
