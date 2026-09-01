import { describe, expect, it } from 'vitest';
import { resolveAnalysisRequest } from '../src/store/analysis';
import { defaultSettings } from '../src/store/settings';

describe('resolveAnalysisRequest', () => {
  it('falls back to settings for every interactive default', () => {
    const request = resolveAnalysisRequest(defaultSettings, 19, undefined, false);
    expect(request.visits).toBe(5000);
    expect(request.maxTimeMs).toBe(2000);
    expect(request.batchSize).toBe(1);
    expect(request.maxChildren).toBe(361);
    expect(request.topK).toBe(10);
    expect(request.analysisPvLen).toBe(15);
    expect(request.wideRootNoise).toBe(0.04);
    expect(request.reportDuringSearchEveryMs).toBe(1000);
    expect(request.progressApplyMinMs).toBe(1000);
    expect(request.treeUpdateEveryMs).toBe(1000);
  });

  it('uses the faster continuous-analysis report cadence', () => {
    const request = resolveAnalysisRequest(defaultSettings, 19, undefined, true);
    expect(request.reportDuringSearchEveryMs).toBe(250);
    expect(request.progressApplyMinMs).toBe(500);
    expect(request.treeUpdateEveryMs).toBe(250);
  });

  it('applies per-call overrides and clamps to engine limits', () => {
    const request = resolveAnalysisRequest(
      defaultSettings,
      9,
      {
        visits: 100_000,
        maxTimeMs: 999_999,
        batchSize: 128,
        maxChildren: 10_000,
        topK: 100,
        analysisPvLen: 4,
        wideRootNoise: 0,
        nnRandomize: false,
        reuseTree: false,
        reportEveryMs: 300,
      },
      false
    );
    expect(request.visits).toBe(50_000);
    expect(request.maxTimeMs).toBe(300_000);
    expect(request.batchSize).toBe(64);
    expect(request.maxChildren).toBe(81); // 9x9 board
    expect(request.topK).toBe(50);
    expect(request.analysisPvLen).toBe(4);
    expect(request.wideRootNoise).toBe(0);
    expect(request.nnRandomize).toBe(false);
    expect(request.reuseTree).toBe(false);
    expect(request.reportDuringSearchEveryMs).toBe(300);
    expect(request.progressApplyMinMs).toBe(500);
    expect(request.treeUpdateEveryMs).toBe(300);
  });

  it('enforces minimum floors for tiny values', () => {
    const request = resolveAnalysisRequest(
      defaultSettings,
      19,
      { visits: 1, maxTimeMs: 1, batchSize: -5, maxChildren: 1, topK: 0 },
      false
    );
    expect(request.visits).toBe(16);
    expect(request.maxTimeMs).toBe(25);
    expect(request.batchSize).toBe(1);
    expect(request.maxChildren).toBe(4);
    expect(request.topK).toBe(1);
  });

  it('disables progress reporting when reportEveryMs is zero', () => {
    const request = resolveAnalysisRequest(defaultSettings, 19, { reportEveryMs: 0 }, false);
    expect(request.reportDuringSearchEveryMs).toBeUndefined();
    expect(request.progressApplyMinMs).toBe(0);
    expect(request.treeUpdateEveryMs).toBe(0);
  });
});
