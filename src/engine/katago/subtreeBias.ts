import { BLACK, BOARD_SIZE, EMPTY, PASS_MOVE, type StoneColor } from './fastBoard';

let subtreeValueBiasFactor = 0.45;

export const getSubtreeValueBiasFactor = (): number => subtreeValueBiasFactor;

export const setSubtreeValueBiasFactor = (value: number): void => {
  subtreeValueBiasFactor = value;
};

export const SUBTREE_VALUE_BIAS_WEIGHT_EXPONENT = 0.85;
const SUBTREE_BIAS_PATTERN_RADIUS = 2; // KataGo hashes a 5x5 window

export type SubtreeBiasEntry = { deltaUtilitySum: number; weightSum: number };

/**
 * KataGo's SubtreeValueBiasTable, keyed the same way: the move that led here, the
 * move before that, the local 5x5 pattern (with atari marked) on the board before
 * the move, whose turn it is, and any ko ban.
 */
export class SubtreeBiasTable {
  private entries = new Map<string, SubtreeBiasEntry>();
  epoch = 0;

  get(key: string): SubtreeBiasEntry {
    let entry = this.entries.get(key);
    if (!entry) {
      entry = { deltaUtilitySum: 0, weightSum: 0 };
      this.entries.set(key, entry);
    }
    return entry;
  }

  /** Drops everything, e.g. when the search re-roots and old nodes fall away. */
  reset(): void {
    this.entries.clear();
    this.epoch++;
  }
}

export function buildSubtreeBiasKey(args: {
  stones: Uint8Array; // board BEFORE the move
  libertyMap: Uint8Array;
  move: number;
  parentMove: number;
  koPoint: number;
  pla: StoneColor;
}): string {
  const { stones, libertyMap, move, parentMove, koPoint, pla } = args;
  let key = `${pla}|${parentMove}|${move}|${koPoint}`;
  if (move === PASS_MOVE) return key;

  const x = move % BOARD_SIZE;
  const y = (move / BOARD_SIZE) | 0;
  const r = SUBTREE_BIAS_PATTERN_RADIUS;
  const dxMin = Math.max(-r, -x);
  const dxMax = Math.min(r, BOARD_SIZE - 1 - x);
  const dyMin = Math.max(-r, -y);
  const dyMax = Math.min(r, BOARD_SIZE - 1 - y);
  key += '|';
  for (let dy = dyMin; dy <= dyMax; dy++) {
    for (let dx = dxMin; dx <= dxMax; dx++) {
      const pos = (y + dy) * BOARD_SIZE + (x + dx);
      const color = stones[pos] as StoneColor;
      key += color === EMPTY ? '.' : color === BLACK ? (libertyMap[pos] === 1 ? 'b' : 'B') : libertyMap[pos] === 1 ? 'w' : 'W';
    }
    key += '/';
  }
  return key;
}
