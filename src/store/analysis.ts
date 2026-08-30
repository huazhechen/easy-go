import { isKataGoCanceledError } from '../engine/katago/client';
import type { KataGoAnalysisPayload } from '../engine/katago/types';
import { ENGINE_MAX_TIME_MS, ENGINE_MAX_VISITS } from '../engine/katago/limits';
import type { AnalysisResult, GameSettings } from '../types';
import { isAnalysisQueueCanceledError, isAnalysisQueueStaleError, analysisQueue } from '../utils/analysisQueue';

let continuousToken = 0;
/** Stops the current continuous-search loop; the next toggle starts a fresh one. */
export const invalidateContinuousAnalysis = (): void => {
  continuousToken++;
};
/** Starts a new continuous-search generation and returns its token. */
export const beginContinuousAnalysis = (): number => ++continuousToken;
export const isContinuousAnalysisCurrent = (token: number): boolean => token === continuousToken;
export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
export const CONTINUOUS_INITIAL_VISITS = 32;
export const CONTINUOUS_MAX_VISITS = 16_384;
export const CONTINUOUS_INNER_MAX_TIME_MS = 1_000;
export const CONTINUOUS_POSITION_MAX_TIME_MS = 5 * 60_000;
export const continuousSearchMsByNodeId = new Map<string, number>();

export const nextContinuousAnalysisVisits = (currentVisits: number): number => {
  if (currentVisits < 1) return CONTINUOUS_INITIAL_VISITS;
  return Math.min(
    CONTINUOUS_MAX_VISITS,
    Math.max(currentVisits + 1, Math.ceil(currentVisits * 1.2 + 32))
  );
};

export const ANALYSIS_QUEUE_PRIORITY = {
  interactive: 100,
  // Playing a move must win over background continuous recommendations.
  aiMove: 110,
} as const;
// KaTrain-style report cadence (seconds -> ms).
export const REPORT_DURING_SEARCH_EVERY_MS = 1000;
export const CONTINUOUS_REPORT_DURING_SEARCH_MS = 250;
// Throttle UI updates during progress reports to reduce main-thread churn.
export const PROGRESS_APPLY_MIN_MS = 500;

export const isAnalysisCanceled = (err: unknown): boolean =>
  isKataGoCanceledError(err) || isAnalysisQueueCanceledError(err) || isAnalysisQueueStaleError(err);

export const analysisCacheKey = (...parts: unknown[]): string => JSON.stringify(parts);

export interface AnalysisRequestOptions {
  force?: boolean;
  visits?: number;
  maxTimeMs?: number;
  batchSize?: number;
  maxChildren?: number;
  topK?: number;
  analysisPvLen?: number;
  wideRootNoise?: number;
  nnRandomize?: boolean;
  conservativePass?: boolean;
  reuseTree?: boolean;
  ownershipRefreshIntervalMs?: number;
  reportEveryMs?: number;
  /** Let an outer scheduler handle failures instead of resolving after reporting them. */
  propagateErrors?: boolean;
}

export interface ResolvedAnalysisRequest {
  visits: number;
  maxTimeMs: number;
  batchSize: number;
  maxChildren: number;
  topK: number;
  analysisPvLen: number;
  wideRootNoise: number;
  rootPolicyTemperature: number;
  fillDameBeforePass: boolean;
  nnRandomize: boolean;
  conservativePass: boolean;
  reuseTree: boolean;
  ownershipRefreshIntervalMs: number | undefined;
  reportDuringSearchEveryMs: number | undefined;
  progressApplyMinMs: number;
  treeUpdateEveryMs: number;
}

/** Resolves a runAnalysis call into concrete, clamped engine parameters. */
export const resolveAnalysisRequest = (
  settings: GameSettings,
  boardSize: number,
  opts: AnalysisRequestOptions | undefined,
  isContinuousAnalysis: boolean
): ResolvedAnalysisRequest => {
  const visits = Math.max(16, Math.min(opts?.visits ?? settings.katagoVisits, ENGINE_MAX_VISITS));
  const maxTimeMs = Math.max(25, Math.min(opts?.maxTimeMs ?? settings.katagoMaxTimeMs, ENGINE_MAX_TIME_MS));
  const batchSize = Math.max(1, Math.min(opts?.batchSize ?? settings.katagoBatchSize, 64));
  const maxChildren = Math.max(4, Math.min(opts?.maxChildren ?? settings.katagoMaxChildren, boardSize * boardSize));
  const topK = Math.max(1, Math.min(opts?.topK ?? settings.katagoTopK, 50));
  const reportEveryMsRaw = opts?.reportEveryMs;
  const reportEveryMs =
    typeof reportEveryMsRaw === 'number' && Number.isFinite(reportEveryMsRaw)
      ? Math.max(0, reportEveryMsRaw)
      : (isContinuousAnalysis ? CONTINUOUS_REPORT_DURING_SEARCH_MS : REPORT_DURING_SEARCH_EVERY_MS);
  return {
    visits,
    maxTimeMs,
    batchSize,
    maxChildren,
    topK,
    analysisPvLen: opts?.analysisPvLen ?? settings.katagoAnalysisPvLen,
    wideRootNoise: opts?.wideRootNoise ?? settings.katagoWideRootNoise,
    rootPolicyTemperature: settings.katagoRootPolicyTemperature,
    fillDameBeforePass: settings.katagoFillDameBeforePass,
    nnRandomize: opts?.nnRandomize ?? settings.katagoNnRandomize,
    conservativePass: opts?.conservativePass ?? settings.katagoConservativePass,
    reuseTree: opts?.reuseTree ?? settings.katagoReuseTree,
    ownershipRefreshIntervalMs: opts?.ownershipRefreshIntervalMs,
    reportDuringSearchEveryMs: reportEveryMs > 0 ? reportEveryMs : undefined,
    progressApplyMinMs: reportEveryMs > 0 ? Math.max(reportEveryMs, PROGRESS_APPLY_MIN_MS) : 0,
    treeUpdateEveryMs: reportEveryMs > 0 ? reportEveryMs : 0,
  };
};

/** Maps a worker analysis payload onto the app-facing AnalysisResult shape. */
export const buildAnalysisResult = (
  analysis: KataGoAnalysisPayload,
  territory: number[][],
  ownershipMode: 'root' | 'tree'
): AnalysisResult => ({
  rootWinRate: analysis.rootWinRate,
  rootScoreLead: analysis.rootScoreLead,
  rootScoreSelfplay: analysis.rootScoreSelfplay,
  rootScoreStdev: analysis.rootScoreStdev,
  rootVisits: analysis.rootVisits,
  rawWinRate: analysis.rawWinRate,
  rawScoreLead: analysis.rawScoreLead,
  rawScoreSelfplay: analysis.rawScoreSelfplay,
  rawScoreSelfplayStdev: analysis.rawScoreSelfplayStdev,
  rawNoResultProb: analysis.rawNoResultProb,
  rawStWrError: analysis.rawStWrError,
  rawStScoreError: analysis.rawStScoreError,
  rawVarTimeLeft: analysis.rawVarTimeLeft,
  moves: analysis.moves,
  territory,
  policy: analysis.policy,
  ownershipStdev: analysis.ownershipStdev,
  ownershipMode,
});

// Invalidates asynchronous AI callbacks whenever the visible game position
// changes. Cancellation alone is not sufficient because an engine may resolve
// concurrently with the cancel request.
let aiRequestEpoch = 0;
export const invalidateAiRequests = (reason: string): void => {
  aiRequestEpoch += 1;
  analysisQueue.cancelGroup('ai-move', reason);
};

export const getAiRequestEpoch = (): number => aiRequestEpoch;
