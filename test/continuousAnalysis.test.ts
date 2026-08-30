import { describe, expect, it } from 'vitest';
import {
  continuousEarlyStopByNodeId,
  invalidateContinuousAnalysis,
  nextContinuousAnalysisVisits,
} from '../src/store/analysis';
import { createMctsEarlyStopState } from '../src/store/mctsEarlyStop';

describe('continuous analysis visit scheduling', () => {
  it('grows each outer-search target by ceil(current * 1.2 + 32)', () => {
    expect(nextContinuousAnalysisVisits(0)).toBe(32);
    expect(nextContinuousAnalysisVisits(32)).toBe(71);
    expect(nextContinuousAnalysisVisits(71)).toBe(118);
    expect(nextContinuousAnalysisVisits(16_383)).toBe(16_384);
  });

  it('drops settled nodes when the continuous search restarts', () => {
    continuousEarlyStopByNodeId.set('n1', createMctsEarlyStopState());
    continuousEarlyStopByNodeId.set('n2', createMctsEarlyStopState());
    expect(continuousEarlyStopByNodeId.size).toBe(2);

    invalidateContinuousAnalysis();

    expect(continuousEarlyStopByNodeId.size).toBe(0);
  });
});
