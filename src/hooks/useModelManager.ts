import { useCallback, useEffect, useRef, useState } from 'react';
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
  ensureTierModelCached,
  isTierModelCached,
  pruneModelCache,
  resolveTierModelUrl,
} from '../engine/katago/modelCache';
import { readLocalStorage, writeLocalStorage } from '../utils/storage';
import { MODEL_THINKING_STORAGE_KEY, MODEL_TIER_STORAGE_KEY } from '../utils/storageKeys';
import { publicUrl } from '../utils/publicUrl';
import { useModelDownload } from './useModelDownload';

// Per-tier thinking time is stored independently, so choosing 10s on B6 never
// changes what is selected on B10 or B18.
const readStoredThinkingMs = (): Record<KataGoModelTierId, number> => {
  const defaults: Record<KataGoModelTierId, number> = {
    b6: defaultThinkingForTier(getModelTier('b6')),
    b10: defaultThinkingForTier(getModelTier('b10')),
    b18: defaultThinkingForTier(getModelTier('b18')),
  };
  try {
    const raw = readLocalStorage(MODEL_THINKING_STORAGE_KEY);
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
  const b18BlobUrlRef = useRef<string | null>(null);
  const backgroundWarmRef = useRef<Promise<void> | null>(null);
  const b10PendingUpgradeRef = useRef(false);
  const selectedTierRef = useRef<KataGoModelTierId>(DEFAULT_MODEL_TIER_ID);
  const download = useModelDownload((blobUrl) => {
    if (b18BlobUrlRef.current) URL.revokeObjectURL(b18BlobUrlRef.current);
    b18BlobUrlRef.current = blobUrl;
    setSelectedModelTier('b18');
    writeLocalStorage(MODEL_TIER_STORAGE_KEY, 'b18');
    const state = useGameStore.getState();
    if (state.settings.katagoModelUrl !== blobUrl) state.updateSettings({ katagoModelUrl: blobUrl });
  });

  useEffect(() => {
    selectedTierRef.current = selectedModelTier;
  }, [selectedModelTier]);

  /**
   * Warms b6 and b10 into the local cache in the background (b6 first — it is
   * the tiny fallback tier). When the B10 download finishes and the user is
   * still on the default tier, the engine URL is switched to the cached copy.
   */
  const warmTierModels = useCallback((): Promise<void> => {
    if (backgroundWarmRef.current) return backgroundWarmRef.current;
    const task = (async () => {
      try {
        await ensureTierModelCached('b6');
        const pendingB10Upgrade = b10PendingUpgradeRef.current;
        const b10Cached = await ensureTierModelCached('b10');
        if (b10Cached && pendingB10Upgrade && selectedTierRef.current === 'b10') {
          const tier = getModelTier('b10');
          const state = useGameStore.getState();
          const url = tier ? publicUrl(tier.localPath) : null;
          if (url && state.settings.katagoModelUrl !== url) {
            state.updateSettings({ katagoModelUrl: url });
            notify('B10 模型已下载完成，自动切换');
          }
        }
      } finally {
        b10PendingUpgradeRef.current = false;
        backgroundWarmRef.current = null;
      }
    })();
    backgroundWarmRef.current = task;
    return task;
  }, [notify]);

  /**
   * Resolves the engine URL for a tier. When B10 is not cached yet it applies
   * the downgrade policy: play starts on the tiny B6 net immediately while
   * B10 is fetched in the background and silently swapped in when ready.
   */
  const resolvePlayUrl = useCallback(
    async (tierId: KataGoModelTierId): Promise<string | null> => {
      // Keep both light tiers stored locally in the background on every play
      // URL resolution. The pending flag is set synchronously below, before
      // any await, so the warm task always observes it when B10 is missing.
      void warmTierModels();
      if (tierId === 'b10') {
        b10PendingUpgradeRef.current = true;
        if (await isTierModelCached('b10')) {
          b10PendingUpgradeRef.current = false;
          return resolveTierModelUrl('b10');
        }
        return resolveTierModelUrl('b6');
      }
      return resolveTierModelUrl(tierId);
    },
    [warmTierModels]
  );

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
      if (!url) {
        url = await resolvePlayUrl(tier);
        if (!url) url = await resolveTierModelUrl(tier);
      }
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
  }, [resolvePlayUrl]);

  useEffect(
    () => () => {
      if (b18BlobUrlRef.current) URL.revokeObjectURL(b18BlobUrlRef.current);
    },
    []
  );

  const switchToTier = async (tierId: KataGoModelTierId): Promise<boolean> => {
    if (tierId === selectedModelTier) {
      // B18 is already downloaded and selected: clicking it again offers a
      // forced re-download instead of silently doing nothing.
      if (tierId === 'b18') download.setShowForceRedownload(true);
      return true;
    }
    const tier = getModelTier(tierId);
    if (!tier) return false;

    let url: string | null;
    if (tierId === 'b18') {
      url = b18BlobUrlRef.current ?? (await resolveTierModelUrl('b18'));
      if (!url) {
        download.resetDownload();
        download.setShowModelDownload(true);
        return false;
      }
      b18BlobUrlRef.current = url;
    } else {
      url = await resolvePlayUrl(tierId);
    }
    if (!url) return false;

    setSelectedModelTier(tierId);
    writeLocalStorage(MODEL_TIER_STORAGE_KEY, tierId);
    const state = useGameStore.getState();
    const patch: Partial<GameSettings> = { katagoModelUrl: url };
    const tierDefaultThinkingMs = defaultThinkingForTier(tier);
    if (state.settings.katagoMaxTimeMs !== tierDefaultThinkingMs) patch.katagoMaxTimeMs = tierDefaultThinkingMs;
    state.updateSettings(patch);
    notify(
      tierId === 'b10' && b10PendingUpgradeRef.current
        ? 'B10 模型已选择，正在后台下载，当前使用 B6'
        : tier.requiresDownload
          ? 'B18 模型已启用'
          : `${tier.label} 模型已选择`
    );
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
      writeLocalStorage(MODEL_THINKING_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
    setSelectedModelTier(tierId);
    writeLocalStorage(MODEL_TIER_STORAGE_KEY, tierId);
    const state = useGameStore.getState();
    state.updateSettings({ katagoMaxTimeMs: clamped });
    return true;
  };

  const selectedModelTierConfig = getModelTier(selectedModelTier);
  const thinkingMs = thinkingMsByTier[selectedModelTier] ?? defaultThinkingForTier(selectedModelTierConfig);
  const selectedModelLabel = selectedModelTierConfig?.label ?? selectedModelTier;

  return {
    ...download,
    selectedModelTier,
    selectedModelLabel,
    thinkingMs,
    thinkingMsByTier,
    confirmModelSelection,
  };
}
