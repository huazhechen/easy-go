import { describe, expect, it } from 'vitest';
import { nextContinuousAnalysisVisits } from '../src/store/analysis';

describe('continuous analysis visit scheduling', () => {
  it('grows each outer-search target by ceil(current * 1.2 + 32)', () => {
    expect(nextContinuousAnalysisVisits(0)).toBe(32);
    expect(nextContinuousAnalysisVisits(32)).toBe(71);
    expect(nextContinuousAnalysisVisits(71)).toBe(118);
    expect(nextContinuousAnalysisVisits(16_383)).toBe(16_384);
  });
});
