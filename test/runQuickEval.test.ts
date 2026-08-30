import { afterEach, describe, expect, it, vi } from 'vitest';
import { useGameStore } from '../src/store/gameStore';

const { quickEvalMock } = vi.hoisted(() => ({ quickEvalMock: vi.fn() }));

vi.mock('../src/engine/katago/client', () => ({
  getKataGoEngineClient: () => ({
    getEngineInfo: () => ({ backend: 'wasm', modelName: 'test-model' }),
    quickEval: quickEvalMock,
  }),
  isKataGoCanceledError: (err: unknown) => !!(err as { canceled?: boolean })?.canceled,
}));

const payload = () => ({
  rootWinRate: 0.6,
  rootScoreLead: 2.5,
  rootScoreSelfplay: 0.5,
  rootScoreStdev: 10,
  rootVisits: 0,
  moves: [],
  ownership: new Float32Array(81).fill(1),
});

describe('GameStore runQuickEval', () => {
  afterEach(() => {
    quickEvalMock.mockReset();
    useGameStore.getState().startNewGame({ komi: 6.5, rules: 'japanese', boardSize: 9, handicap: 0 });
  });

  it('stores a network-only read for the current node', async () => {
    useGameStore.getState().startNewGame({ komi: 6.5, rules: 'japanese', boardSize: 9, handicap: 0 });
    quickEvalMock.mockResolvedValue(payload());

    const result = await useGameStore.getState().runQuickEval();
    const state = useGameStore.getState();

    expect(result?.rootWinRate).toBe(0.6);
    expect(state.quickEvalData?.nodeId).toBe(state.currentNode.id);
    expect(state.quickEvalData?.result.territory).toHaveLength(9);
    expect(state.engineStatus).toBe('ready');
    expect(state.engineBackend).toBe('wasm');
  });

  it('discards the read when the position changed while it ran', async () => {
    useGameStore.getState().startNewGame({ komi: 6.5, rules: 'japanese', boardSize: 9, handicap: 0 });
    let resolve!: (value: unknown) => void;
    quickEvalMock.mockReturnValue(new Promise((r) => { resolve = r; }));

    const pending = useGameStore.getState().runQuickEval();
    useGameStore.getState().playMove(4, 4);
    resolve(payload());
    await pending;

    const state = useGameStore.getState();
    expect(state.quickEvalData).toBeNull();
    expect(state.currentNode.move).toEqual({ x: 4, y: 4, player: 'black' });
  });
});
