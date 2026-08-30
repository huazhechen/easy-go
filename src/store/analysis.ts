import { isKataGoCanceledError } from '../engine/katago/client';
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

// Invalidates asynchronous AI callbacks whenever the visible game position
// changes. Cancellation alone is not sufficient because an engine may resolve
// concurrently with the cancel request.
let aiRequestEpoch = 0;
export const invalidateAiRequests = (reason: string): void => {
  aiRequestEpoch += 1;
  analysisQueue.cancelGroup('ai-move', reason);
};

export const getAiRequestEpoch = (): number => aiRequestEpoch;
