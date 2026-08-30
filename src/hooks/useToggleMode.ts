import { useState } from 'react';

export type ToggleMode = 'off' | 'always';

export const nextToggleMode = (mode: ToggleMode): ToggleMode =>
  mode === 'off' ? 'always' : 'off';

interface UseToggleModeOptions<TKey> {
  /** Changes whenever the underlying position or count moves. */
  key: TKey;
  /** Runs whenever the mode turns on. */
  onEnable?: () => void;
}

/**
 * off → always toggle used by the recommendation-hint and score judgment
 * buttons. "always" keeps the feature on until toggled off.
 */
export function useToggleMode<TKey>(options: UseToggleModeOptions<TKey>) {
  const [mode, setMode] = useState<ToggleMode>('off');
  const [lastKey, setLastKey] = useState(options.key);
  const keyChanged = options.key !== lastKey;

  if (keyChanged) {
    setLastKey(options.key);
  }

  const cycle = () => {
    const next = nextToggleMode(mode);
    setMode(next);
    if (next !== 'off') options.onEnable?.();
  };

  return { mode, cycle, keyChanged };
}
