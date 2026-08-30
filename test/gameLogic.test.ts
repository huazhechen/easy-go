import { describe, it, expect } from 'vitest';
import { boardsEqual, checkCaptures, getLiberties, simulateMove } from '../src/utils/gameLogic';
import { DEFAULT_BOARD_SIZE, type BoardState } from '../src/types';
import { useGameStore } from '../src/store/gameStore';

const createEmptyBoard = (): BoardState => {
  return Array(DEFAULT_BOARD_SIZE).fill(null).map(() => Array(DEFAULT_BOARD_SIZE).fill(null));
};

describe('Game Logic', () => {
  it('should compare boards efficiently', () => {
    const a = createEmptyBoard();
    const b = createEmptyBoard();
    expect(boardsEqual(a, b)).toBe(true);
    b[0][0] = 'black';
    expect(boardsEqual(a, b)).toBe(false);
    expect(boardsEqual([[null]], [[null, null]])).toBe(false);
  });

  it('should calculate liberties correctly', () => {
    const board = createEmptyBoard();
    board[0][0] = 'black';
    // Top-left corner: 2 liberties (0,1) and (1,0)
    const { liberties } = getLiberties(board, 0, 0);
    expect(liberties).toBe(2);
  });

  it('should capture stones with no liberties', () => {
    const board = createEmptyBoard();
    board[0][0] = 'white'; // Stone to be captured
    // Surround it
    // White at 0,0. Liberties at 0,1 and 1,0.
    // Place Black at 0,1 and 1,0.

    // checkCaptures simulates the capturing move itself: it places the stone
    // at (x, y) (a no-op when it is already there) and removes opponent
    // groups with no liberties left.
    const tentativeBoard = createEmptyBoard();
    tentativeBoard[0][0] = 'white';
    tentativeBoard[1][0] = 'black';
    tentativeBoard[0][1] = 'black'; // The capturing move

    const { captured, newBoard } = checkCaptures(tentativeBoard, 1, 0, 'black');

    expect(captured.length).toBe(1);
    expect(captured[0]).toEqual({ x: 0, y: 0 });
    expect(newBoard[0][1]).toBe('black');
    expect(newBoard[0][0]).toBeNull();
  });

  it('places the played stone in the simulated board', () => {
    const board = createEmptyBoard();
    const { newBoard } = checkCaptures(board, 3, 3, 'black');
    expect(newBoard[3]![3]).toBe('black');
  });

  it('simulates a legal move with captures in one pass', () => {
    const board = createEmptyBoard();
    board[0][0] = 'white';
    board[1][0] = 'black';

    // Black plays (x=1, y=0), capturing the white stone at (x=0, y=0).
    const result = simulateMove(board, 1, 0, 'black');
    expect(result.legal).toBe(true);
    expect(result.captured).toEqual([{ x: 0, y: 0 }]);
    expect(result.newBoard![0][0]).toBeNull();
    expect(result.newBoard![0][1]).toBe('black');
  });

  it('rejects occupied points, suicides, and ko repetitions as illegal', () => {
    const board = createEmptyBoard();
    board[0][0] = 'black';
    expect(simulateMove(board, 0, 0, 'white').legal).toBe(false);

    // Black at 0,1 and 1,0 with white on every remaining neighbor makes 0,0 a
    // suicide point for black.
    const suicideBoard = createEmptyBoard();
    suicideBoard[0][1] = 'black';
    suicideBoard[1][0] = 'black';
    suicideBoard[1][1] = 'white';
    suicideBoard[0][2] = 'white';
    suicideBoard[2][0] = 'white';
    expect(simulateMove(suicideBoard, 0, 0, 'black').legal).toBe(false);

    // A move whose resulting board equals previousBoard repeats the position.
    const oneStone = createEmptyBoard();
    oneStone[3][3] = 'black';
    expect(simulateMove(createEmptyBoard(), 3, 3, 'black', oneStone).legal).toBe(false);
  });

  it('ignores invalid store play coordinates instead of throwing', () => {
    const store = useGameStore.getState();
    store.startNewGame({ komi: 6.5, rules: 'japanese', boardSize: 19, handicap: 0 });

    expect(() => store.playMove(-1, 3)).not.toThrow();
    expect(() => store.playMove(3, -1)).not.toThrow();
    expect(() => store.playMove(DEFAULT_BOARD_SIZE, 3)).not.toThrow();

    const state = useGameStore.getState();
    expect(state.moveHistory).toHaveLength(0);
    expect(state.currentPlayer).toBe('black');
  });
});
