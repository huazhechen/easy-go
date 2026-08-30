import type { DownloadPhase } from '../../hooks/useModelDownload';
import { formatModelBytes } from '../../utils/format';

interface ModelDownloadDialogProps {
  phase: DownloadPhase;
  progress: { loaded: number; total: number };
  error: string;
  percent: number;
  onCancel: () => void;
  onStart: () => void;
  onDone: () => void;
}

export function ModelDownloadDialog({ phase, progress, error, percent, onCancel, onStart, onDone }: ModelDownloadDialogProps) {
  const bytesLabel = `${formatModelBytes(progress.loaded)} / ${progress.total > 0 ? formatModelBytes(progress.total) : '--'}`;
  return (
    <div className="dialog-backdrop">
      <section className="new-game-dialog download-dialog">
        <div className="dialog-title">
          <strong>下载 B18 模型</strong>
          <button onClick={onCancel} aria-label="关闭">×</button>
        </div>
        <p className="download-note">B18 是最强模型，下载完成后会保存在本地缓存，之后打开页面无需重复下载。</p>
        {phase === 'downloading' && (
          <>
            <div className="download-progress-track" role="progressbar" aria-label="模型下载进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
              <span className="download-progress-fill" style={{ width: `${percent}%` }} />
            </div>
            <div className="download-progress-label">{bytesLabel}（{percent}%）</div>
            <div className="download-dialog-actions"><button onClick={onCancel}>取消下载</button></div>
          </>
        )}
        {phase === 'confirm' && (
          <div className="download-dialog-actions"><button onClick={onCancel}>取消</button><button className="dialog-start" onClick={onStart}>开始下载</button></div>
        )}
        {phase === 'done' && (
          <>
            <p className="download-done">下载完成，B18 模型已启用并写入本地缓存。</p>
            {error && <p className="download-error">{error}</p>}
            <div className="download-dialog-actions"><button className="dialog-start" onClick={onDone}>完成</button></div>
          </>
        )}
        {phase === 'error' && (
          <>
            <p className="download-error">{error || '下载失败，请稍后重试。'}</p>
            <div className="download-dialog-actions"><button onClick={onCancel}>取消</button><button className="dialog-start" onClick={onStart}>重试</button></div>
          </>
        )}
      </section>
    </div>
  );
}

export function ForceRedownloadDialog({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: () => void }) {
  return (
    <div className="dialog-backdrop">
      <section className="new-game-dialog download-dialog">
        <div className="dialog-title">
          <strong>重新下载 B18 模型</strong>
          <button onClick={onCancel} aria-label="关闭">×</button>
        </div>
        <p className="download-note">B18 已下载并缓存。确认后将重新下载并用 MD5 校验替换现有缓存。</p>
        <div className="download-dialog-actions">
          <button onClick={onCancel}>取消</button>
          <button className="dialog-start" onClick={onConfirm}>确认重新下载</button>
        </div>
      </section>
    </div>
  );
}
