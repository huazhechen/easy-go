import type { BoardState, FloatArray, GameRules, KataGoBackendPreference, Move, Player } from '../../types';

export interface KataGoInitRequest {
  type: 'katago:init';
  modelUrl: string;
  backend?: KataGoBackendPreference;
}

export interface KataGoInitResponse {
  type: 'katago:init_result';
  ok: boolean;
  backend?: string;
  modelName?: string;
  error?: string;
}

export interface KataGoAnalyzeRequest {
  type: 'katago:analyze';
  id: number;
  positionId?: string;
  parentPositionId?: string;
  positionKey?: string;
  parentPositionKey?: string;
  modelUrl: string;
  backend?: KataGoBackendPreference;
  board: BoardState;
  previousBoard?: BoardState;
  previousPreviousBoard?: BoardState;
  currentPlayer: Player;
  moveHistory: Move[];
  komi: number;
  rules?: GameRules;
  topK?: number;
  analysisPvLen?: number;
  includeMovesOwnership?: boolean;
  wideRootNoise?: number;
  /** KataGo rootPolicyTemperature: above 1 flattens the root policy, widening the search. */
  rootPolicyTemperature?: number;
  nnRandomize?: boolean;
  conservativePass?: boolean;
  /** KataGo fillDameBeforePass: under territory scoring, don't pass while dame remain. */
  fillDameBeforePass?: boolean;
  visits?: number;
  maxTimeMs?: number;
  batchSize?: number;
  maxChildren?: number;
  reportDuringSearchEveryMs?: number;
  ownershipRefreshIntervalMs?: number;
  reuseTree?: boolean;
  ownershipMode?: 'root' | 'tree';
  /**
   * Root move mask in board coordinates, one entry per `board.length * board.length`.
   * Only these intersections are expanded by the search. Passing stays available
   * as a candidate but callers such as the practice module can ignore it.
   */
  allowedMoves?: number[];
}

/**
 * One network forward pass, no MCTS search: the raw win rate, score read and
 * ownership map straight from the net. Cheap enough to run on every position
 * change; precise estimates still need the search-based analyze path.
 */
export interface KataGoQuickEvalRequest {
  type: 'katago:quick_eval';
  id: number;
  modelUrl: string;
  backend?: KataGoBackendPreference;
  board: BoardState;
  previousBoard?: BoardState;
  previousPreviousBoard?: BoardState;
  currentPlayer: Player;
  moveHistory: Move[];
  komi: number;
  rules?: GameRules;
}

export interface KataGoAnalysisPayload {
  rootWinRate: number;
  rootScoreLead: number;
  rootScoreSelfplay: number;
  rootScoreStdev: number;
  rootVisits: number;
  // KataGo rootInfo's raw* fields: the network's own read, before any search.
  rawWinRate?: number;
  rawScoreLead?: number;
  rawScoreSelfplay?: number;
  rawScoreSelfplayStdev?: number;
  rawNoResultProb?: number;
  rawStWrError?: number; // -1 when the net does not predict it
  rawStScoreError?: number;
  rawVarTimeLeft?: number; // KataGo rawVarTimeLeft: how much game the net thinks is left
  ownership: FloatArray; // len 361, +1 black owns, -1 white owns
  ownershipStdev: FloatArray; // len 361
  policy: FloatArray; // len 362, illegal = -1, pass at index 361
  moves: Array<{
    x: number;
    y: number;
    winRate: number;
    winRateLost: number;
    scoreLead: number;
    scoreSelfplay: number;
    scoreStdev: number;
    visits: number;
    edgeVisits?: number; // what the parent paid for; visits can exceed it
    noResultValue?: number; // chance this move's subtree ends with no result
    weight?: number;
    edgeWeight?: number;
    pointsLost: number;
    relativePointsLost: number;
    order: number;
    prior: number;
    pv: string[];
    pvVisits?: number[]; // visits at each move of the pv (KataGo includePVVisits)
    pvEdgeVisits?: number[]; // visits this line paid for; never rises along the pv
    lcb?: number; // winrate-scale lower confidence bound, black perspective
    utilityLcb?: number; // utility-scale lower confidence bound, black perspective
    playSelectionValue?: number; // KataGo play selection weight (LCB adjusted)
    utility?: number; // KataGo utilityAvg for this child, black perspective
    ownership?: FloatArray; // len 361, +1 black owns, -1 white owns (position after this move)
  }>;
}

export interface KataGoAnalyzeUpdate {
  type: 'katago:analyze_update';
  id: number;
  ok: boolean;
  canceled?: boolean;
  backend?: string;
  modelName?: string;
  analysis?: KataGoAnalysisPayload;
  error?: string;
}

export interface KataGoAnalyzeResponse {
  type: 'katago:analyze_result';
  id: number;
  ok: boolean;
  canceled?: boolean;
  backend?: string;
  modelName?: string;
  analysis?: KataGoAnalysisPayload;
  error?: string;
}

export type KataGoWorkerRequest = KataGoInitRequest | KataGoAnalyzeRequest | KataGoQuickEvalRequest;
export type KataGoWorkerResponse = KataGoInitResponse | KataGoAnalyzeUpdate | KataGoAnalyzeResponse;
