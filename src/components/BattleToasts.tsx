import type { ScoreResult } from '../utils/territoryScore';

export function NoticeToast({ text }: { text: string }) {
  return <div className="battle-toast">{text}</div>;
}

export function ScoreToast({ score, onDismiss }: { score: ScoreResult; onDismiss: () => void }) {
  return (
    <div
      className="battle-toast score-toast"
      role="button"
      tabIndex={0}
      onClick={onDismiss}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') onDismiss();
      }}
    >
      <div className="score-toast-points"><span>{score.black}</span><span>{score.white}</span></div>
      <span className="score-toast-divider" />
      <strong className="score-toast-leader">{score.leader}</strong>
    </div>
  );
}
