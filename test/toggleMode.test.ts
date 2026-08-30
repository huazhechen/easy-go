import { describe, expect, it } from 'vitest';
import { nextToggleMode } from '../src/hooks/useToggleMode';

describe('nextToggleMode', () => {
  it('cycles off → always → off', () => {
    expect(nextToggleMode('off')).toBe('always');
    expect(nextToggleMode('always')).toBe('off');
  });
});
