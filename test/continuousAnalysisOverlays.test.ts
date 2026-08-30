import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextContinuousAnalysisVisits, useGameStore } from '../src/store/gameStore';
import { AnalysisQueueCanceledError } from '../src/utils/analysisQueue';

const realRunAnalysis = useGameStore.getState().runAnalysis;
const pendingAnalysis = () => new Promise<void>(() => undefined);

const overlayKeys = [
  'analysisShowChildren',
  'analysisShowEval',
  'analysisShowHints',
  'analysisShowPolicy',
  'analysisShowOwnership',
] as const;

const setOverlays = (values: Partial<Record<(typeof overlayKeys)[number], boolean>>) => {
  useGameStore.setState((state) => ({
    settings: { ...state.settings, ...values },
  }));
};

const readOverlays = () => {
  const { settings } = useGameStore.getState();
  return Object.fromEntries(overlayKeys.map((key) => [key, settings[key]]));
};

describe('turning on continuous analysis', () => {
  it('grows each outer-search target by ceil(current * 1.2 + 32)', () => {
    expect(nextContinuousAnalysisVisits(0)).toBe(32);
    expect(nextContinuousAnalysisVisits(32)).toBe(71);
    expect(nextContinuousAnalysisVisits(71)).toBe(118);
    expect(nextContinuousAnalysisVisits(16_383)).toBe(16_384);
  });

  beforeEach(() => {
    vi.useFakeTimers();
    useGameStore.setState({
      isContinuousAnalysis: false,
      isAnalysisMode: false,
      isAiPlaying: false,
      isAiThinking: false,
      aiColor: null,
      runAnalysis: vi.fn(pendingAnalysis),
    });
  });

  afterEach(() => {
    useGameStore.setState({
      isContinuousAnalysis: false,
      isAnalysisMode: false,
      runAnalysis: realRunAnalysis,
    });
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it('keeps the overlay setup the user already chose', () => {
    setOverlays({
      analysisShowChildren: true,
      analysisShowEval: true,
      analysisShowHints: false,
      analysisShowPolicy: false,
      analysisShowOwnership: true,
    });

    useGameStore.getState().toggleContinuousAnalysis(true);

    expect(readOverlays()).toEqual({
      analysisShowChildren: true,
      analysisShowEval: true,
      analysisShowHints: false,
      analysisShowPolicy: false,
      analysisShowOwnership: true,
    });
  });

  it('falls back to top move hints when no overlay would be drawn', () => {
    setOverlays({
      analysisShowChildren: false,
      analysisShowEval: false,
      analysisShowHints: false,
      analysisShowPolicy: false,
      analysisShowOwnership: false,
    });

    useGameStore.getState().toggleContinuousAnalysis(true);

    expect(readOverlays()).toEqual({
      analysisShowChildren: false,
      analysisShowEval: false,
      analysisShowHints: true,
      analysisShowPolicy: false,
      analysisShowOwnership: false,
    });
  });

  it('turns analysis mode on so the overlays it enables can draw', () => {
    useGameStore.getState().toggleContinuousAnalysis(true);

    expect(useGameStore.getState().isAnalysisMode).toBe(true);
    expect(useGameStore.getState().isContinuousAnalysis).toBe(true);
  });

  it('continues searching after a position change cancels the active request', async () => {
    const runAnalysis = vi.fn()
      .mockRejectedValueOnce(new AnalysisQueueCanceledError('Started new game'))
      .mockImplementation(pendingAnalysis);
    useGameStore.setState({ runAnalysis });

    useGameStore.getState().toggleContinuousAnalysis(true);
    await vi.waitFor(() => expect(runAnalysis).toHaveBeenCalledTimes(1));

    expect(runAnalysis).toHaveBeenNthCalledWith(1, expect.objectContaining({
      visits: 32,
      maxTimeMs: 1000,
      reportEveryMs: 0,
    }));

    await vi.advanceTimersByTimeAsync(0);
    expect(runAnalysis).toHaveBeenCalledTimes(2);
  });

  it('runs the latest position after the current inner search finishes', async () => {
    let finishFirst!: () => void;
    const firstRound = new Promise<void>((resolve) => {
      finishFirst = resolve;
    });
    const searchedNodeIds: string[] = [];
    const runAnalysis = vi.fn(() => {
      searchedNodeIds.push(useGameStore.getState().currentNode.id);
      return searchedNodeIds.length === 1 ? firstRound : pendingAnalysis();
    });
    useGameStore.setState({ runAnalysis });

    const firstNodeId = useGameStore.getState().currentNode.id;
    useGameStore.getState().toggleContinuousAnalysis(true);
    expect(searchedNodeIds).toEqual([firstNodeId]);

    useGameStore.getState().playMove(0, 0);
    const latestNodeId = useGameStore.getState().currentNode.id;
    finishFirst();
    await vi.waitFor(() => expect(runAnalysis).toHaveBeenCalledTimes(2));

    expect(searchedNodeIds).toEqual([firstNodeId, latestNodeId]);
  });
});
