import { describe, expect, it } from 'vitest';
import pako from 'pako';
import {
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

  it('normalizes gzipped bytes and leaves already-decompressed bytes alone', () => {
    const raw = new TextEncoder().encode('model bytes');
    expect(normalizeModelBytes(new Uint8Array(pako.gzip(raw)))).toEqual(raw);
    expect(normalizeModelBytes(raw)).toEqual(raw);
  });
});
