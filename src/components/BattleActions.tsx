import { FaCalculator, FaFlag, FaLightbulb, FaUndo } from 'react-icons/fa';
import type { ToggleMode } from '../hooks/useToggleMode';

interface BattleActionsProps {
  canUndo: boolean;
  disabled: boolean;
  lastMoveWasPass: boolean;
  hintMode: ToggleMode;
  scoreMode: ToggleMode;
  recommendationLabel: string;
  /** True while the recommendation MCTS search is actively running. */
  recommendationSearching: boolean;
  showThinkingSpinner: boolean;
  onUndo: () => void;
  onPass: () => void;
  onCycleScore: () => void;
  onCycleHints: () => void;
}

export function BattleActions({
  canUndo,
  disabled,
  lastMoveWasPass,
  hintMode,
  scoreMode,
  recommendationLabel,
  recommendationSearching,
  showThinkingSpinner,
  onUndo,
  onPass,
  onCycleScore,
  onCycleHints,
}: BattleActionsProps) {
  const hintToggleClass = hintMode === 'always' ? ' active' : '';
  const hintLabel = hintMode === 'off' ? '关闭' : '永久';
  const scoreToggleClass = scoreMode === 'always' ? ' active' : '';
  const scoreLabel = scoreMode === 'off' ? '关闭' : '永久';
  return (
    <div className="battle-actions">
      <button type="button" onClick={onUndo} disabled={!canUndo}><FaUndo />悔棋</button>
      <button type="button" onClick={onPass} disabled={disabled}><FaFlag />{lastMoveWasPass ? '终局' : '停着'}</button>
      <button
        type="button"
        onClick={onCycleScore}
        disabled={disabled}
        className={`score-toggle${scoreToggleClass}`}
        aria-pressed={scoreMode !== 'off'}
        aria-label={`局势判定：${scoreLabel}`}
      >
        <FaCalculator />
        <span className="score-label">局势判定</span>
      </button>
      <button
        type="button"
        className={`recommendation-toggle${hintToggleClass}`}
        aria-pressed={hintMode !== 'off'}
        aria-label={`推荐落点：${hintLabel}`}
        onClick={onCycleHints}
        disabled={disabled}
      >
        <FaLightbulb />
        <span className={hintMode !== 'off' && recommendationSearching ? 'recommendation-label searching-flash' : 'recommendation-label'}>{recommendationLabel}</span>
        {showThinkingSpinner && <span className="thinking-spinner" aria-label="推荐落点计算中" />}
      </button>
    </div>
  );
}
