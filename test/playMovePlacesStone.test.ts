import { afterEach, describe, expect, it } from 'vitest';
import { useGameStore } from '../src/store/gameStore';

describe('GameStore playMove', () => {
  afterEach(() => {
    useGameStore.getState().startNewGame({ komi: 6.5, rules: 'japanese', boardSize: 19, handicap: 0 });
  });

  it('places the played stone on the board and advances the turn', () => {
    const store = useGameStore.getState();
    store.startNewGame({ komi: 6.5, rules: 'japanese', boardSize: 19, handicap: 0 });

    store.playMove(3, 3);

    const state = useGameStore.getState();
    expect(state.board[3]![3]).toBe('black');
    expect(state.currentPlayer).toBe('white');
    expect(state.moveHistory).toEqual([{ x: 3, y: 3, player: 'black' }]);
    expect(state.currentNode.gameState.board[3]![3]).toBe('black');
  });

  it('applies captures and records them in the node state', () => {
    const store = useGameStore.getState();
    store.startNewGame({ komi: 6.5, rules: 'japanese', boardSize: 19, handicap: 0 });
    // White stone at 3,3; black surrounds it with 3,2, 2,3, 3,4, then 4,3.
    store.playMove(3, 2);
    store.playMove(3, 3);
    store.playMove(2, 3);
    store.playMove(4, 4); // White escape move elsewhere
    store.playMove(3, 4);
    store.playMove(4, 5); // White escape move elsewhere
    store.playMove(4, 3);

    const state = useGameStore.getState();
    expect(state.board[3]![3]).toBeNull();
    expect(state.capturedWhite).toBe(1);
  });

  it('rejects an immediate ko recapture', () => {
    const store = useGameStore.getState();
    store.startNewGame({ komi: 6.5, rules: 'japanese', boardSize: 9, handicap: 0 });

    // Build a ko around (4,4): white's ko stone at (4,3) with its only
    // liberty at (4,4), surrounded on the other three sides by black.
    const setup: Array<[number, number]> = [
      [4, 2], [4, 5], [3, 3], [3, 4], [5, 3], [5, 4], [0, 0], [4, 3],
    ];
    for (const [x, y] of setup) store.playMove(x, y);

    // Black captures the ko stone; white's immediate recapture at (4,3) would
    // repeat the position from two plies ago, so it must be rejected.
    store.playMove(4, 4);
    const before = useGameStore.getState();
    expect(before.currentPlayer).toBe('white');
    expect(before.board[3]![4]).toBeNull();
    expect(before.board[4]![4]).toBe('black');

    store.playMove(4, 3);
    const after = useGameStore.getState();
    expect(after.currentNode.id).toBe(before.currentNode.id);
    expect(after.moveHistory).toHaveLength(setup.length + 1);
    expect(after.board[4]![4]).toBe('black');
  });
});
