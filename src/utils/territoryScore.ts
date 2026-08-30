export interface TerritoryScore {
  black: number;
  white: number;
}

export interface ScoreResult {
  black: string;
  white: string;
  leader: string;
}

/** Counts territory marks plus captures, with komi awarded to white. */
export function countTerritoryPoints(
  territory: number[][],
  capturedBlack: number,
  capturedWhite: number,
  komi: number
): TerritoryScore {
  const values = territory.flat();
  if (values.length === 0) return { black: 0, white: komi };
  return {
    black: values.filter((value) => value >= 0).length + capturedWhite,
    white: values.filter((value) => value < 0).length + capturedBlack + komi,
  };
}

export function territoryLeader(score: TerritoryScore): string {
  return score.black >= score.white
    ? `黑方领先 ${(score.black - score.white).toFixed(1)} 目`
    : `白方领先 ${(score.white - score.black).toFixed(1)} 目`;
}

export function formatScoreResult(score: TerritoryScore): ScoreResult {
  return {
    black: `黑 ${score.black.toFixed(1)} 目`,
    white: `白 ${score.white.toFixed(1)} 目`,
    leader: territoryLeader(score),
  };
}
