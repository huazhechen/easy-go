import type { KataGoWorkerRequest, KataGoWorkerResponse } from './types';
import type { BoardState, GameRules, KataGoBackendPreference, Move, Player } from '../../types';
import { getWorkerConstructor } from '../../utils/browserWorker';

type Analysis = NonNullable<Extract<KataGoWorkerResponse, { type: 'katago:analyze_result' }>['analysis']>;

const takeLastMoves = (moves: Move[]): Move[] => (moves.length <= 5 ? moves : moves.slice(moves.length - 5));

type WorkerErrorEventLike = { error?: unknown; message?: string };

export class KataGoCanceledError extends Error {
  readonly canceled = true;

  constructor(message = 'Analysis canceled') {
    super(message);
    this.name = 'KataGoCanceledError';
  }
}

export const isKataGoCanceledError = (err: unknown): err is KataGoCanceledError => {
  if (!err || typeof err !== 'object') return false;
  if ((err as { canceled?: boolean }).canceled) return true;
  return err instanceof Error && err.name === 'KataGoCanceledError';
};

class KataGoEngineClient {
  private readonly worker: Worker;
  private nextId = 1;
  private pendingInit: { promise: Promise<void>; resolve: () => void; reject: (e: Error) => void } | null = null;
  private pending = new Map<
    number,
    { resolve: (a: Analysis) => void; reject: (e: Error) => void; onProgress?: (a: Analysis) => void }
  >();
  private backend: string | null = null;
  private modelName: string | null = null;
  private lastLoggedEngineLabel: string | null = null;
  private crashed: Error | null = null;

  constructor() {
    if (!getWorkerConstructor()) {
      throw new Error('Browser Worker API is unavailable; KataGo analysis cannot run in this browser context.');
    }

    try {
      this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    } catch (err) {
      throw formatWorkerError(err, 'KataGo worker failed to start');
    }

    this.worker.onmessage = (ev: MessageEvent<KataGoWorkerResponse>) => {
      // The worker is clearly alive again, so future requests are allowed through.
      this.crashed = null;
      const msg = ev.data;
      if (msg.type === 'katago:init_result') {
        const pendingInit = this.pendingInit;
        if (!pendingInit) return;
        this.pendingInit = null;
        if (msg.ok) {
          this.syncEngineInfo(msg);
        }
        if (!msg.ok) pendingInit.reject(new Error(msg.error ?? 'Init failed'));
        else pendingInit.resolve();
        return;
      }
      if (msg.type === 'katago:analyze_update') {
        const pending = this.pending.get(msg.id);
        if (!pending) return;
        if (msg.canceled || msg.error === 'canceled') return;
        this.syncEngineInfo(msg);
        if (!msg.ok || !msg.analysis) return;
        pending.onProgress?.(msg.analysis);
        return;
      }
      if (msg.type === 'katago:analyze_result') {
        const pending = this.pending.get(msg.id);
        if (!pending) return;
        this.pending.delete(msg.id);
        if (msg.canceled || msg.error === 'canceled') {
          pending.reject(new KataGoCanceledError());
          return;
        }
        this.syncEngineInfo(msg);
        if (!msg.ok || !msg.analysis) pending.reject(new Error(msg.error ?? 'Analysis failed'));
        else pending.resolve(msg.analysis);
        return;
      }
    };

    // Without these handlers a worker that dies mid-request (script load
    // failure, throw during module evaluation, browser reclaiming the worker)
    // would leave every pending promise unsettled forever, wedging the
    // analysis queue behind it.
    this.worker.onerror = (ev: WorkerErrorEventLike) => {
      const cause =
        ev.error instanceof Error
          ? ev.error
          : new Error(ev.message || 'unknown error');
      this.handleWorkerCrash(formatWorkerError(cause, 'KataGo worker crashed'));
    };
    this.worker.onmessageerror = () => {
      this.handleWorkerCrash(new Error('KataGo worker posted an undecodable message'));
    };
  }

  private handleWorkerCrash(error: Error): void {
    this.crashed = error;
    this.failAllPending(error);
  }

  private failAllPending(error: Error): void {
    if (this.pendingInit) {
      const { reject } = this.pendingInit;
      this.pendingInit = null;
      reject(error);
    }
    const pendingAnalyze = [...this.pending.values()];
    this.pending.clear();
    for (const entry of pendingAnalyze) entry.reject(error);
  }

  private rejectIfCrashed(): void {
    if (!this.crashed) return;
    throw this.crashed;
  }

  dispose(): void {
    this.failAllPending(new Error('KataGo engine client was disposed'));
    this.worker.terminate();
  }

  private postToWorker(message: KataGoWorkerRequest): void {
    try {
      this.worker.postMessage(message);
    } catch (err) {
      throw formatWorkerError(err, 'KataGo worker message failed');
    }
  }

  private syncEngineInfo(msg: { backend?: string; modelName?: string }): void {
    let changed = false;
    if (typeof msg.backend === 'string' && msg.backend !== this.backend) {
      this.backend = msg.backend;
      changed = true;
    }
    if (typeof msg.modelName === 'string' && msg.modelName !== this.modelName) {
      this.modelName = msg.modelName;
      changed = true;
    }
    if (!changed) return;

    const parts: string[] = [];
    if (this.backend) parts.push(this.backend);
    if (this.modelName) parts.push(this.modelName);
    const label = parts.join(' / ');
    if (!label || label === this.lastLoggedEngineLabel) return;
    this.lastLoggedEngineLabel = label;
    console.info(`[katago] engine: ${label}`);
  }

  getEngineInfo(): { backend: string | null; modelName: string | null } {
    return { backend: this.backend, modelName: this.modelName };
  }

  init(modelUrl: string, backend?: KataGoBackendPreference): Promise<void> {
    if (this.pendingInit) return this.pendingInit.promise;
    if (this.crashed) return Promise.reject(this.crashed);
    let resolve!: () => void;
    let reject!: (e: Error) => void;
    const promise = new Promise<void>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    this.pendingInit = { promise, resolve, reject };
    const initMsg: KataGoWorkerRequest = { type: 'katago:init', modelUrl, backend };
    try {
      this.postToWorker(initMsg);
    } catch (err) {
      this.pendingInit = null;
      reject(err instanceof Error ? err : new Error(String(err)));
    }
    return promise;
  }

  async analyze(args: {
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
    nnRandomize?: boolean;
    conservativePass?: boolean;
    visits?: number;
    maxTimeMs?: number;
    batchSize?: number;
    maxChildren?: number;
    reportDuringSearchEveryMs?: number;
    ownershipRefreshIntervalMs?: number;
    reuseTree?: boolean;
    ownershipMode?: 'root' | 'tree';
    rootPolicyTemperature?: number;
    fillDameBeforePass?: boolean;
    allowedMoves?: number[];
    onProgress?: (analysis: Analysis) => void;
  }): Promise<Analysis> {
    this.rejectIfCrashed();
    const id = this.nextId++;
    const req: KataGoWorkerRequest = {
      type: 'katago:analyze',
      id,
      positionId: args.positionId,
      parentPositionId: args.parentPositionId,
      positionKey: args.positionKey,
      parentPositionKey: args.parentPositionKey,
      modelUrl: args.modelUrl,
      backend: args.backend,
      board: args.board,
      previousBoard: args.previousBoard,
      previousPreviousBoard: args.previousPreviousBoard,
      currentPlayer: args.currentPlayer,
      moveHistory: takeLastMoves(args.moveHistory),
      komi: args.komi,
      rules: args.rules,
      topK: args.topK,
      analysisPvLen: args.analysisPvLen,
      includeMovesOwnership: args.includeMovesOwnership,
      wideRootNoise: args.wideRootNoise,
      nnRandomize: args.nnRandomize,
      conservativePass: args.conservativePass,
      visits: args.visits,
      maxTimeMs: args.maxTimeMs,
      batchSize: args.batchSize,
      maxChildren: args.maxChildren,
      reportDuringSearchEveryMs: args.reportDuringSearchEveryMs,
      ownershipRefreshIntervalMs: args.ownershipRefreshIntervalMs,
      reuseTree: args.reuseTree,
      ownershipMode: args.ownershipMode,
      rootPolicyTemperature: args.rootPolicyTemperature,
      fillDameBeforePass: args.fillDameBeforePass,
      allowedMoves: args.allowedMoves,
    };
    const promise = new Promise<Analysis>((resolve, reject) => {
      this.pending.set(id, { resolve, reject, onProgress: args.onProgress });
    });
    try {
      this.postToWorker(req);
    } catch (err) {
      this.pending.delete(id);
      throw err;
    }
    return promise;
  }

  /** One network forward pass with no search: raw win rate, score read, ownership. */
  async quickEval(args: {
    modelUrl: string;
    backend?: KataGoBackendPreference;
    board: BoardState;
    previousBoard?: BoardState;
    previousPreviousBoard?: BoardState;
    currentPlayer: Player;
    moveHistory: Move[];
    komi: number;
    rules?: GameRules;
  }): Promise<Analysis> {
    this.rejectIfCrashed();
    const id = this.nextId++;
    const req: Extract<KataGoWorkerRequest, { type: 'katago:quick_eval' }> = {
      type: 'katago:quick_eval',
      id,
      modelUrl: args.modelUrl,
      backend: args.backend,
      board: args.board,
      previousBoard: args.previousBoard,
      previousPreviousBoard: args.previousPreviousBoard,
      currentPlayer: args.currentPlayer,
      moveHistory: takeLastMoves(args.moveHistory),
      komi: args.komi,
      rules: args.rules,
    };
    const promise = new Promise<Analysis>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
    try {
      this.postToWorker(req);
    } catch (err) {
      this.pending.delete(id);
      throw err;
    }
    return promise;
  }

}

let singleton: KataGoEngineClient | null = null;

function formatWorkerError(err: unknown, prefix: string): Error {
  const message = err instanceof Error ? err.message : String(err);
  return new Error(message ? `${prefix}: ${message}` : prefix);
}

export function getKataGoEngineClient(): KataGoEngineClient {
  if (!singleton) singleton = new KataGoEngineClient();
  return singleton;
}

export function resetKataGoEngineClientForTests(): void {
  singleton?.dispose();
  singleton = null;
}
