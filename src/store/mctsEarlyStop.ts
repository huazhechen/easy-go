import type { AnalysisResult, CandidateMove } from '../types';

/**
 * Adaptive early-stop rules for MCTS-backed features: the AI move turn and the
 * continuous hint search. Both may stop before their budgets when the search is
 * confident enough that the position is simple: enough visits have accumulated,
 * the best move is clearly ahead (or the game is effectively decided), and the
 * same move has led for several consecutive reports.
 */

/** Minimum root visits before the early-stop criteria may fire. */
export const MCTS_EARLY_STOP_MIN_VISITS = 128;
/** Consecutive reports that must rank the same move first. */
export const MCTS_EARLY_STOP_MIN_STREAK = 3;
/** The best move must have at least this many times the visits of the second. */
export const MCTS_EARLY_STOP_VISITS_RATIO = 3;
/** Win-rate gap (0-1) required between the best and the second move. */
export const MCTS_EARLY_STOP_WINRATE_GAP = 0.05;
/**
 * Root win rate at or below this (or at or above 1 - it) counts as effectively
 * decided: whichever side is ahead, the outcome is no longer in question.
 */
export const MCTS_EARLY_STOP_EXTREME_WINRATE = 0.01;

export interface MctsEarlyStopState {
  /** Root visits of the last report this state machine has seen. */
  lastRootVisits: number;
  /** The move that led in the last report, or null before the first report. */
  streakMove: { x: number; y: number } | null;
  /** How many consecutive reports have ranked streakMove first. */
  streak: number;
  /**
   * Latch set only when a report satisfies every early-stop criterion. A state
   * existing in a map must not by itself mean "settled": the streak still has
   * to build up over several reports first.
   */
  settled: boolean;
}

export const createMctsEarlyStopState = (): MctsEarlyStopState => ({
  lastRootVisits: 0,
  streakMove: null,
  streak: 0,
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
 * analysis is a no-op and never inflates the stability streak.
 */
export function checkMctsEarlyStop(prev: MctsEarlyStopState, analysis: AnalysisResult): MctsEarlyStopCheck {
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
    streak: sameMove ? prev.streak + 1 : 1,
    settled: prev.settled,
  };

  const confident = rootVisits >= MCTS_EARLY_STOP_MIN_VISITS;
  const stable = nextState.streak >= MCTS_EARLY_STOP_MIN_STREAK;
  const decided =
    analysis.rootWinRate <= MCTS_EARLY_STOP_EXTREME_WINRATE ||
    analysis.rootWinRate >= 1 - MCTS_EARLY_STOP_EXTREME_WINRATE;
  const dominant = analysis.moves.length < 2 || decided || hasClearAdvantage(analysis.moves[0]!, analysis.moves[1]!);
  const shouldStop = confident && stable && dominant;
  if (shouldStop) nextState.settled = true;
  return { nextState, best, shouldStop };
}

/**
 * Whether the best move is clearly ahead of the second: at least 3x the visits,
 * a 5%+ win-rate gap, or a better lower confidence bound. Any one suffices.
 */
function hasClearAdvantage(best: CandidateMove, second: CandidateMove): boolean {
  if (best.visits >= second.visits * MCTS_EARLY_STOP_VISITS_RATIO) return true;
  if (Math.abs(best.winRate - second.winRate) + 1e-9 >= MCTS_EARLY_STOP_WINRATE_GAP) return true;
  if (best.lcb !== undefined && second.lcb !== undefined && best.lcb > second.lcb) return true;
  return false;
}
