export type BoardSize = 5 | 7 | 9 | 11 | 13 | 15 | 17 | 19;
export const DEFAULT_BOARD_SIZE: BoardSize = 19;

export type Player = 'black' | 'white';
export type Intersection = Player | null;
export type BoardState = Intersection[][];
export type GameRules = 'japanese' | 'chinese' | 'korean';
export type KataGoBackendPreference = 'wasm' | 'webgpu' | 'cpu';
export type FloatArray = Float32Array | number[];

export interface Move {
    x: number;
    y: number;
    player: Player;
}

export interface GameState {
  board: BoardState;
  currentPlayer: Player;
  moveHistory: Move[]; // Path from root to this state
  capturedBlack: number;
  capturedWhite: number;
  komi: number;
}

export interface CandidateMove {
  x: number;
  y: number;
  winRate: number; // 0-1
  winRateLost?: number; // positive = worse for side to play
  scoreLead: number;
  scoreSelfplay?: number;
  scoreStdev?: number;
  visits: number;
  edgeVisits?: number; // KataGo edgeVisits: what the root paid for this move
  noResultValue?: number; // KataGo noResultValue for this move's subtree
  weight?: number; // total weight behind the child
  edgeWeight?: number; // the share of it this edge bought
  pointsLost: number; // relative to root eval (KaTrain-like)
  relativePointsLost?: number; // relative to top move (KaTrain-like)
  order: number; // 0 for best move
  prior?: number; // policy prior probability (0..1)
  pv?: string[]; // principal variation, GTP coords (e.g. ["D4","Q16",...])
  pvVisits?: number[]; // visits behind each move of the pv (KataGo includePVVisits)
  pvEdgeVisits?: number[]; // visits this line paid for; never rises along the pv
  lcb?: number; // winrate-scale lower confidence bound, black perspective
  utilityLcb?: number; // utility-scale lower confidence bound, black perspective
  playSelectionValue?: number; // KataGo play selection weight, LCB adjusted
  utility?: number; // KataGo utilityAvg for this child, black perspective
  ownership?: FloatArray; // optional per-move ownership (KaTrain includeMovesOwnership)
}

export interface AnalysisResult {
  rootWinRate: number;
  rootScoreLead: number;
  rootScoreSelfplay?: number;
  rootScoreStdev?: number;
  rootVisits?: number;
  // KataGo rootInfo's raw* fields: what the network said before any search.
  rawWinRate?: number;
  rawScoreLead?: number;
  rawScoreSelfplay?: number;
  rawScoreSelfplayStdev?: number;
  rawNoResultProb?: number;
  rawStWrError?: number;
  rawStScoreError?: number;
  rawVarTimeLeft?: number;
  moves: CandidateMove[];
  territory: number[][]; // boardSize x boardSize grid, values -1 (white) to 1 (black)
  policy?: FloatArray; // len boardSize*boardSize + 1, illegal = -1, pass at last index
  ownershipStdev?: FloatArray; // len boardSize*boardSize
  ownershipMode?: 'root' | 'tree';
}

export interface GameNode {
  id: string;
  parent: GameNode | null;
  children: GameNode[];
  move: Move | null;
  gameState: GameState;
  analysis?: AnalysisResult | null;
  analysisVisitsRequested?: number; // KaTrain-like: requested visits for this node analysis.
  properties?: Record<string, string[]>;
}

export type AppLocaleId = 'en' | 'zh' | 'zh-TW' | 'ko' | 'ja' | 'fr' | 'de' | 'es' | 'it' | 'uk' | 'ru' | 'pt' | 'vi';

export interface GameSettings {
  appLocale: AppLocaleId;
  soundEnabled: boolean;
  defaultBoardSize: BoardSize;
  defaultHandicap: number;
  gameRules: GameRules; // KataGo rules preset (KaTrain default: japanese)
  analysisShowChildren: boolean; // Q
  analysisShowEval: boolean; // W
  analysisShowHints: boolean; // E
  analysisShowPolicy: boolean; // R
  analysisShowOwnership: boolean; // T
  katagoModelUrl: string;
  katagoBackend: KataGoBackendPreference;
  katagoVisits: number;
  katagoMaxTimeMs: number;
  katagoBatchSize: number;
  katagoMaxChildren: number;
  katagoTopK: number;
  katagoReuseTree: boolean;
  katagoOwnershipMode: 'root' | 'tree';
  katagoWideRootNoise: number; // KataGo/KaTrain wideRootNoise
  katagoRootPolicyTemperature: number; // KataGo rootPolicyTemperature; > 1 widens the search
  katagoAnalysisPvLen: number; // KataGo analysisPVLen (moves after the first)
  katagoNnRandomize: boolean; // KataGo nnRandomize (random symmetries)
  katagoConservativePass: boolean; // KataGo conservativePass (KaTrain default: true)
  katagoFillDameBeforePass: boolean; // KataGo fillDameBeforePass, territory scoring only
}
