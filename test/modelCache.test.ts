import { describe, expect, it } from 'vitest';
import pako from 'pako';
import {
  cacheKeyForModelUrl,
  isTierModelCached,
  isCurrentModelCacheKey,
  MODEL_CACHE_VERSION,
  modelCacheKeyForTier,
  modelCacheKeyForUrl,
  normalizeModelBytes,
} from '../src/engine/katago/modelCache';

describe('model cache keys', () => {
  it('scopes keys by version so model updates invalidate downloads', () => {
    const urlKey = modelCacheKeyForUrl('https://example.com/model.bin.gz');
    expect(urlKey).toBe(`v${MODEL_CACHE_VERSION}:url:https://example.com/model.bin.gz`);
    expect(modelCacheKeyForTier('b18')).toBe(`v${MODEL_CACHE_VERSION}:tier:b18`);
    expect(isCurrentModelCacheKey(urlKey)).toBe(true);
    expect(isCurrentModelCacheKey('v0:url:https://example.com/old.bin.gz')).toBe(false);
  });

  it('maps known tier URLs to tier-scoped keys so cached copies are shared', () => {
    expect(cacheKeyForModelUrl('models/katago-small.bin.gz')).toBe(modelCacheKeyForTier('b6'));
    expect(cacheKeyForModelUrl('/models/katago-b10.bin.gz')).toBe(modelCacheKeyForTier('b10'));
    expect(cacheKeyForModelUrl('https://raw.githubusercontent.com/otrego/clamshell/21c3dfe291cc/katalyze/testdata/g170e-b10c128-s1141046784-d204142634.bin.gz')).toBe(
      modelCacheKeyForTier('b10')
    );
    expect(cacheKeyForModelUrl('https://example.com/other.bin')).toBe(
      modelCacheKeyForUrl('https://example.com/other.bin')
    );
  });

  it('reports unknown or unavailable tiers as not cached', async () => {
    // The node test environment has no IndexedDB, so every tier reads as absent.
    expect(await isTierModelCached('b6')).toBe(false);
    expect(await isTierModelCached('unknown-tier')).toBe(false);
  });

  it('normalizes gzipped bytes and leaves already-decompressed bytes alone', () => {
    const raw = new TextEncoder().encode('model bytes');
    expect(normalizeModelBytes(new Uint8Array(pako.gzip(raw)))).toEqual(raw);
    expect(normalizeModelBytes(raw)).toEqual(raw);
  });
});
