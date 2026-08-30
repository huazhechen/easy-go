import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CandidateMove } from '../src/types';

const analyzeMock = vi.fn();

vi.mock('../src/engine/katago/client', () => ({
  getKataGoEngineClient: () => ({
    init: vi.fn().mockResolvedValue(undefined),
    analyze: analyzeMock,
    getEngineInfo: () => ({ backend: 'test', modelName: 'test-model' }),
  }),
  isKataGoCanceledError: () => false,
}));

const passMove: CandidateMove = {
  x: -1,
  y: -1,
  winRate: 0.5,
  scoreLead: 0,
  visits: 16,
  pointsLost: 0,
  order: 0,
  prior: 1,
};

describe('AI move strength settings', () => {
  beforeEach(() => {
    analyzeMock.mockReset();
    analyzeMock.mockImplementation(async (args: { visits?: number }) => ({
      rootWinRate: 0.5,
      rootScoreLead: 0,
      rootScoreSelfplay: 0,
      rootScoreStdev: 0,
      rootVisits: args.visits ?? 16,
      moves: [passMove],
      ownership: new Float32Array(19 * 19),
      ownershipStdev: new Float32Array(19 * 19),
      policy: new Float32Array(19 * 19 + 1),
    }));
  });

  it('disables root noise and NN randomization for actual AI moves', async () => {
    const { useGameStore } = await import('../src/store/gameStore');
    const store = useGameStore.getState();
    store.startNewGame({ komi: 6.5, rules: 'japanese', boardSize: 19, handicap: 0 });

    useGameStore.setState((state) => ({
      isAiPlaying: true,
      aiColor: 'black',
      settings: {
        ...state.settings,
        katagoWideRootNoise: 0.5,
        katagoNnRandomize: true,
        katagoMaxTimeMs: 25,
      },
    }));

    useGameStore.getState().makeAiMove();

    await vi.waitFor(() => expect(analyzeMock).toHaveBeenCalled());
    expect(analyzeMock.mock.calls[0]?.[0]).toMatchObject({
      wideRootNoise: 0,
      nnRandomize: false,
      visits: 32,
      maxTimeMs: 1000,
    });
    await vi.waitFor(() => expect(useGameStore.getState().currentNode.move).toEqual({
      x: -1,
      y: -1,
      player: 'black',
    }));

    useGameStore.getState().toggleContinuousAnalysis(false);
    useGameStore.getState().startNewGame({ komi: 6.5, rules: 'japanese', boardSize: 19, handicap: 0 });
  });
});
