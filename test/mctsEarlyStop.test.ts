import { describe, expect, it } from 'vitest';
import type { AnalysisResult, CandidateMove } from '../src/types';
import {
  MCTS_EARLY_STOP_LEAD_MS_PER_POSITION,
  MCTS_EARLY_STOP_VISITS_PER_POSITION,
  checkMctsEarlyStop,
  createMctsEarlyStopState,
  earlyStopMinLeadMs,
  earlyStopMinVisits,
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

const best = move({ x: 3, y: 3, visits: 400 });
const second = move({ x: 15, y: 15, visits: 100 });

/**
 * Runs reports with a fixed best move until a stop is decided or it gives up.
 * The board keeps `remaining` empty intersections; time advances by timeStepMs
 * between reports starting at startMs.
 */
const runReports = (
  report: (rootVisits: number) => AnalysisResult,
  boardSize: number,
  startRootVisits: number,
  visitsStep: number,
  startMs: number,
  timeStepMs: number,
  maxReports = 12
): boolean => {
  let state = createMctsEarlyStopState();
  let rootVisits = startRootVisits;
  let nowMs = startMs;
  for (let i = 0; i < maxReports; i++) {
    const check = checkMctsEarlyStop(state, report(rootVisits), boardSize, nowMs);
    state = check.nextState;
    if (check.shouldStop) return true;
    rootVisits += visitsStep;
    nowMs += timeStepMs;
  }
  return false;
};

describe('early-stop gates scale with the board size', () => {
  it('uses 2x the board points for the visit gate', () => {
    expect(earlyStopMinVisits(9)).toBe(9 * 9 * MCTS_EARLY_STOP_VISITS_PER_POSITION);
    expect(earlyStopMinVisits(13)).toBe(13 * 13 * MCTS_EARLY_STOP_VISITS_PER_POSITION);
    expect(earlyStopMinVisits(19)).toBe(19 * 19 * MCTS_EARLY_STOP_VISITS_PER_POSITION);
  });

  it('uses board points / 64 s for the lead gate', () => {
    expect(earlyStopMinLeadMs(9)).toBe(Math.ceil(9 * 9 * MCTS_EARLY_STOP_LEAD_MS_PER_POSITION));
    expect(earlyStopMinLeadMs(19)).toBe(Math.ceil(19 * 19 * MCTS_EARLY_STOP_LEAD_MS_PER_POSITION));
  });
});

describe('checkMctsEarlyStop', () => {
  it('never stops below the scaled visit gate, however long it leads', () => {
    // 9x9 -> 162 visits required; stay under it throughout.
    const stopped = runReports(
      (rootVisits) => analysis(rootVisits, [best, second]),
      9,
      150,
      1,
      0,
      1000,
      9
    );
    expect(stopped).toBe(false);
  });

  it('scales the visit gate up with a bigger board', () => {
    // 19x19 -> 722 visits required; 162 visits is not enough.
    const stopped = runReports(
      (rootVisits) => analysis(rootVisits, [best, second]),
      19,
      162,
      2,
      0,
      2000
    );
    expect(stopped).toBe(false);
  });

  it('does not mark a node settled just because a state entry exists', () => {
    const state0 = createMctsEarlyStopState();
    const r1 = checkMctsEarlyStop(state0, analysis(32, [best, second]), 9, 0);
    expect(r1.nextState.leadingSinceMs).toBe(0);
    expect(r1.nextState.settled).toBe(false);
    expect(r1.shouldStop).toBe(false);

    // The continuous loop keeps scheduling new slices until settled flips.
    const r2 = checkMctsEarlyStop(r1.nextState, analysis(71, [best, second]), 9, 1000);
    expect(r2.nextState.settled).toBe(false);
    expect(r2.shouldStop).toBe(false);
  });

  it('needs the lead gate to elapse with the same move first', () => {
    const state0 = createMctsEarlyStopState();
    const r1 = checkMctsEarlyStop(state0, analysis(500, [best, second]), 9, 0);
    expect(r1.shouldStop).toBe(false);
    expect(r1.nextState.leadingSinceMs).toBe(0);

    // 1ms short of the gate is still not enough.
    const r2 = checkMctsEarlyStop(r1.nextState, analysis(600, [best, second]), 9, earlyStopMinLeadMs(9) - 1);
    expect(r2.shouldStop).toBe(false);

    // The report that crosses the gate may stop.
    const r3 = checkMctsEarlyStop(r2.nextState, analysis(700, [best, second]), 9, earlyStopMinLeadMs(9));
    expect(r3.shouldStop).toBe(true);
    expect(r3.nextState.leadingSinceMs).toBe(0);
    expect(r3.best).toBe(best);
    expect(r3.nextState.settled).toBe(true);

    // Once settled, the latch stays on even if another report arrives.
    const r4 = checkMctsEarlyStop(r3.nextState, analysis(800, [best, second]), 9, earlyStopMinLeadMs(9) + 1000);
    expect(r4.nextState.settled).toBe(true);
  });

  it('scales the lead gate up with a bigger board', () => {
    const state0 = createMctsEarlyStopState();
    const lead = earlyStopMinLeadMs(19);
    const r1 = checkMctsEarlyStop(state0, analysis(700, [best, second]), 19, 0);
    const r2 = checkMctsEarlyStop(r1.nextState, analysis(800, [best, second]), 19, lead - 1);
    expect(r2.shouldStop).toBe(false);
    const r3 = checkMctsEarlyStop(r2.nextState, analysis(900, [best, second]), 19, lead);
    expect(r3.shouldStop).toBe(true);
  });

  it('resets the lead clock when the leading move changes', () => {
    const otherBest = move({ x: 9, y: 9, visits: 400 });
    let state = createMctsEarlyStopState();

    state = checkMctsEarlyStop(state, analysis(500, [best, second]), 9, 0).nextState;
    // A different move takes over at t=4000; the old lead must not carry over.
    state = checkMctsEarlyStop(state, analysis(600, [otherBest, second]), 9, 4000).nextState;
    expect(state.streakMove).toEqual({ x: 9, y: 9 });
    expect(state.leadingSinceMs).toBe(4000);

    // One second later the new leader is not stable yet.
    const soon = checkMctsEarlyStop(state, analysis(700, [otherBest, second]), 9, 5000);
    expect(soon.shouldStop).toBe(false);

    // Two seconds after the switch the new leader is stable.
    const later = checkMctsEarlyStop(state, analysis(800, [otherBest, second]), 9, 6000);
    expect(later.shouldStop).toBe(true);
  });

  it('ignores unchanged reports so polling never resets the lead clock', () => {
    const report = analysis(500, [best, second]);
    const state = createMctsEarlyStopState();
    const first = checkMctsEarlyStop(state, report, 9, 0);
    expect(first.nextState.leadingSinceMs).toBe(0);

    const unchanged = checkMctsEarlyStop(first.nextState, report, 9, 6000);
    expect(unchanged.nextState).toBe(first.nextState);
    expect(unchanged.nextState.leadingSinceMs).toBe(0);
  });

  it('stops on a 4x visit advantage even without a win-rate gap', () => {
    const equalWinRate = [
      move({ x: 3, y: 3, visits: 400, winRate: 0.5 }),
      move({ x: 15, y: 15, visits: 100, winRate: 0.5 }),
    ];
    expect(runReports((rootVisits) => analysis(rootVisits, equalWinRate), 9, 162, 100, 0, 2000)).toBe(true);
  });

  it('does not stop on a 3x visit advantage', () => {
    const nearMiss = [
      move({ x: 3, y: 3, visits: 300, winRate: 0.5 }),
      move({ x: 15, y: 15, visits: 100, winRate: 0.5 }),
    ];
    expect(runReports((rootVisits) => analysis(rootVisits, nearMiss), 9, 162, 100, 0, 2000)).toBe(false);
  });

  it('stops on a 10% win-rate gap even with equal visits', () => {
    const clearGap = [
      move({ x: 3, y: 3, visits: 100, winRate: 0.6 }),
      move({ x: 15, y: 15, visits: 100, winRate: 0.5 }),
    ];
    expect(runReports((rootVisits) => analysis(rootVisits, clearGap), 9, 162, 100, 0, 2000)).toBe(true);
  });

  it('does not stop on a 5% win-rate gap', () => {
    const nearMiss = [
      move({ x: 3, y: 3, visits: 100, winRate: 0.55 }),
      move({ x: 15, y: 15, visits: 100, winRate: 0.5 }),
    ];
    expect(runReports((rootVisits) => analysis(rootVisits, nearMiss), 9, 162, 100, 0, 2000)).toBe(false);
  });

  it('uses the absolute win-rate gap regardless of perspective', () => {
    const reversedGap = [
      move({ x: 3, y: 3, visits: 100, winRate: 0.4 }),
      move({ x: 15, y: 15, visits: 100, winRate: 0.5 }),
    ];
    expect(runReports((rootVisits) => analysis(rootVisits, reversedGap), 9, 162, 100, 0, 2000)).toBe(true);
  });

  it('stops when the best lcb is above 50%', () => {
    const lcbLead = [
      move({ x: 3, y: 3, visits: 100, winRate: 0.5, lcb: 0.51 }),
      move({ x: 15, y: 15, visits: 100, winRate: 0.5, lcb: 0.5 }),
    ];
    expect(runReports((rootVisits) => analysis(rootVisits, lcbLead), 9, 162, 100, 0, 2000)).toBe(true);
  });

  it('does not count lcb at or below 50%', () => {
    const noLcbLead = [
      move({ x: 3, y: 3, visits: 100, winRate: 0.5, lcb: 0.5 }),
      move({ x: 15, y: 15, visits: 100, winRate: 0.5, lcb: 0.5 }),
    ];
    expect(runReports((rootVisits) => analysis(rootVisits, noLcbLead), 9, 162, 100, 0, 2000)).toBe(false);
  });

  it('counts the best lcb above 50% even when the second move has no lcb', () => {
    const partialLcb = [
      move({ x: 3, y: 3, visits: 100, winRate: 0.5, lcb: 0.51 }),
      move({ x: 15, y: 15, visits: 100, winRate: 0.5 }),
    ];
    expect(runReports((rootVisits) => analysis(rootVisits, partialLcb), 9, 162, 100, 0, 2000)).toBe(true);
  });

  it('treats a single candidate as dominant', () => {
    expect(runReports((rootVisits) => analysis(rootVisits, [best]), 9, 162, 100, 0, 2000)).toBe(true);
  });

  it('stops when the root win rate is effectively decided', () => {
    const decided = [
      move({ x: 3, y: 3, visits: 100, winRate: 0.995 }),
      move({ x: 15, y: 15, visits: 100, winRate: 0.985 }),
    ];
    expect(runReports((rootVisits) => analysis(rootVisits, decided, { rootWinRate: 0.995 }), 9, 162, 100, 0, 2000)).toBe(true);
    expect(runReports((rootVisits) => analysis(rootVisits, decided, { rootWinRate: 0.005 }), 9, 162, 100, 0, 2000)).toBe(true);
  });

  it('treats exactly 1% and 99% as decided', () => {
    const close = [
      move({ x: 3, y: 3, visits: 100, winRate: 0.99 }),
      move({ x: 15, y: 15, visits: 100, winRate: 0.98 }),
    ];
    expect(runReports((rootVisits) => analysis(rootVisits, close, { rootWinRate: 0.01 }), 9, 162, 100, 0, 2000)).toBe(true);
    expect(runReports((rootVisits) => analysis(rootVisits, close, { rootWinRate: 0.99 }), 9, 162, 100, 0, 2000)).toBe(true);
  });

  it('does not stop on a high but not decided root win rate alone', () => {
    const nearDecided = [
      move({ x: 3, y: 3, visits: 100, winRate: 0.985 }),
      move({ x: 15, y: 15, visits: 100, winRate: 0.98 }),
    ];
    expect(runReports((rootVisits) => analysis(rootVisits, nearDecided, { rootWinRate: 0.985 }), 9, 162, 100, 0, 2000)).toBe(false);
  });

  it('updates visits but never stops when no move is available', () => {
    let state = createMctsEarlyStopState();
    for (let i = 0; i < 6; i++) {
      const check = checkMctsEarlyStop(state, analysis(200 + i * 100, []), 9, i * 2000);
      state = check.nextState;
      expect(check.shouldStop).toBe(false);
      expect(check.best).toBeNull();
    }
    expect(state.lastRootVisits).toBe(700);
  });
});
