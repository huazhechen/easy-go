import { useTriStateMode } from './useTriStateMode';

/**
 * Recommendation-hint visibility. "peek" (仅本手) shows the hints for the
 * current move only and expires as soon as a new stone is played; "always"
 * keeps them on until the player turns them off.
 */
export function useHintMode(moveCount: number, onEnable: () => void) {
  const { mode: hintMode, cycle } = useTriStateMode({
    key: moveCount,
    // History navigation and undos leave a peek active; only a new move ends it.
    expirePeekOn: (previous, next) => next > previous,
    onEnable,
  });
  return { hintMode, hintsVisible: hintMode !== 'off', cycleHintMode: cycle };
}
