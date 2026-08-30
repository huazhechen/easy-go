import { useToggleMode } from './useToggleMode';

/**
 * Recommendation-hint visibility. "always" keeps the hints on until the
 * player turns them off.
 */
export function useHintMode(moveCount: number, onEnable: () => void) {
  const { mode: hintMode, cycle } = useToggleMode({
    key: moveCount,
    onEnable,
  });
  return { hintMode, hintsVisible: hintMode !== 'off', cycleHintMode: cycle };
}
