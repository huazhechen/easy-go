import { useState } from 'react';

export type TriStateMode = 'off' | 'peek' | 'always';

export const nextTriStateMode = (mode: TriStateMode): TriStateMode =>
  mode === 'off' ? 'peek' : mode === 'peek' ? 'always' : 'off';

interface UseTriStateModeOptions<TKey> {
  /** Changes whenever the underlying position or count moves. */
  key: TKey;
  /** Whether a key change should also expire an active "peek" mode. */
  expirePeekOn: (previous: TKey, next: TKey) => boolean;
  /** Runs whenever the mode turns on (peek or always). */
  onEnable?: () => void;
}

/**
 * off → peek → always cycling used by the recommendation-hint and score
 * judgment toggles. "peek" renders for the current key only and expires when
 * expirePeekOn says a key change ends it; "always" stays on until toggled off.
 */
export function useTriStateMode<TKey>(options: UseTriStateModeOptions<TKey>) {
  const [mode, setMode] = useState<TriStateMode>('off');
  const [lastKey, setLastKey] = useState(options.key);
  const keyChanged = options.key !== lastKey;

  if (keyChanged) {
    setLastKey(options.key);
    if (options.expirePeekOn(lastKey, options.key) && mode === 'peek') {
      setMode('off');
    }
  }

  const cycle = () => {
    const next = nextTriStateMode(mode);
    setMode(next);
    if (next !== 'off') options.onEnable?.();
  };

  return { mode, cycle, keyChanged };
}
