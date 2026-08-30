import { useCallback, useEffect, useState } from 'react';
import { useGameStore } from '../store/gameStore';
import { countTerritoryPoints, formatScoreResult, type ScoreResult } from '../utils/territoryScore';

export type ScoreMode = 'off' | 'peek' | 'always';

/**
 * Score judgment renders whatever the store's cheap network-only read already
 * holds for the current position; the button only toggles the mode/rendering
 * and never starts a search, so there is no loading overlay. Peek expires on
 * the next stone; locked keeps rendering and follows every new ownership read.
 */
export function useScoreJudgment() {
  const positionKey = useGameStore((state) => state.currentNode.id);
  const currentPlayer = useGameStore((state) => state.currentPlayer);
  const capturedBlack = useGameStore((state) => state.capturedBlack);
  const capturedWhite = useGameStore((state) => state.capturedWhite);
  const komi = useGameStore((state) => state.komi);
  const quickEvalData = useGameStore((state) => state.quickEvalData);
  const runQuickEval = useGameStore((state) => state.runQuickEval);

  const [scoreMode, setScoreMode] = useState<ScoreMode>('off');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [lastPositionKey, setLastPositionKey] = useState(positionKey);
  const [lastPlayer, setLastPlayer] = useState(currentPlayer);

  // A position change invalidates an older judgment, and a temporary judgment
  // expires like a peek hint.
  if (lastPositionKey !== positionKey || lastPlayer !== currentPlayer) {
    setLastPositionKey(positionKey);
    setLastPlayer(currentPlayer);
    setDialogOpen(false);
    setDismissed(false);
    if (scoreMode === 'peek') setScoreMode('off');
  }

  const current = quickEvalData?.nodeId === positionKey ? quickEvalData.result : null;
  const visible = scoreMode !== 'off' && current !== null && !dismissed;
  const result: ScoreResult | null = current
    ? formatScoreResult(countTerritoryPoints(current.territory, capturedBlack, capturedWhite, komi))
    : null;

  // Make sure the current position has a network-only read to render. This is
  // a silent fetch; it never runs a search and never shows a loading overlay.
  useEffect(() => {
    if (scoreMode === 'off') return;
    const state = useGameStore.getState();
    if (state.quickEvalData?.nodeId !== state.currentNode.id) void state.runQuickEval();
  }, [scoreMode, positionKey, currentPlayer, runQuickEval]);

  const cycleScoreMode = () => {
    setDismissed(false);
    setScoreMode((prev) => (prev === 'off' ? 'peek' : prev === 'peek' ? 'always' : 'off'));
  };

  const dismissScore = () => setDismissed(true);

  const endGame = useCallback(() => {
    setDismissed(false);
    setDialogOpen(true);
    const state = useGameStore.getState();
    if (state.quickEvalData?.nodeId !== state.currentNode.id) void state.runQuickEval();
  }, []);

  const closeDialog = () => setDialogOpen(false);

  return {
    scoreMode,
    cycleScoreMode,
    result,
    resultVisible: visible,
    territoryVisible: visible,
    dialogOpen,
    dismissScore,
    endGame,
    closeDialog,
  };
}
