import type { Player } from '../../types';
import { PASS_MOVE } from './fastBoard';
import type { RecentMove } from './featuresV7Fast';

/**
 * Builds the most recent moves by walking a re-rooted search's root and path
 * histories backwards, reusing `out` when provided.
 */
export function takeRecentMoves(
  rootMoves: RecentMove[],
  pathMoves: RecentMove[],
  max: number,
  out: RecentMove[] = []
): RecentMove[] {
  out.length = 0;
  const pushCopy = (src: RecentMove) => {
    const idx = out.length;
    let dst = out[idx];
    if (!dst) {
      dst = { move: src.move, player: src.player };
      out[idx] = dst;
    } else {
      dst.move = src.move;
      dst.player = src.player;
    }
    out.length = idx + 1;
  };
  for (let i = pathMoves.length - 1; i >= 0 && out.length < max; i--) pushCopy(pathMoves[i]!);
  for (let i = rootMoves.length - 1; i >= 0 && out.length < max; i--) pushCopy(rootMoves[i]!);
  out.reverse();
  return out;
}

/** How many passes the game currently ends with, KataGo's consecutiveEndingPasses. */
export function countConsecutiveEndingPasses(moves: RecentMove[]): number {
  let count = 0;
  for (let i = moves.length - 1; i >= 0; i--) {
    if (moves[i]!.move !== PASS_MOVE) break;
    count++;
  }
  return count;
}

/**
 * KataGo's four-passes test in isAllowedRootMove: the opponent's last four moves
 * (every other entry back from the end) were all passes.
 */
export function opponentHasPassedFourTimes(moveHistory: RecentMove[], currentPlayer: Player): boolean {
  const lastIdx = moveHistory.length - 1;
  if (lastIdx < 6) return false;
  const opp: Player = currentPlayer === 'black' ? 'white' : 'black';
  for (const back of [0, 2, 4, 6]) {
    const m = moveHistory[lastIdx - back]!;
    if (m.move !== PASS_MOVE || m.player !== opp) return false;
  }
  return true;
}
