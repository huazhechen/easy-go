import { describe, expect, it } from 'vitest';
import type { AnalysisResult, CandidateMove } from '../src/types';
import {
  MCTS_EARLY_STOP_MIN_STREAK,
  MCTS_EARLY_STOP_MIN_VISITS,
  checkMctsEarlyStop,
  createMctsEarlyStopState,
} from '../src/store/mctsEarlyStop';

const move = (overrides: Partial<CandidateMove> & { x: number; y: number }): CandidateMove => ({
  winRate: 0.5,
  scoreLead: 0,
  visits: 10,
  pointsLost: 0,
  order: 0,
  ...overrides,
});

const analysis = (
  rootVisits: number,
  moves: CandidateMove[],
  overrides: Partial<AnalysisResult> = {}
): AnalysisResult => ({
  rootWinRate: 0.5,
  rootScoreLead: 0,
  rootVisits,
  moves,
  territory: [],
  ...overrides,
});

const best = move({ x: 3, y: 3, visits: 300 });
const second = move({ x: 15, y: 15, visits: 100 });

/** Runs reports with a fixed best move until a stop is decided or it gives up. */
const runReports = (
  report: (rootVisits: number) => AnalysisResult,
  startRootVisits: number,
  step: number,
  maxReports = MCTS_EARLY_STOP_MIN_STREAK + 2
): boolean => {
  let state = createMctsEarlyStopState();
  let rootVisits = startRootVisits;
  for (let i = 0; i < maxReports; i++) {
    const check = checkMctsEarlyStop(state, report(rootVisits));
    state = check.nextState;
    if (check.shouldStop) return true;
    rootVisits += step;
  }
  return false;
};

describe('checkMctsEarlyStop', () => {
  it('never stops below the minimum visit threshold', () => {
    const stopped = runReports(
      (rootVisits) => analysis(rootVisits, [best, second]),
      MCTS_EARLY_STOP_MIN_VISITS - 28,
      5
    );
    expect(stopped).toBe(false);
  });

  it('does not mark a node settled just because a state entry exists', () => {
    const state0 = createMctsEarlyStopState();
    const r1 = checkMctsEarlyStop(state0, analysis(32, [best, second]));
    expect(r1.nextState.streak).toBe(1);
    expect(r1.nextState.settled).toBe(false);
    expect(r1.shouldStop).toBe(false);

    // The continuous loop keeps scheduling new slices until settled flips.
    const r2 = checkMctsEarlyStop(r1.nextState, analysis(71, [best, second]));
    expect(r2.nextState.settled).toBe(false);
    expect(r2.shouldStop).toBe(false);
  });

  it('needs three consecutive reports ranking the same move first', () => {
    const state0 = createMctsEarlyStopState();
    const r1 = checkMctsEarlyStop(state0, analysis(200, [best, second]));
    expect(r1.shouldStop).toBe(false);
    expect(r1.nextState.streak).toBe(1);

    const r2 = checkMctsEarlyStop(r1.nextState, analysis(300, [best, second]));
    expect(r2.shouldStop).toBe(false);
    expect(r2.nextState.streak).toBe(2);

    const r3 = checkMctsEarlyStop(r2.nextState, analysis(400, [best, second]));
    expect(r3.shouldStop).toBe(true);
    expect(r3.nextState.streak).toBe(3);
    expect(r3.best).toBe(best);
    expect(r3.nextState.settled).toBe(true);

    // Once settled, the latch stays on even if another report arrives.
    const r4 = checkMctsEarlyStop(r3.nextState, analysis(500, [best, second]));
    expect(r4.nextState.settled).toBe(true);
  });

  it('resets the stability streak when the leading move changes', () => {
    const otherBest = move({ x: 9, y: 9, visits: 300 });
    let state = createMctsEarlyStopState();

    state = checkMctsEarlyStop(state, analysis(200, [best, second])).nextState;
    state = checkMctsEarlyStop(state, analysis(300, [otherBest, second])).nextState;
    expect(state.streakMove).toEqual({ x: 9, y: 9 });
    expect(state.streak).toBe(1);

    state = checkMctsEarlyStop(state, analysis(400, [otherBest, second])).nextState;
    expect(state.streak).toBe(2);

    const final = checkMctsEarlyStop(state, analysis(500, [otherBest, second]));
    expect(final.shouldStop).toBe(true);
  });

  it('ignores unchanged reports so polling never inflates the streak', () => {
    const report = analysis(200, [best, second]);
    const state = createMctsEarlyStopState();
    const first = checkMctsEarlyStop(state, report);
    expect(first.nextState.streak).toBe(1);

    const secondCheck = checkMctsEarlyStop(first.nextState, report);
    expect(secondCheck.nextState).toBe(first.nextState);
    expect(secondCheck.nextState.streak).toBe(1);
  });

  it('stops on a 3x visit advantage even without a win-rate gap', () => {
    const equalWinRate = [
      move({ x: 3, y: 3, visits: 300, winRate: 0.5 }),
      move({ x: 15, y: 15, visits: 100, winRate: 0.5 }),
    ];
    expect(runReports((rootVisits) => analysis(rootVisits, equalWinRate), 200, 100)).toBe(true);
  });

  it('stops on a 5% win-rate gap even with equal visits', () => {
    const clearGap = [
      move({ x: 3, y: 3, visits: 100, winRate: 0.55 }),
      move({ x: 15, y: 15, visits: 100, winRate: 0.5 }),
    ];
    expect(runReports((rootVisits) => analysis(rootVisits, clearGap), 200, 100)).toBe(true);
  });

  it('uses the absolute win-rate gap regardless of perspective', () => {
    const reversedGap = [
      move({ x: 3, y: 3, visits: 100, winRate: 0.45 }),
      move({ x: 15, y: 15, visits: 100, winRate: 0.5 }),
    ];
    expect(runReports((rootVisits) => analysis(rootVisits, reversedGap), 200, 100)).toBe(true);
  });

  it('stops when the best lcb beats the second lcb', () => {
    const lcbLead = [
      move({ x: 3, y: 3, visits: 100, winRate: 0.5, lcb: 0.51 }),
      move({ x: 15, y: 15, visits: 100, winRate: 0.5, lcb: 0.5 }),
    ];
    expect(runReports((rootVisits) => analysis(rootVisits, lcbLead), 200, 100)).toBe(true);
  });

  it('does not count lcb when the second move has no lcb', () => {
    const partialLcb = [
      move({ x: 3, y: 3, visits: 100, winRate: 0.5, lcb: 0.51 }),
      move({ x: 15, y: 15, visits: 100, winRate: 0.5 }),
    ];
    expect(runReports((rootVisits) => analysis(rootVisits, partialLcb), 200, 100)).toBe(false);
  });

  it('treats a single candidate as dominant', () => {
    expect(runReports((rootVisits) => analysis(rootVisits, [best]), 200, 100)).toBe(true);
  });

  it('stops when the root win rate is effectively decided', () => {
    const decided = [
      move({ x: 3, y: 3, visits: 100, winRate: 0.995 }),
      move({ x: 15, y: 15, visits: 100, winRate: 0.985 }),
    ];
    expect(runReports((rootVisits) => analysis(rootVisits, decided, { rootWinRate: 0.995 }), 200, 100)).toBe(true);
    expect(runReports((rootVisits) => analysis(rootVisits, decided, { rootWinRate: 0.005 }), 200, 100)).toBe(true);
  });

  it('treats exactly 1% and 99% as decided', () => {
    const close = [
      move({ x: 3, y: 3, visits: 100, winRate: 0.99 }),
      move({ x: 15, y: 15, visits: 100, winRate: 0.98 }),
    ];
    expect(runReports((rootVisits) => analysis(rootVisits, close, { rootWinRate: 0.01 }), 200, 100)).toBe(true);
    expect(runReports((rootVisits) => analysis(rootVisits, close, { rootWinRate: 0.99 }), 200, 100)).toBe(true);
  });

  it('does not stop on a high but not decided root win rate alone', () => {
    const nearDecided = [
      move({ x: 3, y: 3, visits: 100, winRate: 0.985 }),
      move({ x: 15, y: 15, visits: 100, winRate: 0.98 }),
    ];
    expect(runReports((rootVisits) => analysis(rootVisits, nearDecided, { rootWinRate: 0.985 }), 200, 100)).toBe(false);
  });

  it('updates visits but never stops when no move is available', () => {
    let state = createMctsEarlyStopState();
    for (let i = 0; i < MCTS_EARLY_STOP_MIN_STREAK + 1; i++) {
      const check = checkMctsEarlyStop(state, analysis(200 + i * 100, []));
      state = check.nextState;
      expect(check.shouldStop).toBe(false);
      expect(check.best).toBeNull();
    }
    expect(state.lastRootVisits).toBe(200 + MCTS_EARLY_STOP_MIN_STREAK * 100);
  });
});
