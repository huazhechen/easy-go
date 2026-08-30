import { describe, expect, it } from 'vitest';
import { nextTriStateMode } from '../src/hooks/useTriStateMode';

describe('nextTriStateMode', () => {
  it('cycles off → peek → always → off', () => {
    expect(nextTriStateMode('off')).toBe('peek');
    expect(nextTriStateMode('peek')).toBe('always');
    expect(nextTriStateMode('always')).toBe('off');
  });
});
