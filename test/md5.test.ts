import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { md5Hex } from '../src/utils/md5';

describe('md5Hex', () => {
  it('matches RFC 1321 test vectors', () => {
    expect(md5Hex(new TextEncoder().encode(''))).toBe('d41d8cd98f00b204e9800998ecf8427e');
    expect(md5Hex(new TextEncoder().encode('abc'))).toBe('900150983cd24fb0d6963f7d28e17f72');
    expect(md5Hex(new TextEncoder().encode('The quick brown fox jumps over the lazy dog'))).toBe(
      '9e107d9d372bb6826bd81d3542a419d6'
    );
  });

  it('matches node crypto on the hosted model files when present', () => {
    for (const file of ['katago-small.bin.gz', 'katago-b10.bin.gz', 'katago-b18.bin.gz']) {
      const p = `public/models/${file}`;
      if (!existsSync(p)) continue;
      const bytes = new Uint8Array(readFileSync(p));
      expect(md5Hex(bytes), file).toBe(createHash('md5').update(bytes).digest('hex'));
    }
  });
});
