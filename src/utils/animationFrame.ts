export function getAnimationNow(): number {
  try {
    const now = globalThis.performance?.now;
    if (typeof now === 'function') return now.call(globalThis.performance);
  } catch {
    // Fall back below.
  }
  return Date.now();
}
