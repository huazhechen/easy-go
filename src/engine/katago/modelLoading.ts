import { looksLikeMarkup, modelResponseError } from './modelResponse';
import { expectedModelMd5 } from './modelDefaults';
import { cacheKeyForModelUrl, normalizeModelBytes, readValidatedCachedModel, writeCachedModel } from './modelCache';
import { md5Hex } from '../../utils/md5';

/**
 * Fetches model bytes, preferring the IndexedDB cache so a model that was
 * already downloaded once is never fetched again unless the cache version
 * changes. blob: URLs (a cached b18 served through an object URL) are already
 * in-memory and are deliberately not written back to the cache.
 */
export async function fetchModelBytes(modelUrl: string): Promise<Uint8Array> {
  const cacheKey = cacheKeyForModelUrl(modelUrl);
  const expectedMd5 = expectedModelMd5(modelUrl);
  const cached = await readValidatedCachedModel(cacheKey, expectedMd5);
  if (cached) {
    const bytes = new Uint8Array(cached);
    if (!looksLikeMarkup(bytes)) return bytes;
  }

  const res = await fetch(modelUrl);
  if (!res.ok) throw new Error(`Failed to fetch model: ${res.status} ${res.statusText}`);
  const data = normalizeModelBytes(new Uint8Array(await res.arrayBuffer()));
  if (looksLikeMarkup(data)) throw modelResponseError(modelUrl);
  if (expectedMd5) {
    if (md5Hex(data) !== expectedMd5.toLowerCase()) {
      throw new Error(`Model checksum mismatch for ${modelUrl}: expected MD5 ${expectedMd5}`);
    }
  }
  if (!modelUrl.startsWith('blob:')) {
    await writeCachedModel(cacheKey, data, expectedMd5 ?? undefined);
  }
  return data;
}
