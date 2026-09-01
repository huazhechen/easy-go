import { BOARD_AREA, BOARD_SIZE, PASS_MOVE } from './fastBoard';
import type { RecentMove } from './featuresV7Fast';

export const NUM_SYMMETRIES = 8;

let symPosMapBoardArea = 0;
let SYM_POS_MAP: Int16Array<ArrayBufferLike> = new Int16Array(0);

const buildSymPosMap = (): Int16Array<ArrayBufferLike> => {
  const n = BOARD_SIZE;
  const map = new Int16Array(NUM_SYMMETRIES * BOARD_AREA);
  for (let sym = 0; sym < NUM_SYMMETRIES; sym++) {
    const symOff = sym * BOARD_AREA;
    const mirror = sym >= 4;
    const rot = sym & 3;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const sx = mirror ? n - 1 - x : x;
        const sy = y;
        let tx: number;
        let ty: number;
        if (rot === 0) {
          tx = sx;
          ty = sy;
        } else if (rot === 1) {
          tx = sy;
          ty = n - 1 - sx;
        } else if (rot === 2) {
          tx = n - 1 - sx;
          ty = n - 1 - sy;
        } else {
          tx = n - 1 - sy;
          ty = sx;
        }
        map[symOff + y * n + x] = ty * n + tx;
      }
    }
  }
  return map;
};

export const getSymPosMap = (): Int16Array<ArrayBufferLike> => {
  const expectedSize = NUM_SYMMETRIES * BOARD_AREA;
  if (symPosMapBoardArea !== BOARD_AREA || SYM_POS_MAP.length !== expectedSize) {
    SYM_POS_MAP = buildSymPosMap();
    symPosMapBoardArea = BOARD_AREA;
  }
  return SYM_POS_MAP;
};

/**
 * Symmetries under which the root position is unchanged, KataGo's
 * SymmetryHelpers::markDuplicateMoveLocs (cpp/neuralnet/nninputs.cpp).
 *
 * KataGo compares stones only, which is sound because its analysis engine zeroes
 * the pre-root history. When this port is asked to keep that history instead, a
 * symmetry that moves one of the last five moves changes the network input and is
 * not a real duplicate, so it has to fix those moves too.
 */
export function computeValidRootSymmetries(args: {
  stones: Uint8Array;
  koPoint: number;
  recentMoves: RecentMove[];
  ignorePreRootHistory?: boolean;
}): number[] {
  const valid = [0];
  // A ko ban is not symmetric, so nothing may be treated as a duplicate.
  if (args.koPoint >= 0) return valid;

  const map = getSymPosMap();
  for (let sym = 1; sym < NUM_SYMMETRIES; sym++) {
    const off = sym * BOARD_AREA;
    let ok = true;
    for (let p = 0; p < BOARD_AREA; p++) {
      if (args.stones[p] !== args.stones[map[off + p]!]) {
        ok = false;
        break;
      }
    }
    if (ok && args.ignorePreRootHistory !== true) {
      for (const m of args.recentMoves) {
        if (m.move === PASS_MOVE) continue;
        if (map[off + m.move] !== m.move) {
          ok = false;
          break;
        }
      }
    }
    if (ok) valid.push(sym);
  }
  return valid;
}

/**
 * Marks every root move that is a symmetric copy of another, keeping one
 * representative. The iteration order is KataGo's, which keeps the representative
 * in the upper right for black:
 * https://senseis.xmp.net/?PlayingTheFirstMoveInTheUpperRightCorner
 */
export function markSymmetryDuplicateMoves(
  validSymmetries: number[],
  nextPlayerIsBlack: boolean
): Uint8Array | null {
  if (validSymmetries.length <= 1) return null;
  const map = getSymPosMap();
  const dup = new Uint8Array(BOARD_AREA);
  const n = BOARD_SIZE;

  const markFrom = (loc: number) => {
    if (dup[loc] === 1) return;
    for (const sym of validSymmetries) {
      if (sym === 0) continue;
      const symLoc = map[sym * BOARD_AREA + loc]!;
      if (symLoc !== loc) dup[symLoc] = 1;
    }
  };

  if (nextPlayerIsBlack) {
    for (let x = n - 1; x >= 0; x--) {
      for (let y = 0; y < n; y++) markFrom(y * n + x);
    }
  } else {
    for (let x = 0; x < n; x++) {
      for (let y = n - 1; y >= 0; y--) markFrom(y * n + x);
    }
  }
  return dup;
}

export function clampRootSymmetrySamples(samples?: number): number {
  if (typeof samples !== 'number' || !Number.isFinite(samples)) return 1;
  return Math.max(1, Math.min(NUM_SYMMETRIES, Math.floor(samples)));
}

/**
 * How many symmetries to average at the root.
 *
 * The net is only approximately symmetry-equivariant, so a single view of a position
 * carries real noise -- on the shipped 6-block net that is worth up to ~0.25 of ownership
 * on a point. Averaging several views cancels most of it. It costs one extra batched
 * evaluation per position, which is small next to the hundreds a search does, so it is
 * only skipped on the pure-JS 'cpu' fallback where a single forward pass already
 * dominates.
 */
export function rootSymmetrySamplesForBackend(backend: string): number {
  if (backend === 'webgpu') return NUM_SYMMETRIES;
  if (backend === 'wasm') return 4;
  return 1;
}
