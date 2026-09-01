import { useEffect, useRef, useState } from 'react';
import { getModelTier } from '../engine/katago/modelDefaults';
import {
  downloadModelChunks,
  downloadModelWithProgress,
  modelCacheKeyForTier,
  normalizeModelBytes,
  objectUrlForModelBytes,
  verifyModelMd5,
  writeCachedModel,
} from '../engine/katago/modelCache';
import { publicUrl } from '../utils/publicUrl';

export type DownloadPhase = 'confirm' | 'downloading' | 'done' | 'error';

/**
 * The B18 model download flow: streaming progress, abort, phase transitions,
 * and MD5 verification. `onDownloaded` receives the object URL over the
 * verified cached bytes once the download is complete.
 */
export function useModelDownload(onDownloaded: (blobUrl: string) => void) {
  const [showModelDownload, setShowModelDownload] = useState(false);
  const [showForceRedownload, setShowForceRedownload] = useState(false);
  const [downloadPhase, setDownloadPhase] = useState<DownloadPhase>('confirm');
  const [downloadProgress, setDownloadProgress] = useState({ loaded: 0, total: 0 });
  const [downloadError, setDownloadError] = useState('');
  const downloadAbortRef = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      downloadAbortRef.current?.abort();
    },
    []
  );

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
      const cached = await writeCachedModel(modelCacheKeyForTier('b18'), normalized, tier.md5);
      onDownloaded(objectUrlForModelBytes(normalized));
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

  /** Returns the dialog to its initial confirm state (e.g. before a retry). */
  const resetDownload = () => {
    setDownloadPhase('confirm');
    setDownloadProgress({ loaded: 0, total: 0 });
    setDownloadError('');
  };

  const downloadPercent = (): number => {
    if (downloadPhase !== 'downloading') return downloadProgress.loaded > 0 ? 100 : 0;
    if (downloadProgress.total > 0) return Math.min(100, Math.round((downloadProgress.loaded / downloadProgress.total) * 100));
    return downloadProgress.loaded > 0 ? 100 : 0;
  };

  return {
    showModelDownload,
    setShowModelDownload,
    showForceRedownload,
    setShowForceRedownload,
    downloadPhase,
    downloadProgress,
    downloadError,
    startModelDownload,
    cancelModelDownload,
    resetDownload,
    downloadPercent,
  };
}
