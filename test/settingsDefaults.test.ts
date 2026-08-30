import { describe, expect, it } from 'vitest';
import { DEFAULT_KATAGO_VISITS, useGameStore } from '../src/store/gameStore';

describe('settings defaults', () => {
  it('defaults full-strength KataGo visits to 5000', () => {
    expect(DEFAULT_KATAGO_VISITS).toBe(5000);
    expect(useGameStore.getState().settings.katagoVisits).toBe(5000);
  });
});
