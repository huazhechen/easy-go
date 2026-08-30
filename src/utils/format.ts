export function formatModelBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Milliseconds as a whole-second Chinese label, e.g. "10秒". */
export function formatThinkingMs(ms: number): string {
  return `${ms / 1000}秒`;
}

/** Milliseconds as a compact seconds label, e.g. "10s". */
export function formatThinkingSeconds(ms: number): string {
  return `${ms / 1000}s`;
}

export function formatIterations(value: number): string {
  if (value < 1000) return String(Math.max(0, Math.floor(value)));
  if (value < 1_000_000) return `${(value / 1000).toFixed(1).replace(/\.0$/, '')}K`;
  return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
}

/** Win rate as a 0–99% label; values at or above 99.9% read as "∞". */
export function percent(value: number): string {
  if (value >= 0.999) return '∞';
  const rounded = Math.round(value * 100);
  return `${Math.min(99, rounded)}`;
}
