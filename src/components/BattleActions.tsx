import { FaCalculator, FaFlag, FaLightbulb, FaUndo } from 'react-icons/fa';
import type { HintMode } from '../hooks/useHintMode';
import type { ScoreMode } from '../hooks/useScoreJudgment';

interface BattleActionsProps {
  canUndo: boolean;
  disabled: boolean;
  lastMoveWasPass: boolean;
  hintMode: HintMode;
  scoreMode: ScoreMode;
  recommendationLabel: string;
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
  showThinkingSpinner,
  onUndo,
  onPass,
  onCycleScore,
  onCycleHints,
}: BattleActionsProps) {
  const hintToggleClass = hintMode === 'always' ? ' active' : hintMode === 'peek' ? ' peek' : '';
  const hintLabel = hintMode === 'off' ? '不显示' : hintMode === 'peek' ? '仅本手' : '持续显示';
  const scoreToggleClass = scoreMode === 'always' ? ' active' : scoreMode === 'peek' ? ' peek' : '';
  const scoreLabel = scoreMode === 'off' ? '不显示' : scoreMode === 'peek' ? '临时开启' : '锁定开启';
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
        <span className={scoreMode === 'peek' ? 'score-label flashing' : 'score-label'}>局势判定</span>
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
        <span className={hintMode === 'peek' ? 'recommendation-label flashing' : 'recommendation-label'}>{recommendationLabel}</span>
        {showThinkingSpinner && <span className="thinking-spinner" aria-label="推荐落点计算中" />}
      </button>
    </div>
  );
}
