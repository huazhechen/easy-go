import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { FaCalculator, FaFlag, FaLightbulb, FaRedo, FaUndo } from 'react-icons/fa';

type HintMode = 'off' | 'peek' | 'always';

function LogoMark({ className = '' }: { className?: string }) {
  return (
    <svg className={`logo-mark ${className}`} viewBox="0 0 48 48" aria-label="Easy Go logo" role="img">
      <rect width="48" height="48" rx="9" fill="#e9bd7f" />
      <circle cx="15" cy="15" r="11" fill="#111715" />
      <circle cx="33" cy="15" r="11" fill="#f8fafc" />
      <circle cx="33" cy="33" r="11" fill="#111715" />
      <circle cx="15" cy="33" r="11" fill="#f8fafc" />
    </svg>
  );
}
import { useGameStore } from '../store/gameStore';
import type { BoardSize, CandidateMove, GameSettings } from '../types';
import { getHoshiPoints } from '../utils/boardSize';
import { isValidMove } from '../utils/gameLogic';
import {
  DEFAULT_MODEL_TIER_ID,
  getModelTier,
  isKnownModelTierId,
  KATAGO_MODEL_TIERS,
  type KataGoModelTier,
  type KataGoModelTierId,
} from '../engine/katago/modelDefaults';
import {
  downloadModelChunks,
  downloadModelWithProgress,
  modelCacheKeyForTier,
  normalizeModelBytes,
  objectUrlForModelBytes,
  pruneModelCache,
  resolveTierModelUrl,
  verifyModelMd5,
  writeCachedModel,
} from '../engine/katago/modelCache';
import { publicUrl } from '../utils/publicUrl';
import { readLocalStorage, writeLocalStorage } from '../utils/storage';

const SIZES = [
  { size: 5, name: '启蒙枰' }, { size: 7, name: '斗星枰' },
  { size: 9, name: '方圆枰' }, { size: 11, name: '玲珑枰' },
  { size: 13, name: '星野枰' }, { size: 15, name: '中和枰' },
  { size: 17, name: '古韵枰' }, { size: 19, name: '标准枰' },
] as const;
const MODEL_TIER_STORAGE_KEY = 'easy-go:model-tier';
const THINKING_STORAGE_KEY = 'easy-go:model-thinking-ms';

function formatModelBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatThinkingMs(ms: number): string {
  return `${ms / 1000}秒`;
}

function formatThinkingSeconds(ms: number): string {
  return `${ms / 1000}s`;
}

const defaultThinkingForTier = (tier: KataGoModelTier | null | undefined): number => {
  return tier?.defaultThinkingMs ?? 2000;
};

// Per-tier thinking time is stored independently, so choosing 10s on B6 never
// changes what is selected on B10 or B18.
const clampThinkingMs = (ms: number, tier: KataGoModelTier): number => {
  const stepped = Math.round(ms / tier.thinkingStepMs) * tier.thinkingStepMs;
  return Math.min(tier.maxThinkingMs, Math.max(tier.minThinkingMs, stepped));
};

const readStoredThinkingMs = (): Record<KataGoModelTierId, number> => {
  const defaults: Record<KataGoModelTierId, number> = {
    b6: defaultThinkingForTier(getModelTier('b6')),
    b10: defaultThinkingForTier(getModelTier('b10')),
    b18: defaultThinkingForTier(getModelTier('b18')),
  };
  try {
    const raw = readLocalStorage(THINKING_STORAGE_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    for (const tier of KATAGO_MODEL_TIERS) {
      const value = parsed[tier.id];
      if (typeof value === 'number' && Number.isFinite(value)) defaults[tier.id] = clampThinkingMs(value, tier);
    }
  } catch {
    // Keep defaults.
  }
  return defaults;
};

const columnLabel = (index: number): string => {
  // Go coordinates skip the letter I to avoid confusion with J.
  const letterCode = 65 + index + (index >= 8 ? 1 : 0);
  return String.fromCharCode(letterCode);
};

function percent(value: number) {
  if (value >= 0.999) return '∞';
  const rounded = Math.round(value * 100);
  return `${Math.min(99, rounded)}`;
}

function formatIterations(value: number): string {
  if (value < 1000) return String(Math.max(0, Math.floor(value)));
  if (value < 1_000_000) return `${(value / 1000).toFixed(1).replace(/\.0$/, '')}K`;
  return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
}

export function BattleApp() {
  const {
    board,
    currentNode,
    currentPlayer,
    moveHistory,
    capturedBlack,
    capturedWhite,
    analysisData,
    settings,
    engineStatus,
    isAiThinking,
    aiColor,
    isAiPlaying,
    isAnalysisMode,
    isContinuousAnalysis,
    startNewGame,
    updateSettings,
    toggleAi,
    setAiPlayer,
    toggleAnalysisMode,
    playMove,
    passTurn,
    runAnalysis,
    undoMove,
    toggleContinuousAnalysis,
  } = useGameStore((state) => ({
    board: state.board,
    currentNode: state.currentNode,
    currentPlayer: state.currentPlayer,
    moveHistory: state.moveHistory,
    capturedBlack: state.capturedBlack,
    capturedWhite: state.capturedWhite,
    analysisData: state.analysisData,
    settings: state.settings,
    engineStatus: state.engineStatus,
    engineError: state.engineError,
    isAiThinking: state.isAiThinking,
    aiColor: state.aiColor,
    isAiPlaying: state.isAiPlaying,
    isAnalysisMode: state.isAnalysisMode,
    isContinuousAnalysis: state.isContinuousAnalysis,
    startNewGame: state.startNewGame,
    updateSettings: state.updateSettings,
    toggleAi: state.toggleAi,
    setAiPlayer: state.setAiPlayer,
    toggleAnalysisMode: state.toggleAnalysisMode,
    toggleContinuousAnalysis: state.toggleContinuousAnalysis,
    playMove: state.playMove,
    passTurn: state.passTurn,
    runAnalysis: state.runAnalysis,
    undoMove: state.undoMove,
  }));
  const [size, setSize] = useState<number>(9);
  const [hintMode, setHintMode] = useState<HintMode>('off');
  const [showNewGame, setShowNewGame] = useState(false);
  const [showScore, setShowScore] = useState(false);
  const [showTerritory, setShowTerritory] = useState(false);
  const [scoreLoading, setScoreLoading] = useState(false);
  const [hintLoading, setHintLoading] = useState(false);
  const [scoreNotice, setScoreNotice] = useState<{ black: string; white: string; leader: string } | null>(null);
  const [scoreCache, setScoreCache] = useState<{ black: string; white: string; leader: string } | null>(null);
  const [humanColor, setHumanColor] = useState<'black' | 'white'>('black');
  const [thinkingMsByTier, setThinkingMsByTier] = useState<Record<KataGoModelTierId, number>>(readStoredThinkingMs);
  const [draftThinkingMsByTier, setDraftThinkingMsByTier] = useState<Record<KataGoModelTierId, number>>(readStoredThinkingMs);
  const [selfPlayMode, setSelfPlayMode] = useState(false);
  const [draftSize, setDraftSize] = useState(9);
  const [draftHumanColor, setDraftHumanColor] = useState<'black' | 'white'>('black');
  const [draftSelfPlayMode, setDraftSelfPlayMode] = useState(false);
  const [notice, setNotice] = useState('');
  const [hoverPoint, setHoverPoint] = useState<{ x: number; y: number } | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [scanlineDone, setScanlineDone] = useState(false);
  const [selectedModelTier, setSelectedModelTier] = useState<KataGoModelTierId>(() => {
    const stored = readLocalStorage(MODEL_TIER_STORAGE_KEY);
    return isKnownModelTierId(stored) ? stored : DEFAULT_MODEL_TIER_ID;
  });
  const [draftModelTier, setDraftModelTier] = useState<KataGoModelTierId>(() => {
    const stored = readLocalStorage(MODEL_TIER_STORAGE_KEY);
    return isKnownModelTierId(stored) ? stored : DEFAULT_MODEL_TIER_ID;
  });
  const [showModelDownload, setShowModelDownload] = useState(false);
  const [showForceRedownload, setShowForceRedownload] = useState(false);
  const [downloadPhase, setDownloadPhase] = useState<'confirm' | 'downloading' | 'done' | 'error'>('confirm');
  const [downloadProgress, setDownloadProgress] = useState({ loaded: 0, total: 0 });
  const [downloadError, setDownloadError] = useState('');
  const downloadAbortRef = useRef<AbortController | null>(null);
  const b18BlobUrlRef = useRef<string | null>(null);
  const didInitialize = useRef(false);
  const prevMoveCountRef = useRef(moveHistory.length);
  const boardSize = board.length;
  const topMoves = useMemo(() => (analysisData?.moves ?? []).slice(0, 3), [analysisData]);
  const recommendationIterations = analysisData?.rootVisits ?? currentNode.analysisVisitsRequested ?? 0;
  // Analysis win rates are always black-perspective; the board shows them
  // from the side to move's point of view.
  const hintRates = topMoves.map((move) => (currentPlayer === 'white' ? 1 - move.winRate : move.winRate));
  const minHintRate = hintRates.length ? Math.min(...hintRates) : 0;
  const maxHintRate = hintRates.length ? Math.max(...hintRates) : 1;
  const selfPlay = selfPlayMode;
  const hintsVisible = hintMode !== 'off';
  const selectedModelTierConfig = getModelTier(selectedModelTier);
  const thinkingMs = thinkingMsByTier[selectedModelTier] ?? defaultThinkingForTier(selectedModelTierConfig);
  const selectedModelLabel = selectedModelTierConfig?.label ?? selectedModelTier;

  useEffect(() => {
    // Keep recommendations continuously improving independently of the
    // opponent's thinking preset.
    if (!isContinuousAnalysis) toggleContinuousAnalysis(true);
  }, [isContinuousAnalysis, toggleContinuousAnalysis]);

  useEffect(() => {
    const timer = window.setTimeout(() => setInitialLoading(false), 3000);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (didInitialize.current) return;
    didInitialize.current = true;
    updateSettings({ katagoMaxTimeMs: thinkingMs, katagoBatchSize: 1 });
    // Always pass through the default new-game path on a fresh page load.
    // The initial store already has a 9x9 board, so checking only the board
    // size skipped this lifecycle and left the first analysis waiting for a
    // later move to change the position.
    startNewGame({ komi: 6.5, rules: 'japanese', boardSize: 9, handicap: 0 });
    window.setTimeout(() => {
      const state = useGameStore.getState();
      if (!selfPlayMode && !state.isAiPlaying) state.toggleAi(humanColor === 'black' ? 'white' : 'black');
      if (!state.isContinuousAnalysis) state.toggleContinuousAnalysis(true);
    }, 0);
  }, [board.length, humanColor, selfPlayMode, startNewGame, thinkingMs, updateSettings]);

  useEffect(() => {
    if (!selfPlayMode && !isAiPlaying) toggleAi(humanColor === 'black' ? 'white' : 'black');
  }, [humanColor, isAiPlaying, selfPlayMode, toggleAi]);

  // Recommendations calculate automatically, but remain hidden until the
  // player explicitly enables their display.
  useEffect(() => {
    setHintLoading(false);
    setScanlineDone(false);
    setScoreNotice(null);
    setScoreCache(null);
    setShowTerritory(false);
    setShowScore(false);
  }, [currentNode.id, currentPlayer]);

  // "仅本手" hints expire as soon as a new move is played; history
  // navigation and undos leave the peek active.
  useEffect(() => {
    if (hintMode === 'peek' && moveHistory.length > prevMoveCountRef.current) {
      setHintMode('off');
    }
    prevMoveCountRef.current = moveHistory.length;
  }, [hintMode, moveHistory.length]);

  useEffect(() => {
    if (!isAiThinking || !hintLoading) return;
    setHintLoading(false);
  }, [hintLoading, isAiThinking]);

  useEffect(() => {
    if (hintLoading && analysisData?.moves?.length) setHintLoading(false);
  }, [analysisData, hintLoading]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 2600);
    return () => window.clearTimeout(timer);
  }, [notice]);

  // Restore the last selected model tier. b6/b10 are served straight from the
  // site; b18 is rebuilt into a blob URL from the IndexedDB cache so the 96 MB
  // file is never downloaded again (unless the cache version changes).
  useEffect(() => {
    void (async () => {
      await pruneModelCache();
      const stored = readLocalStorage(MODEL_TIER_STORAGE_KEY);
      let tier = isKnownModelTierId(stored) ? stored : DEFAULT_MODEL_TIER_ID;
      let url: string | null = null;
      if (tier === 'b18') {
        url = await resolveTierModelUrl('b18');
        if (url) b18BlobUrlRef.current = url;
        // The cached copy is gone (cleared storage or version bump): fall back
        // to the default b10 for gameplay; b18 can be downloaded on demand.
        if (!url) {
          tier = DEFAULT_MODEL_TIER_ID;
          writeLocalStorage(MODEL_TIER_STORAGE_KEY, tier);
        }
      }
      if (!url) url = await resolveTierModelUrl(tier);
      const tierConfig = getModelTier(tier);
      setSelectedModelTier(tier);
      setDraftModelTier(tier);
      const state = useGameStore.getState();
      const tierThinkingMs = readStoredThinkingMs()[tier] ?? defaultThinkingForTier(tierConfig);
      setDraftThinkingMsByTier((prev) => ({ ...prev, [tier]: tierThinkingMs }));
      if (url && (state.settings.katagoModelUrl !== url || state.settings.katagoMaxTimeMs !== tierThinkingMs)) {
        const patch: Partial<GameSettings> = { katagoModelUrl: url };
        if (state.settings.katagoMaxTimeMs !== tierThinkingMs) patch.katagoMaxTimeMs = tierThinkingMs;
        state.updateSettings(patch);
      }
    })();
  }, []);

  useEffect(
    () => () => {
      downloadAbortRef.current?.abort();
      if (b18BlobUrlRef.current) URL.revokeObjectURL(b18BlobUrlRef.current);
    },
    []
  );

  const newGame = async (nextSize = draftSize, color = draftHumanColor) => {
    const engineSize = nextSize as BoardSize;
    if (draftModelTier !== selectedModelTier) {
      await switchModel(draftModelTier);
      if (useGameStore.getState().settings.katagoModelUrl === settings.katagoModelUrl && draftModelTier === 'b18') return;
    }
    const draftTierConfig = getModelTier(draftModelTier);
    const thinkingMsValue = draftThinkingMsByTier[draftModelTier] ?? defaultThinkingForTier(draftTierConfig);
    setThinkingMsByTier((prev) => {
      const next = { ...prev, [draftModelTier]: thinkingMsValue };
      writeLocalStorage(THINKING_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
    setSelectedModelTier(draftModelTier);
    writeLocalStorage(MODEL_TIER_STORAGE_KEY, draftModelTier);
    updateSettings({ katagoMaxTimeMs: thinkingMsValue, katagoBatchSize: 1 });
    startNewGame({ komi: 6.5, rules: 'japanese', boardSize: engineSize, handicap: 0 });
    setSize(nextSize);
    setHumanColor(color);
    setShowScore(false);
    setShowNewGame(false);
    const ai = color === 'black' ? 'white' : 'black';
    if (draftSelfPlayMode) {
      setSelfPlayMode(true);
      setAiPlayer(ai, false);
      updateSettings({ katagoMaxTimeMs: 2000, katagoBatchSize: 1 });
    } else {
      setSelfPlayMode(false);
      toggleAi(ai);
    }
    setNotice(`${nextSize} 路棋盘已准备好`);
  };

  const cycleHintMode = () => {
    const next: HintMode = hintMode === 'off' ? 'peek' : hintMode === 'peek' ? 'always' : 'off';
    setHintMode(next);
    if (next !== 'off' && !(analysisData?.moves?.length) && !isAiThinking && !hintLoading) {
      setHintLoading(true);
      if (!isAnalysisMode) toggleAnalysisMode();
    }
  };

  const handlePoint = (x: number, y: number) => {
    if ((!selfPlay && currentPlayer === aiColor) || isAiThinking || board[y]?.[x]) return;
    playMove(x, y);
  };
  const opponentTurn = !selfPlay && currentPlayer === aiColor;
  // Show a translucent stone of the side to move wherever a real click would
  // actually place one: the point must be empty, it must be the human's turn,
  // and the move must pass the same legality checks playMove uses.
  const hoverStoneColor: 'black' | 'white' | null = (() => {
    if (!hoverPoint || opponentTurn || isAiThinking) return null;
    const { x, y } = hoverPoint;
    if (board[y]?.[x]) return null;
    if (!isValidMove(board, x, y, currentPlayer, currentNode.parent?.gameState.board)) return null;
    return currentPlayer;
  })();
  const showThinkingScanline = !scanlineDone && (isAiThinking || opponentTurn);
  const lastMoveWasPass = moveHistory.at(-1)?.x === -1 && moveHistory.at(-1)?.y === -1;
  const consecutivePasses = moveHistory.length >= 2
    && moveHistory.at(-2)?.x === -1 && moveHistory.at(-2)?.y === -1
    && lastMoveWasPass;
  const handlePass = () => {
    if (!selfPlay && (currentPlayer === aiColor || isAiThinking)) return;
    if (lastMoveWasPass) {
      setShowTerritory(true);
      setShowScore(true);
      return;
    }
    passTurn();
  };

  const switchModel = async (tierId: KataGoModelTierId) => {
    if (tierId === selectedModelTier) {
      // B18 is already downloaded and selected: clicking it again offers a
      // forced re-download instead of silently doing nothing.
      if (tierId === 'b18') setShowForceRedownload(true);
      return;
    }
    const tier = getModelTier(tierId);
    if (!tier) return;

    let url: string | null;
    if (tierId === 'b18') {
      url = b18BlobUrlRef.current ?? (await resolveTierModelUrl('b18'));
      if (!url) {
        setDownloadPhase('confirm');
        setDownloadProgress({ loaded: 0, total: 0 });
        setDownloadError('');
        setShowModelDownload(true);
        return;
      }
      b18BlobUrlRef.current = url;
    } else {
      url = await resolveTierModelUrl(tierId);
    }
    if (!url) return;

    // Switching tiers resets the thinking time to that tier's default middle
    // value (B6 5s / B10 10s / B18 30s) and applies it to the engine.
    const tierThinkingMs = defaultThinkingForTier(tier);
    setThinkingMsByTier((prev) => {
      const next = { ...prev, [tierId]: tierThinkingMs };
      writeLocalStorage(THINKING_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
    setSelectedModelTier(tierId);
    writeLocalStorage(MODEL_TIER_STORAGE_KEY, tierId);
    const state = useGameStore.getState();
    const patch: Partial<GameSettings> = { katagoModelUrl: url };
    if (state.settings.katagoMaxTimeMs !== tierThinkingMs) patch.katagoMaxTimeMs = tierThinkingMs;
    state.updateSettings(patch);
    setNotice(tier.requiresDownload ? 'B18 模型已启用' : `${tier.label} 模型已选择`);
  };

  const selectThinkingMs = (ms: number) => {
    setDraftThinkingMsByTier((prev) => {
      const next = { ...prev, [draftModelTier]: ms };
      return next;
    });
  };

  const startModelDownload = async () => {
    const tier = getModelTier('b18');
    if (!tier) return;
    const controller = new AbortController();
    downloadAbortRef.current = controller;
    setDownloadPhase('downloading');
    setDownloadProgress({ loaded: 0, total: 0 });
    setDownloadError('');
    try {
      // The model is hosted on this site as ≤24 MiB chunks (so Cloudflare's
      // 25 MiB per-file limit can serve it); fetch them in order, concatenate,
      // then normalize and checksum the result before caching.
      const buffer =
        tier.chunks && tier.chunks.length > 0
          ? await downloadModelChunks(
              tier.chunks.map((chunk) => ({ url: publicUrl(chunk.path), bytes: chunk.bytes })),
              (loaded, total) => setDownloadProgress({ loaded, total }),
              controller.signal
            )
          : await downloadModelWithProgress(
              publicUrl(tier.localPath),
              (loaded, total) => setDownloadProgress({ loaded, total }),
              controller.signal,
              tier.decompressedBytes
            );
      // Hosts may transparently decompress the .gz response, so normalize to
      // the .bin bytes before checksumming and caching.
      const normalized = normalizeModelBytes(new Uint8Array(buffer));
      if (!verifyModelMd5(normalized, tier.md5)) {
        throw new Error('模型校验失败：下载内容与官方 MD5 不一致，请重试');
      }
      const cached = await writeCachedModel(modelCacheKeyForTier('b18'), normalized);
      const blobUrl = objectUrlForModelBytes(normalized);
      if (b18BlobUrlRef.current) URL.revokeObjectURL(b18BlobUrlRef.current);
      b18BlobUrlRef.current = blobUrl;
      setSelectedModelTier('b18');
      writeLocalStorage(MODEL_TIER_STORAGE_KEY, 'b18');
      const state = useGameStore.getState();
      if (state.settings.katagoModelUrl !== blobUrl) {
        state.updateSettings({ katagoModelUrl: blobUrl });
      }
      setDownloadPhase('done');
      if (!cached) setDownloadError('模型已下载，但未能写入本地缓存，本次会话仍可使用。');
    } catch (err) {
      if (controller.signal.aborted) {
        setDownloadPhase('confirm');
      } else {
        setDownloadPhase('error');
        setDownloadError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      downloadAbortRef.current = null;
    }
  };

  const cancelModelDownload = () => {
    downloadAbortRef.current?.abort();
    setShowModelDownload(false);
  };

  const downloadPercent = (): number => {
    if (downloadPhase !== 'downloading') return downloadProgress.loaded > 0 ? 100 : 0;
    if (downloadProgress.total > 0) return Math.min(100, Math.round((downloadProgress.loaded / downloadProgress.total) * 100));
    return downloadProgress.loaded > 0 ? 100 : 0;
  };

  useEffect(() => {
    if (!consecutivePasses) return;
    setShowTerritory(true);
    setShowScore(true);
  }, [consecutivePasses]);

  const hintAt = (x: number, y: number): CandidateMove | undefined =>
    topMoves.find((move) => move.x === x && move.y === y);
  const hoshiPoints = getHoshiPoints(boardSize as BoardSize);
  if ((boardSize === 5 || boardSize === 7) && hoshiPoints.length === 0) hoshiPoints.push([Math.floor(boardSize / 2), Math.floor(boardSize / 2)]);
  const hoshi = new Set(hoshiPoints.map(([x, y]) => `${x}-${y}`));
  const territoryValues = analysisData?.territory?.flat() ?? [];
  const blackPoints = territoryValues.length ? territoryValues.filter((value) => value >= 0).length + capturedWhite : 0;
  const whitePoints = territoryValues.length ? territoryValues.filter((value) => value < 0).length + capturedBlack + 6.5 : 6.5;
  const [previousWinRate, setPreviousWinRate] = useState(0.5);
  const rawWinRate = analysisData?.rootWinRate ?? currentNode.analysis?.rootWinRate;
  // KataGo can publish an initial 50% placeholder before the first search
  // visits arrive. Treat that frame as "refreshing" so it cannot overwrite the
  // previous position's useful estimate.
  const analyzedWinRate = typeof rawWinRate === 'number'
    && Number.isFinite(rawWinRate)
    && (!analysisData || analysisData.rootVisits == null || analysisData.rootVisits > 1)
    ? rawWinRate
    : null;
  useEffect(() => {
    if (typeof analyzedWinRate !== 'number' || !Number.isFinite(analyzedWinRate)) return;
    const next = Math.max(0, Math.min(1, analyzedWinRate));
    const timer = window.setTimeout(() => setPreviousWinRate(next), 0);
    return () => window.clearTimeout(timer);
  }, [analyzedWinRate]);
  useEffect(() => {
    if (currentNode.parent) return;
    const timer = window.setTimeout(() => setPreviousWinRate(0.5), 0);
    return () => window.clearTimeout(timer);
  }, [currentNode.id, currentNode.parent]);
  // A newly played node has no analysis for a short time. Keep the last useful
  // estimate visible until KataGo returns the new position's result.
  const displayWinRate = typeof analyzedWinRate === 'number' && Number.isFinite(analyzedWinRate)
    ? Math.max(0, Math.min(1, analyzedWinRate))
    : previousWinRate;
  // Keep a consistent outer margin on every side: 2.4% of the board plus half
  // the stone width (stones occupy about 84% of one grid cell).
  // Solve inset = 2.4% + halfStone, where the stone radius is based on the
  // actual CSS cell width (available span / boardSize), not boardSize - 1.
  const pointInset = (2.4 + 42 / boardSize) / (1 + 0.84 / boardSize);
  const pointSpan = 100 - pointInset * 2;
  const aiThinkingName = `${selectedModelLabel}-${formatThinkingMs(thinkingMs)}`;
  const blackSideName = selfPlay ? '黑' : humanColor === 'black' ? '你' : aiThinkingName;
  const whiteSideName = selfPlay ? '白' : humanColor === 'white' ? '你' : aiThinkingName;
  const undoTwoMoves = () => {
    if (!moveHistory.length) return;
    undoMove();
  };
  const openScore = async () => {
    if (scoreNotice) {
      setScoreNotice(null);
      setShowTerritory(false);
      return;
    }
    if (scoreCache) {
      setScoreNotice(scoreCache);
      setShowTerritory(true);
      return;
    }
    if (!isAnalysisMode) toggleAnalysisMode();
    setScoreLoading(true);
    await runAnalysis({ force: true, visits: 80, topK: 3, maxChildren: boardSize * boardSize, analysisPvLen: 4 });
    const latest = useGameStore.getState();
    const territory = latest.analysisData?.territory?.flat() ?? [];
    const black = territory.length ? territory.filter((value) => value >= 0).length + latest.capturedWhite : 0;
    const white = territory.length ? territory.filter((value) => value < 0).length + latest.capturedBlack + latest.komi : latest.komi;
    const leader = black >= white ? `黑方领先 ${(black - white).toFixed(1)} 目` : `白方领先 ${(white - black).toFixed(1)} 目`;
    const result = { black: `黑 ${black.toFixed(1)} 目`, white: `白 ${white.toFixed(1)} 目`, leader };
    setScoreCache(result);
    setScoreNotice(result);
    setShowTerritory(true);
    setScoreLoading(false);
  };

  return (
    <main className="battle-shell">
      <header className="battle-header">
        <div>
          <h1><LogoMark />EASY GO</h1>
        </div>
        <div className="header-tools"><button type="button" className="new-game-header" onClick={() => { setDraftSize(size); setDraftHumanColor(humanColor); setDraftSelfPlayMode(selfPlayMode); setDraftModelTier(selectedModelTier); setDraftThinkingMsByTier(thinkingMsByTier); setShowNewGame(true); }}><FaRedo />新对局</button></div>
      </header>

      <section className="match-card" style={{ '--match-split-num': displayWinRate } as CSSProperties}>
        <span className="stone-avatar black-stone">
          {currentPlayer === 'black' && <span className={selfPlay || humanColor === 'black' ? 'turn-mark active' : 'turn-mark thinking'} aria-label="黑方回合" />}
        </span>
        <div className="match-side"><strong>{blackSideName}</strong><small className="match-captures">提子: {capturedWhite}</small></div>
        <div className="match-score">
          <div className="match-rate-track" aria-hidden="true">
            <span className="match-rate-track-black" />
            <span className="match-rate-track-white" />
          </div>
          <div className="match-rate-values" aria-label={`黑方 ${Math.round(displayWinRate * 100)}%，白方 ${Math.round((1 - displayWinRate) * 100)}%`}>
            <strong className="match-rate-black">{Math.round(displayWinRate * 100)}</strong>
            <strong className="match-rate-white">{Math.round((1 - displayWinRate) * 100)}</strong>
          </div>
        </div>
        <div className="match-side right"><strong>{whiteSideName}</strong><small className="match-captures">提子: {capturedBlack}</small></div>
        <span className="stone-avatar white-stone">
          {currentPlayer === 'white' && <span className={selfPlay || humanColor === 'white' ? 'turn-mark active' : 'turn-mark thinking'} aria-label="白方回合" />}
        </span>
      </section>

      <section className="board-wrap" aria-label="围棋棋盘">
        <div className="board-grid" onMouseLeave={() => setHoverPoint(null)} style={{ '--board-size': boardSize, '--board-inset-left': `${pointInset}%`, '--board-inset-top': `${pointInset}%`, '--board-inset-right': `${pointInset}%`, '--board-inset-bottom': `${pointInset}%` } as CSSProperties}>
          {Array.from({ length: boardSize }, (_, index) => <span key={`h-${index}`} className="board-line horizontal" style={{ left: `${pointInset}%`, width: `${pointSpan}%`, top: `${pointInset + (index / (boardSize - 1)) * pointSpan}%` }} />)}
          {Array.from({ length: boardSize }, (_, index) => <span key={`v-${index}`} className="board-line vertical" style={{ top: `${pointInset}%`, height: `${pointSpan}%`, left: `${pointInset + (index / (boardSize - 1)) * pointSpan}%` }} />)}
          {showThinkingScanline && (
            <span
              className="ai-thinking-scanline"
              data-ai-thinking-scanline="true"
              aria-hidden="true"
              onAnimationEnd={() => setScanlineDone(true)}
              // Keep the scanline slightly ahead of the engine timeout so the
              // animation reaches its end after the result is handed back.
              style={{ animationDuration: `${Math.max(25, settings.katagoMaxTimeMs) * 1.1}ms` }}
            ></span>
          )}
          <div className="board-coordinates board-coordinates-top" aria-hidden="true">
            {Array.from({ length: boardSize }, (_, index) => (
              <span key={`coord-x-${index}`} style={{ left: `${pointInset + (index / (boardSize - 1)) * pointSpan}%` }}>{columnLabel(index)}</span>
            ))}
          </div>
          <div className="board-coordinates board-coordinates-left" aria-hidden="true">
            {Array.from({ length: boardSize }, (_, index) => (
              <span key={`coord-y-${index}`} style={{ top: `${pointInset + (index / (boardSize - 1)) * pointSpan}%` }}>{boardSize - index}</span>
            ))}
          </div>
          {Array.from({ length: boardSize * boardSize }, (_, index) => {
            const x = index % boardSize;
            const y = Math.floor(index / boardSize);
            const stone = board[y]?.[x];
            const hint = hintsVisible ? hintAt(x, y) : undefined;
            const hintSideWinRate = hint ? (currentPlayer === 'white' ? 1 - hint.winRate : hint.winRate) : 0;
            const hintAlpha = hint
              ? 0.35 + (maxHintRate === minHintRate ? 0.6 : ((hintSideWinRate - minHintRate) / (maxHintRate - minHintRate)) * 0.6)
              : 0;
            const territoryValue = analysisData?.territory?.[y]?.[x];
            const territoryOwner = typeof territoryValue === 'number' ? territoryValue >= 0 ? 'black' : 'white' : null;
            const pointStyle = { left: `${pointInset + (x / (boardSize - 1)) * pointSpan}%`, top: `${pointInset + (y / (boardSize - 1)) * pointSpan}%` };
            return <button key={`${x}-${y}`} style={pointStyle} className={`intersection ${hoshi.has(`${x}-${y}`) ? 'hoshi' : ''}`} onClick={() => handlePoint(x, y)} onMouseEnter={() => setHoverPoint({ x, y })} onFocus={() => setHoverPoint({ x, y })} onBlur={() => setHoverPoint((prev) => (prev?.x === x && prev?.y === y ? null : prev))} aria-label={`${x + 1},${y + 1}`}>
              {hint && !stone && <span className={`hint-dot rank-${topMoves.findIndex((move) => move === hint)}`} style={{ backgroundColor: `rgba(211,47,47,${hintAlpha.toFixed(3)})` }}>{percent(hintSideWinRate)}</span>}
              {stone && <span className={`board-stone ${stone === 'black' ? 'black-stone' : 'white-stone'}`} />}
              {currentNode.move?.x === x && currentNode.move?.y === y && <span className="last-move-marker" />}
              {showTerritory && territoryOwner && !hint && (!stone || territoryOwner !== stone) && <span className={`score-mark ${territoryOwner}`} />}
            </button>;
          })}
          {hoverStoneColor && hoverPoint && (
            <span className="hover-stone-hitbox" style={{ left: `${pointInset + (hoverPoint.x / (boardSize - 1)) * pointSpan}%`, top: `${pointInset + (hoverPoint.y / (boardSize - 1)) * pointSpan}%` }} aria-hidden="true">
              <span className={`hover-stone ${hoverStoneColor}-stone`} />
            </span>
          )}
        </div>
        {downloadPhase === 'downloading' && <div className="board-loading"><div className="loading-track"><i /></div><span>模型下载中（B18）{downloadPercent()}%</span></div>}
        {downloadPhase !== 'downloading' && ((initialLoading && !isAiThinking && engineStatus !== 'ready' && engineStatus !== 'error') || scoreLoading || (hintMode !== 'off' && hintLoading)) && <div className="board-loading"><div className="loading-track"><i /></div><span>{scoreLoading ? 'AI 判定中…' : hintLoading ? 'AI 计算中…' : `模型加载中（${selectedModelLabel}）…`}</span></div>}
      </section>

      <div className="battle-actions"><button type="button" onClick={undoTwoMoves} disabled={!moveHistory.length}><FaUndo />悔棋</button><button type="button" onClick={handlePass} disabled={!selfPlay && (opponentTurn || isAiThinking)}><FaFlag />{lastMoveWasPass ? '终局' : '停着'}</button><button type="button" onClick={() => void openScore()} disabled={!selfPlay && (opponentTurn || isAiThinking)} className={scoreCache && showTerritory ? 'score-toggle active' : 'score-toggle'}><FaCalculator />局势判定</button><button type="button" className={`recommendation-toggle${hintMode === 'always' ? ' active' : hintMode === 'peek' ? ' peek' : ''}`} aria-pressed={hintMode !== 'off'} aria-label={`推荐落点：${hintMode === 'off' ? '不显示' : hintMode === 'peek' ? '仅本手' : '持续显示'}`} onClick={cycleHintMode} disabled={!selfPlay && (opponentTurn || isAiThinking)}><FaLightbulb /><span className={hintMode === 'peek' ? 'recommendation-label flashing' : 'recommendation-label'}>推荐落点（{formatIterations(recommendationIterations)}）</span>{isContinuousAnalysis && engineStatus === 'loading' && !(analysisData?.moves?.length) && <span className="thinking-spinner" aria-label="推荐落点计算中" />}</button></div>
      {showScore && <div className="dialog-backdrop"><section className="result-dialog"><strong>终局结果</strong><p>{blackPoints > whitePoints ? `黑胜 ${(blackPoints - whitePoints).toFixed(1)} 目` : `白胜 ${(whitePoints - blackPoints).toFixed(1)} 目`}</p><div className="score-legend"><span><i className="black" />黑 {blackPoints.toFixed(1)} 目</span><span><i className="white" />白 {whitePoints.toFixed(1)} 目</span></div><div><button onClick={() => setShowScore(false)}>返回</button><button className="dialog-start" onClick={() => { setShowScore(false); setShowNewGame(true); }}>新对局</button></div></section></div>}
      {showNewGame && <div className="dialog-backdrop"><section className="new-game-dialog"><div className="dialog-title"><strong>新对局</strong><button onClick={() => setShowNewGame(false)} aria-label="关闭">×</button></div><label>棋盘<div className="dialog-options board-options">{SIZES.map((option) => <button key={option.size} className={draftSize === option.size ? 'selected' : ''} onClick={() => setDraftSize(option.size)}>{option.name}({option.size})</button>)}</div></label><label>执方<div className="dialog-options full-options player-options"><button className={draftHumanColor === 'black' && !draftSelfPlayMode ? 'selected' : ''} onClick={() => { setDraftHumanColor('black'); setDraftSelfPlayMode(false); }}><span className="dialog-stone black-stone" />执黑</button><button className={draftHumanColor === 'white' && !draftSelfPlayMode ? 'selected' : ''} onClick={() => { setDraftHumanColor('white'); setDraftSelfPlayMode(false); }}><span className="dialog-stone white-stone" />执白</button><button className={draftSelfPlayMode ? 'selected' : ''} onClick={() => setDraftSelfPlayMode(true)}><span className="dialog-stone black-stone" /><span className="dialog-stone white-stone" />自弈</button></div></label><label>模型<div className="dialog-options model-options">{KATAGO_MODEL_TIERS.map((tier) => <button key={tier.id} className={draftModelTier === tier.id ? 'selected' : ''} onClick={() => setDraftModelTier(tier.id)} title={`${tier.modelName} · 思考 ${tier.minThinkingMs / 1000}–${tier.maxThinkingMs / 1000} 秒`}>{tier.label}{draftModelTier === tier.id && <small>{formatThinkingSeconds(draftThinkingMsByTier[tier.id] ?? defaultThinkingForTier(tier))}</small>}</button>)}</div><input type="range" className="thinking-slider" min={getModelTier(draftModelTier)?.minThinkingMs ? Math.round(getModelTier(draftModelTier)!.minThinkingMs / 1000) : 2} max={getModelTier(draftModelTier)?.maxThinkingMs ? Math.round(getModelTier(draftModelTier)!.maxThinkingMs / 1000) : 30} step={1} value={(draftThinkingMsByTier[draftModelTier] ?? defaultThinkingForTier(getModelTier(draftModelTier))) / 1000} disabled={draftSelfPlayMode} onChange={(event) => selectThinkingMs(Number(event.target.value) * 1000)} aria-label="每步思考时间（秒）" /></label><button className="dialog-start" onClick={() => void newGame()}>开始对局</button></section></div>}
      {showModelDownload && <div className="dialog-backdrop"><section className="new-game-dialog download-dialog"><div className="dialog-title"><strong>下载 B18 模型</strong><button onClick={cancelModelDownload} aria-label="关闭">×</button></div><p className="download-note">B18 是最强模型，下载完成后会保存在本地缓存，之后打开页面无需重复下载。</p>{downloadPhase === 'downloading' && <><div className="download-progress-track" role="progressbar" aria-label="模型下载进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={downloadPercent()}><span className="download-progress-fill" style={{ width: `${downloadPercent()}%` }} /></div><div className="download-progress-label">{formatModelBytes(downloadProgress.loaded)} / {downloadProgress.total > 0 ? formatModelBytes(downloadProgress.total) : '--'}（{downloadPercent()}%）</div><div className="download-dialog-actions"><button onClick={cancelModelDownload}>取消下载</button></div></>}{downloadPhase === 'confirm' && <div className="download-dialog-actions"><button onClick={cancelModelDownload}>取消</button><button className="dialog-start" onClick={() => void startModelDownload()}>开始下载</button></div>}{downloadPhase === 'done' && <><p className="download-done">下载完成，B18 模型已启用并写入本地缓存。</p>{downloadError && <p className="download-error">{downloadError}</p>}<div className="download-dialog-actions"><button className="dialog-start" onClick={() => setShowModelDownload(false)}>完成</button></div></>}{downloadPhase === 'error' && <><p className="download-error">{downloadError || '下载失败，请稍后重试。'}</p><div className="download-dialog-actions"><button onClick={cancelModelDownload}>取消</button><button className="dialog-start" onClick={() => void startModelDownload()}>重试</button></div></>}</section></div>}
      {showForceRedownload && <div className="dialog-backdrop"><section className="new-game-dialog download-dialog"><div className="dialog-title"><strong>重新下载 B18 模型</strong><button onClick={() => setShowForceRedownload(false)} aria-label="关闭">×</button></div><p className="download-note">B18 已下载并缓存。确认后将重新下载并用 MD5 校验替换现有缓存。</p><div className="download-dialog-actions"><button onClick={() => setShowForceRedownload(false)}>取消</button><button className="dialog-start" onClick={() => { setShowForceRedownload(false); setShowModelDownload(true); void startModelDownload(); }}>确认重新下载</button></div></section></div>}
      {notice && <div className="battle-toast">{notice}</div>}
      {scoreNotice && <div className="battle-toast score-toast" role="button" tabIndex={0} onClick={() => { setScoreNotice(null); setShowTerritory(false); }} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { setScoreNotice(null); setShowTerritory(false); } }}><div className="score-toast-points"><span>{scoreNotice.black}</span><span>{scoreNotice.white}</span></div><span className="score-toast-divider" /><strong className="score-toast-leader">{scoreNotice.leader}</strong></div>}
    </main>
  );
}
