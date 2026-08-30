import { describe, expect, it } from 'vitest';
import { interpolateEarly } from '../src/engine/katago/chosenMove';

// KataGo Search::interpolateEarly, cpp/search/searchhelpers.cpp.
describe('interpolateEarly', () => {
  it('starts at the early value and decays toward the late one', () => {
    const args = { halflife: 80, earlyValue: 0.85, value: 0.7, boardWidth: 19, boardHeight: 19 };
    expect(interpolateEarly({ ...args, turnNumber: 0 })).toBeCloseTo(0.85, 10);
    expect(interpolateEarly({ ...args, turnNumber: 80 })).toBeCloseTo(0.775, 10);
    expect(interpolateEarly({ ...args, turnNumber: 160 })).toBeCloseTo(0.7375, 10);
  });

  it('rescales the halflife for smaller boards', () => {
    const args = { halflife: 80, earlyValue: 0.85, value: 0.7, turnNumber: 80 };
    expect(interpolateEarly({ ...args, boardWidth: 9, boardHeight: 9 })).toBeCloseTo(
      0.7 + (0.85 - 0.7) * 0.5 ** (19 / 9),
      10
    );
    expect(interpolateEarly({ ...args, boardWidth: 19, boardHeight: 19 })).toBeCloseTo(0.775, 10);
  });
});
