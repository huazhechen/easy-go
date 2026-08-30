import { getModelTier } from './modelDefaults';
import { publicUrl } from '../../utils/publicUrl';
import { md5Hex } from '../../utils/md5';
import pako from 'pako';

/**
 * Local model byte cache backed by IndexedDB.
 *
 * The heavy b18 model (~96 MB) is downloaded once with an explicit progress
 * dialog and then served from this cache on every later visit, so the network
 * is only touched again when MODEL_CACHE_VERSION changes (i.e. when the model
 * files in the app are updated). The worker uses the same store for every
 * model it fetches, which also keeps the b10 model local after the first load.
 */
export const MODEL_CACHE_VERSION = 2;

const MODEL_CACHE_DB = 'easy-go-model-cache';
const MODEL_CACHE_STORE = 'models';
const MODEL_CACHE_VERSION_PREFIX = `v${MODEL_CACHE_VERSION}`;

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openModelCache(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      const factory = globalThis.indexedDB;
      if (!factory) {
        resolve(null);
        return;
      }
      const request = factory.open(MODEL_CACHE_DB, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(MODEL_CACHE_STORE)) {
          db.createObjectStore(MODEL_CACHE_STORE);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

function toArrayBuffer(value: unknown): ArrayBuffer | null {
  if (value instanceof ArrayBuffer) return value;
  if (ArrayBuffer.isView(value)) {
    const copy = new Uint8Array(value.byteLength);
    copy.set(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
    return copy.buffer;
  }
  return null;
}

/**
 * Normalizes fetched model bytes to the decompressed KataGo `.bin` form.
 *
 * Static hosts (Vite dev, GitHub Pages, Netlify, …) commonly serve `.gz`
 * files with `Content-Encoding: gzip`, which makes the browser transparently
 * decompress the response before fetch resolves it. Normalizing here means
 * validation, caching and parsing all see the same bytes no matter which
 * behavior the host uses.
 */
export function normalizeModelBytes(data: Uint8Array): Uint8Array {
  if (data.length >= 2 && data[0] === 0x1f && data[1] === 0x8b) return pako.ungzip(data);
  return data;
}

export function modelCacheKeyForUrl(url: string): string {
  return `${MODEL_CACHE_VERSION_PREFIX}:url:${url}`;
}

export function modelCacheKeyForTier(tierId: string): string {
  return `${MODEL_CACHE_VERSION_PREFIX}:tier:${tierId}`;
}

export function isCurrentModelCacheKey(key: string): boolean {
  return key.startsWith(MODEL_CACHE_VERSION_PREFIX);
}

export async function readCachedModel(key: string): Promise<ArrayBuffer | null> {
  const db = await openModelCache();
  if (!db) return null;
  try {
    const tx = db.transaction(MODEL_CACHE_STORE, 'readonly');
    const value = await requestResult(tx.objectStore(MODEL_CACHE_STORE).get(key));
    return toArrayBuffer(value);
  } catch {
    return null;
  }
}

/**
 * Reads a cached model and verifies its MD5. A mismatch (corrupt bytes, a
 * stale download, or a model update that kept the same version number) deletes
 * the entry and reports it as absent so the caller re-fetches and replaces it.
 */
export async function readValidatedCachedModel(
  key: string,
  expectedMd5: string | null | undefined
): Promise<ArrayBuffer | null> {
  const cached = await readCachedModel(key);
  if (!cached) return null;
  if (expectedMd5 && md5Hex(new Uint8Array(cached)) !== expectedMd5.toLowerCase()) {
    await deleteCachedModel(key);
    return null;
  }
  return cached;
}

export function verifyModelMd5(data: ArrayBuffer | Uint8Array, expectedMd5: string): boolean {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  return md5Hex(bytes) === expectedMd5.toLowerCase();
}

export async function writeCachedModel(key: string, data: ArrayBuffer | Uint8Array): Promise<boolean> {
  const db = await openModelCache();
  if (!db) return false;
  try {
    const tx = db.transaction(MODEL_CACHE_STORE, 'readwrite');
    await requestResult(tx.objectStore(MODEL_CACHE_STORE).put(data, key));
    return true;
  } catch {
    return false;
  }
}

export async function deleteCachedModel(key: string): Promise<void> {
  const db = await openModelCache();
  if (!db) return;
  try {
    const tx = db.transaction(MODEL_CACHE_STORE, 'readwrite');
    await requestResult(tx.objectStore(MODEL_CACHE_STORE).delete(key));
  } catch {
    // Best-effort cleanup.
  }
}

/** Removes entries written by older model versions so a version bump re-downloads. */
export async function pruneModelCache(): Promise<void> {
  const db = await openModelCache();
  if (!db) return;
  try {
    const store = db.transaction(MODEL_CACHE_STORE, 'readonly').objectStore(MODEL_CACHE_STORE);
    const keys = await requestResult(store.getAllKeys());
    const stale = keys.filter((key) => !isCurrentModelCacheKey(String(key)));
    if (stale.length === 0) return;
    const tx = db.transaction(MODEL_CACHE_STORE, 'readwrite');
    const deleteStore = tx.objectStore(MODEL_CACHE_STORE);
    for (const key of stale) void deleteStore.delete(key);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB prune failed'));
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB prune aborted'));
    });
  } catch {
    // Best-effort cleanup.
  }
}

/**
 * Streams a model download so the UI can render a progress bar, and reports
 * `{ loaded, total }` bytes as chunks arrive. Abort via the signal.
 */
export async function downloadModelWithProgress(
  url: string,
  onProgress?: (loaded: number, total: number) => void,
  signal?: AbortSignal,
  expectedDecodedBytes?: number
): Promise<ArrayBuffer> {
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`模型下载失败（${response.status} ${response.statusText}）`);
  }
  // When a host serves the .gz with Content-Encoding: gzip, the browser
  // transparently decompresses the body, so Content-Length (the compressed
  // size) no longer matches the bytes actually received. Use the tier's real
  // decompressed size as the total in that case so the progress bar stays
  // consistent (loaded never exceeds total).
  const contentEncoding = (response.headers.get('content-encoding') ?? '').toLowerCase();
  const autoDecoded = /gzip|deflate|br/.test(contentEncoding);
  const total =
    (autoDecoded && expectedDecodedBytes ? expectedDecodedBytes : Number(response.headers.get('content-length'))) || 0;
  if (!response.body) {
    const buffer = await response.arrayBuffer();
    onProgress?.(buffer.byteLength, total || buffer.byteLength);
    return buffer;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      loaded += value.length;
      onProgress?.(loaded, total);
    }
  }
  const out = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out.buffer as ArrayBuffer;
}

/**
 * Downloads a model split into several hosted chunks (≤24 MiB each, so hosts
 * with a 25 MiB per-file limit can serve it) and concatenates them in order.
 * Progress reports cumulative real bytes across all chunks.
 */
export async function downloadModelChunks(
  chunks: readonly { url: string; bytes: number }[],
  onProgress?: (loaded: number, total: number) => void,
  signal?: AbortSignal
): Promise<ArrayBuffer> {
  const total = chunks.reduce((sum, chunk) => sum + chunk.bytes, 0);
  if (chunks.length === 0) return new ArrayBuffer(0);
  const out = new Uint8Array(total);
  let offset = 0;

  for (const chunk of chunks) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const response = await fetch(chunk.url, { signal });
    if (!response.ok) {
      throw new Error(`模型分片下载失败（${chunk.url}: ${response.status} ${response.statusText}）`);
    }

    let chunkLoaded = 0;
    if (!response.body) {
      const buf = new Uint8Array(await response.arrayBuffer());
      if (buf.length !== chunk.bytes) throw new Error(`模型分片大小不符（${chunk.url}）`);
      out.set(buf, offset);
      offset += buf.length;
      onProgress?.(offset, total);
      continue;
    }

    const reader = response.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        if (chunkLoaded + value.length > chunk.bytes) {
          throw new Error(`模型分片大小不符（${chunk.url}）`);
        }
        out.set(value, offset + chunkLoaded);
        chunkLoaded += value.length;
        onProgress?.(offset + chunkLoaded, total);
      }
    }
    if (chunkLoaded !== chunk.bytes) {
      throw new Error(`模型分片不完整（${chunk.url}）`);
    }
    offset += chunkLoaded;
  }
  return out.buffer as ArrayBuffer;
}

/** Creates an object URL over the cached bytes; caller revokes it when done. */
export function objectUrlForModelBytes(buffer: ArrayBuffer | Uint8Array): string {
  return URL.createObjectURL(buffer instanceof Uint8Array ? new Blob([buffer.slice()]) : new Blob([buffer]));
}

/**
 * Resolves the URL the engine should fetch for a tier:
 * - b6/b10: the locally-hosted file URL.
 * - b18: a blob URL over the cached bytes, or null when it still needs downloading.
 */
export async function resolveTierModelUrl(tierId: string): Promise<string | null> {
  const tier = getModelTier(tierId);
  if (!tier) return null;
  if (!tier.requiresDownload) return publicUrl(tier.localPath);
  const cached = await readValidatedCachedModel(modelCacheKeyForTier(tier.id), tier.md5);
  return cached ? objectUrlForModelBytes(cached) : null;
}
