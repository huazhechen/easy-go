import { describe, expect, it } from 'vitest';
import { countTerritoryPoints, formatScoreResult, territoryLeader } from '../src/utils/territoryScore';

describe('territory scoring', () => {
  it('counts marked points plus captures, with komi to white', () => {
    const territory = [
      [1, 1, -1],
      [1, 0, -1],
      [-1, -1, -1],
    ];
    expect(countTerritoryPoints(territory, 2, 1, 6.5)).toEqual({ black: 5, white: 13.5 });
  });

  it('falls back to komi-only totals when no territory is available', () => {
    expect(countTerritoryPoints([], 0, 0, 6.5)).toEqual({ black: 0, white: 6.5 });
  });

  it('names the leader from black perspective', () => {
    expect(territoryLeader({ black: 10, white: 6.5 })).toBe('黑方领先 3.5 目');
    expect(territoryLeader({ black: 4, white: 8.5 })).toBe('白方领先 4.5 目');
  });

  it('formats a readable score result', () => {
    expect(formatScoreResult({ black: 4, white: 8.5 })).toEqual({
      black: '黑 4.0 目',
      white: '白 8.5 目',
      leader: '白方领先 4.5 目',
    });
  });
});
