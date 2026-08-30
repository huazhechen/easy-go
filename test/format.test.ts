import { describe, expect, it } from 'vitest';
import { formatIterations, formatModelBytes, formatThinkingMs, formatThinkingSeconds, percent } from '../src/utils/format';

describe('display formatters', () => {
  it('formats model byte counts in MB', () => {
    expect(formatModelBytes(0)).toBe('0 MB');
    expect(formatModelBytes(10 * 1024 * 1024)).toBe('10.0 MB');
    expect(formatModelBytes(Number.NaN)).toBe('0 MB');
  });

  it('formats thinking time as seconds', () => {
    expect(formatThinkingMs(10_000)).toBe('10秒');
    expect(formatThinkingSeconds(10_000)).toBe('10s');
  });

  it('formats iteration counts with K/M suffixes', () => {
    expect(formatIterations(0)).toBe('0');
    expect(formatIterations(999)).toBe('999');
    expect(formatIterations(2100)).toBe('2.1K');
    expect(formatIterations(2_100_000)).toBe('2.1M');
  });

  it('caps win-rate labels at 99 and reads 99.9%+ as infinite', () => {
    expect(percent(0.5)).toBe('50');
    expect(percent(0.999)).toBe('∞');
    expect(percent(1)).toBe('∞');
  });
});
