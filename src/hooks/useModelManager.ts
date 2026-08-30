import { useEffect, useRef, useState } from 'react';
import { useGameStore } from '../store/gameStore';
import type { GameSettings } from '../types';
import {
  clampThinkingMs,
  DEFAULT_MODEL_TIER_ID,
  defaultThinkingForTier,
  getModelTier,
  isKnownModelTierId,
  KATAGO_MODEL_TIERS,
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

const MODEL_TIER_STORAGE_KEY = 'easy-go:model-tier';
const THINKING_STORAGE_KEY = 'easy-go:model-thinking-ms';

export type DownloadPhase = 'confirm' | 'downloading' | 'done' | 'error';

// Per-tier thinking time is stored independently, so choosing 10s on B6 never
// changes what is selected on B10 or B18.
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

/**
 * Owns model-tier selection, per-tier thinking times, and the B18 download
 * flow. Restores the persisted tier on startup and keeps the engine URL in
 * sync with the active tier.
 */
export function useModelManager(notify: (message: string) => void) {
  const [selectedModelTier, setSelectedModelTier] = useState<KataGoModelTierId>(() => {
    const stored = readLocalStorage(MODEL_TIER_STORAGE_KEY);
    return isKnownModelTierId(stored) ? stored : DEFAULT_MODEL_TIER_ID;
  });
  const [thinkingMsByTier, setThinkingMsByTier] = useState<Record<KataGoModelTierId, number>>(readStoredThinkingMs);
  const [showModelDownload, setShowModelDownload] = useState(false);
  const [showForceRedownload, setShowForceRedownload] = useState(false);
  const [downloadPhase, setDownloadPhase] = useState<DownloadPhase>('confirm');
  const [downloadProgress, setDownloadProgress] = useState({ loaded: 0, total: 0 });
  const [downloadError, setDownloadError] = useState('');
  const downloadAbortRef = useRef<AbortController | null>(null);
  const b18BlobUrlRef = useRef<string | null>(null);

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
      const state = useGameStore.getState();
      const tierThinkingMs = readStoredThinkingMs()[tier] ?? defaultThinkingForTier(tierConfig);
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

  const switchToTier = async (tierId: KataGoModelTierId): Promise<boolean> => {
    if (tierId === selectedModelTier) {
      // B18 is already downloaded and selected: clicking it again offers a
      // forced re-download instead of silently doing nothing.
      if (tierId === 'b18') setShowForceRedownload(true);
      return true;
    }
    const tier = getModelTier(tierId);
    if (!tier) return false;

    let url: string | null;
    if (tierId === 'b18') {
      url = b18BlobUrlRef.current ?? (await resolveTierModelUrl('b18'));
      if (!url) {
        setDownloadPhase('confirm');
        setDownloadProgress({ loaded: 0, total: 0 });
        setDownloadError('');
        setShowModelDownload(true);
        return false;
      }
      b18BlobUrlRef.current = url;
    } else {
      url = await resolveTierModelUrl(tierId);
    }
    if (!url) return false;

    setSelectedModelTier(tierId);
    writeLocalStorage(MODEL_TIER_STORAGE_KEY, tierId);
    const state = useGameStore.getState();
    const patch: Partial<GameSettings> = { katagoModelUrl: url };
    const tierDefaultThinkingMs = defaultThinkingForTier(tier);
    if (state.settings.katagoMaxTimeMs !== tierDefaultThinkingMs) patch.katagoMaxTimeMs = tierDefaultThinkingMs;
    state.updateSettings(patch);
    notify(tier.requiresDownload ? 'B18 模型已启用' : `${tier.label} 模型已选择`);
    return true;
  };

  /** Applies a dialog-chosen tier and thinking time, returning false when a download dialog opened instead. */
  const confirmModelSelection = async (tierId: KataGoModelTierId, thinkingMs: number): Promise<boolean> => {
    if (tierId !== selectedModelTier) {
      const switched = await switchToTier(tierId);
      if (!switched) return false;
    }
    const tier = getModelTier(tierId);
    const clamped = tier ? clampThinkingMs(thinkingMs, tier) : thinkingMs;
    setThinkingMsByTier((prev) => {
      const next = { ...prev, [tierId]: clamped };
      writeLocalStorage(THINKING_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
    setSelectedModelTier(tierId);
    writeLocalStorage(MODEL_TIER_STORAGE_KEY, tierId);
    const state = useGameStore.getState();
    state.updateSettings({ katagoMaxTimeMs: clamped, katagoBatchSize: 1 });
    return true;
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
      if (state.settings.katagoModelUrl !== blobUrl) state.updateSettings({ katagoModelUrl: blobUrl });
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

  const selectedModelTierConfig = getModelTier(selectedModelTier);
  const thinkingMs = thinkingMsByTier[selectedModelTier] ?? defaultThinkingForTier(selectedModelTierConfig);
  const selectedModelLabel = selectedModelTierConfig?.label ?? selectedModelTier;

  return {
    selectedModelTier,
    selectedModelLabel,
    thinkingMs,
    thinkingMsByTier,
    showModelDownload,
    setShowModelDownload,
    showForceRedownload,
    setShowForceRedownload,
    downloadPhase,
    downloadProgress,
    downloadError,
    confirmModelSelection,
    startModelDownload,
    cancelModelDownload,
    downloadPercent,
  };
}
