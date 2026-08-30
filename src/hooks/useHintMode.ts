import { useState } from 'react';

export type HintMode = 'off' | 'peek' | 'always';

/**
 * Recommendation-hint visibility. "peek" (仅本手) shows the hints for the
 * current move only and expires as soon as a new stone is played; "always"
 * keeps them on until the player turns them off.
 */
export function useHintMode(moveCount: number, onEnable: () => void) {
  const [hintMode, setHintMode] = useState<HintMode>('off');
  const [lastMoveCount, setLastMoveCount] = useState(moveCount);

  // History navigation and undos leave a peek active; only a new move ends it.
  if (hintMode === 'peek' && moveCount > lastMoveCount) {
    setLastMoveCount(moveCount);
    setHintMode('off');
  } else if (lastMoveCount !== moveCount) {
    setLastMoveCount(moveCount);
  }

  const cycleHintMode = () => {
    const next: HintMode = hintMode === 'off' ? 'peek' : hintMode === 'peek' ? 'always' : 'off';
    setHintMode(next);
    if (next !== 'off') onEnable();
  };

  return { hintMode, hintsVisible: hintMode !== 'off', cycleHintMode };
}
