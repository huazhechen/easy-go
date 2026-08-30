import { FaCalculator, FaFlag, FaLightbulb, FaUndo } from 'react-icons/fa';
import type { HintMode } from '../hooks/useHintMode';

interface BattleActionsProps {
  canUndo: boolean;
  disabled: boolean;
  lastMoveWasPass: boolean;
  scoreActive: boolean;
  hintMode: HintMode;
  recommendationLabel: string;
  showThinkingSpinner: boolean;
  onUndo: () => void;
  onPass: () => void;
  onScore: () => void;
  onCycleHints: () => void;
}

export function BattleActions({
  canUndo,
  disabled,
  lastMoveWasPass,
  scoreActive,
  hintMode,
  recommendationLabel,
  showThinkingSpinner,
  onUndo,
  onPass,
  onScore,
  onCycleHints,
}: BattleActionsProps) {
  const hintToggleClass = hintMode === 'always' ? ' active' : hintMode === 'peek' ? ' peek' : '';
  const hintLabel = hintMode === 'off' ? '不显示' : hintMode === 'peek' ? '仅本手' : '持续显示';
  return (
    <div className="battle-actions">
      <button type="button" onClick={onUndo} disabled={!canUndo}><FaUndo />悔棋</button>
      <button type="button" onClick={onPass} disabled={disabled}><FaFlag />{lastMoveWasPass ? '终局' : '停着'}</button>
      <button type="button" onClick={onScore} disabled={disabled} className={scoreActive ? 'score-toggle active' : 'score-toggle'}><FaCalculator />局势判定</button>
      <button
        type="button"
        className={`recommendation-toggle${hintToggleClass}`}
        aria-pressed={hintMode !== 'off'}
        aria-label={`推荐落点：${hintLabel}`}
        onClick={onCycleHints}
        disabled={disabled}
      >
        <FaLightbulb />
        <span className={hintMode === 'peek' ? 'recommendation-label flashing' : 'recommendation-label'}>{recommendationLabel}</span>
        {showThinkingSpinner && <span className="thinking-spinner" aria-label="推荐落点计算中" />}
      </button>
    </div>
  );
}
