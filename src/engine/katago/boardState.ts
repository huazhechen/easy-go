import type { BoardState } from '../../types';
import { BOARD_AREA, BOARD_SIZE } from './fastBoard';

/** Writes the app board into a flat engine stone array (0 empty, 1 black, 2 white). */
export function boardStateToStonesInto(board: BoardState, out: Uint8Array): void {
  out.fill(0);
  for (let y = 0; y < BOARD_SIZE; y++) {
    const row = board[y];
    for (let x = 0; x < BOARD_SIZE; x++) {
      const value = row?.[x] ?? null;
      if (!value) continue;
      out[y * BOARD_SIZE + x] = value === 'black' ? 1 : 2;
    }
  }
}

/** Convenience wrapper returning a freshly allocated flat stone array. */
export function boardStateToStones(board: BoardState): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(BOARD_AREA);
  boardStateToStonesInto(board, out);
  return out;
}
