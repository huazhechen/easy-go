import { useEffect, useState } from 'react';

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

/**
 * The win rate shown while a freshly played node has no analysis yet: the last
 * useful estimate is held over instead of flashing 50%, and the root position
 * resets to 50% until the engine reports its first result.
 */
export function useDisplayWinRate(args: {
  rawWinRate: number | null | undefined;
  rootVisits: number | null | undefined;
  isRoot: boolean;
  positionKey: string;
}): number {
  const { rawWinRate, rootVisits, isRoot, positionKey } = args;
  const [fallbackWinRate, setFallbackWinRate] = useState(0.5);
  // KataGo can publish an initial 50% placeholder before the first search
  // visits arrive; that frame must not overwrite the previous estimate.
  // 0 visits is the network-only quick read, which is a real estimate.
  const analyzed =
    typeof rawWinRate === 'number'
    && Number.isFinite(rawWinRate)
    && (rootVisits == null || rootVisits === 0 || rootVisits > 1)
      ? clamp01(rawWinRate)
      : null;

  useEffect(() => {
    if (analyzed === null) return;
    const timer = window.setTimeout(() => setFallbackWinRate(analyzed), 0);
    return () => window.clearTimeout(timer);
  }, [analyzed]);

  useEffect(() => {
    if (!isRoot) return;
    const timer = window.setTimeout(() => setFallbackWinRate(0.5), 0);
    return () => window.clearTimeout(timer);
  }, [isRoot, positionKey]);

  return analyzed ?? fallbackWinRate;
}
