import { describe, expect, it, vi } from 'vitest';
import { useGameStore } from '../src/store/gameStore';
import {
  parseStoredGame,
  parseStoredOpeningSettings,
  serializeOpeningSettings,
  serializeStoredGame,
} from '../src/store/gamePersistence';

const snapshotCurrentGame = () => {
  const state = useGameStore.getState();
  return {
    rootNode: state.rootNode,
    currentNode: state.currentNode,
    activeBranchChildIds: state.activeBranchChildIds,
    isAiPlaying: state.isAiPlaying,
    aiColor: state.aiColor,
  };
};

describe('game persistence', () => {
  it('round-trips a branched game tree and resumes the current node', () => {
    const store = useGameStore.getState();
    store.startNewGame({ komi: 6.5, rules: 'japanese', boardSize: 9, handicap: 0 });
    const rootId = useGameStore.getState().rootNode.id;

    store.playMove(4, 4); // black
    store.playMove(3, 3); // white
    store.playMove(5, 5); // black
    store.undoMove();
    store.playMove(15, 15); // white, sibling branch of (5,5)

    const state = useGameStore.getState();
    const expectedBoard = state.board;
    const expectedCurrentId = state.currentNode.id;
    const expectedBranches = state.activeBranchChildIds;
    const parsed = parseStoredGame(serializeStoredGame(snapshotCurrentGame()));

    expect(parsed).not.toBeNull();
    expect(parsed!.rootNode.id).toBe(rootId);
    expect(parsed!.currentNode.id).toBe(expectedCurrentId);
    expect(parsed!.currentNode.gameState.board).toEqual(expectedBoard);
    expect(parsed!.currentNode.gameState.currentPlayer).toBe(state.currentPlayer);
    expect(parsed!.currentNode.gameState.moveHistory).toEqual(state.moveHistory);
    expect(parsed!.activeBranchChildIds).toEqual(expectedBranches);

    // Parent links are rebuilt so navigation works after a restore.
    let cursor = parsed!.currentNode;
    while (cursor.parent) cursor = cursor.parent;
    expect(cursor.id).toBe(rootId);
    expect(parsed!.currentNode.parent?.children.map((child) => child.id)).toContain(expectedCurrentId);
  });

  it('drops engine analysis results and keeps requested-visit counts', () => {
    const store = useGameStore.getState();
    store.startNewGame({ komi: 6.5, rules: 'japanese', boardSize: 9, handicap: 0 });
    const state = useGameStore.getState();
    state.currentNode.analysis = {
      rootWinRate: 0.6,
      rootScoreLead: 2.5,
      moves: [],
      territory: Array.from({ length: 9 }, () => Array.from({ length: 9 }, () => 0)),
    } as never;
    state.currentNode.analysisVisitsRequested = 128;

    const serialized = serializeStoredGame(snapshotCurrentGame());
    expect(serialized).not.toContain('rootWinRate');
    const parsed = parseStoredGame(serialized);
    expect(parsed!.currentNode.analysis).toBeNull();
    expect(parsed!.currentNode.analysisVisitsRequested).toBe(128);
  });

  it('rejects malformed stored games', () => {
    expect(parseStoredGame('not json')).toBeNull();
    expect(parseStoredGame('{}')).toBeNull();
    expect(
      parseStoredGame(JSON.stringify({ version: 1, rootNode: { id: 'x', children: [] }, currentNodeId: 'missing' }))
    ).toBeNull();
    expect(parseStoredGame(JSON.stringify({ version: 99 }))).toBeNull();
  });

  it('round-trips opening settings', () => {
    const settings = { boardSize: 13 as const, humanColor: 'white' as const, selfPlay: false };
    expect(parseStoredOpeningSettings(serializeOpeningSettings(settings))).toEqual(settings);
    expect(parseStoredOpeningSettings('{}')).toBeNull();
    expect(
      parseStoredOpeningSettings(JSON.stringify({ boardSize: 8, humanColor: 'black', selfPlay: false }))
    ).toBeNull();
    expect(
      parseStoredOpeningSettings(JSON.stringify({ boardSize: 9, humanColor: 'red', selfPlay: false }))
    ).toBeNull();
  });

  it('hydrates the store from the saved game on the next load', async () => {
    const map = new Map<string, string>();
    const fakeStorage: Storage = {
      get length() {
        return map.size;
      },
      clear: () => map.clear(),
      getItem: (key) => map.get(key) ?? null,
      key: (index) => [...map.keys()][index] ?? null,
      removeItem: (key) => void map.delete(key),
      setItem: (key, value) => void map.set(key, value),
    };
    Object.defineProperty(globalThis, 'localStorage', { value: fakeStorage, configurable: true });
    try {
      const first = await import('../src/store/gameStore');
      first.useGameStore.getState().startNewGame({ komi: 6.5, rules: 'japanese', boardSize: 9, handicap: 0 });
      first.useGameStore.getState().playMove(4, 4);
      first.useGameStore.getState().playMove(3, 3);
      first.useGameStore.getState().toggleAi('black');
      const before = first.useGameStore.getState();
      expect(map.get('easy-go:game:v1')).toBeTruthy();

      vi.resetModules();
      const second = await import('../src/store/gameStore');
      const after = second.useGameStore.getState();
      expect(after.restoredFromStorage).toBe(true);
      expect(after.rootNode.id).toBe(before.rootNode.id);
      expect(after.currentNode.id).toBe(before.currentNode.id);
      expect(after.board).toEqual(before.board);
      expect(after.moveHistory).toEqual(before.moveHistory);
      expect(after.isAiPlaying).toBe(true);
      expect(after.aiColor).toBe('black');
    } finally {
      delete (globalThis as Record<string, unknown>).localStorage;
    }
  });
});
