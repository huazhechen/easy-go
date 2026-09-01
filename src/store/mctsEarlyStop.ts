import type { AnalysisResult, CandidateMove } from '../types';

/**
 * Adaptive early-stop rules for MCTS-backed features: the AI move turn and the
 * continuous hint search. Both may stop before their budgets when the search is
 * confident enough that the position is simple: enough root visits have
 * accumulated for the board size (2x the board points), the same move has led
 * continuously for long enough (board points / 64 s), and the best move is
 * clearly ahead (or the game is effectively decided).
 */

/** Root-visit gate scales as this many visits per board point. */
export const MCTS_EARLY_STOP_VISITS_PER_POSITION = 2;
/** Lead-time gate scales as this many ms per board point (1/64 s). */
export const MCTS_EARLY_STOP_LEAD_MS_PER_POSITION = 1000 / 64;
/** The best move must have at least this many times the visits of the second. */
export const MCTS_EARLY_STOP_VISITS_RATIO = 4;
/** Win-rate gap (0-1) required between the best and the second move. */
export const MCTS_EARLY_STOP_WINRATE_GAP = 0.1;
/** A best-move lower confidence bound above this win rate counts as dominant. */
export const MCTS_EARLY_STOP_LCB_WINRATE = 0.5;
/**
 * Root win rate at or below this (or at or above 1 - it) counts as effectively
 * decided: whichever side is ahead, the outcome is no longer in question.
 */
export const MCTS_EARLY_STOP_EXTREME_WINRATE = 0.01;

/** Root-visit gate: 2x the board points (size * size). */
export const earlyStopMinVisits = (boardSize: number): number =>
  boardSize * boardSize * MCTS_EARLY_STOP_VISITS_PER_POSITION;

/** Lead-time gate: board points / 64 s. */
export const earlyStopMinLeadMs = (boardSize: number): number =>
  Math.ceil(boardSize * boardSize * MCTS_EARLY_STOP_LEAD_MS_PER_POSITION);

export interface MctsEarlyStopState {
  /** Root visits of the last report this state machine has seen. */
  lastRootVisits: number;
  /** The move that led in the last report, or null before the first report. */
  streakMove: { x: number; y: number } | null;
  /** Epoch ms when streakMove first took the lead (reset on a move change). */
  leadingSinceMs: number;
  /**
   * Latch set only when a report satisfies every early-stop criterion. A state
   * existing in a map must not by itself mean "settled": the lead still has to
   * hold for several seconds first.
   */
  settled: boolean;
}

export const createMctsEarlyStopState = (): MctsEarlyStopState => ({
  lastRootVisits: 0,
  streakMove: null,
  leadingSinceMs: 0,
  settled: false,
});

export interface MctsEarlyStopCheck {
  nextState: MctsEarlyStopState;
  /** The best move of the newest report, or null when the report has none. */
  best: CandidateMove | null;
  /** True when the newest report satisfies every early-stop criterion. */
  shouldStop: boolean;
}

/**
 * Feeds one analysis report into the early-stop state machine. Reports are
 * identified by a rising rootVisits, so polling the store with an unchanged
 * analysis is a no-op and never resets the stability clock.
 */
export function checkMctsEarlyStop(
  prev: MctsEarlyStopState,
  analysis: AnalysisResult,
  boardSize = 19,
  nowMs: number = Date.now()
): MctsEarlyStopCheck {
  const rootVisits = analysis.rootVisits ?? 0;
  if (rootVisits <= prev.lastRootVisits) {
    return { nextState: prev, shouldStop: false, best: null };
  }

  const best = analysis.moves[0] ?? null;
  if (!best) {
    return { nextState: { ...prev, lastRootVisits: rootVisits }, shouldStop: false, best: null };
  }

  const sameMove = prev.streakMove !== null && prev.streakMove.x === best.x && prev.streakMove.y === best.y;
  const nextState: MctsEarlyStopState = {
    lastRootVisits: rootVisits,
    streakMove: sameMove ? prev.streakMove : { x: best.x, y: best.y },
    leadingSinceMs: sameMove ? prev.leadingSinceMs : nowMs,
    settled: prev.settled,
  };

  const confident = rootVisits >= earlyStopMinVisits(boardSize);
  const stable = sameMove && nowMs - prev.leadingSinceMs >= earlyStopMinLeadMs(boardSize);
  const decided =
    analysis.rootWinRate <= MCTS_EARLY_STOP_EXTREME_WINRATE ||
    analysis.rootWinRate >= 1 - MCTS_EARLY_STOP_EXTREME_WINRATE;
  const dominant = analysis.moves.length < 2 || decided || hasClearAdvantage(analysis.moves[0]!, analysis.moves[1]!);
  const shouldStop = confident && stable && dominant;
  if (shouldStop) nextState.settled = true;
  return { nextState, best, shouldStop };
}

/**
 * Whether the best move is clearly ahead of the second: at least 4x the
 * visits, a 10%+ win-rate gap, or a lower confidence bound above 50%. Any one
 * suffices.
 */
function hasClearAdvantage(best: CandidateMove, second: CandidateMove): boolean {
  if (best.visits >= second.visits * MCTS_EARLY_STOP_VISITS_RATIO) return true;
  if (Math.abs(best.winRate - second.winRate) + 1e-9 >= MCTS_EARLY_STOP_WINRATE_GAP) return true;
  if (best.lcb !== undefined && best.lcb > MCTS_EARLY_STOP_LCB_WINRATE) return true;
  return false;
}
