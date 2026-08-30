import { useCallback, useState } from 'react';
import { useGameStore } from '../store/gameStore';
import { countTerritoryPoints, formatScoreResult, type ScoreResult } from '../utils/territoryScore';

/**
 * One-tap territory score judgment: runs a short analysis, caches the result,
 * and drives the territory marks, the score toast, and the end-game dialog.
 */
export function useScoreJudgment() {
  const runAnalysis = useGameStore((state) => state.runAnalysis);
  const toggleAnalysisMode = useGameStore((state) => state.toggleAnalysisMode);
  const isAnalysisMode = useGameStore((state) => state.isAnalysisMode);
  const boardSize = useGameStore((state) => state.board.length);
  const positionKey = useGameStore((state) => state.currentNode.id);
  const currentPlayer = useGameStore((state) => state.currentPlayer);

  const [result, setResult] = useState<ScoreResult | null>(null);
  const [resultVisible, setResultVisible] = useState(false);
  const [territoryVisible, setTerritoryVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [lastPositionKey, setLastPositionKey] = useState(positionKey);
  const [lastPlayer, setLastPlayer] = useState(currentPlayer);

  // A position change invalidates any judgment shown for an older position.
  if (lastPositionKey !== positionKey || lastPlayer !== currentPlayer) {
    setLastPositionKey(positionKey);
    setLastPlayer(currentPlayer);
    setResult(null);
    setResultVisible(false);
    setTerritoryVisible(false);
    setDialogOpen(false);
  }

  const openScore = async () => {
    if (resultVisible) {
      setResultVisible(false);
      setTerritoryVisible(false);
      return;
    }
    if (result) {
      setResultVisible(true);
      setTerritoryVisible(true);
      return;
    }
    if (!isAnalysisMode) toggleAnalysisMode();
    setLoading(true);
    try {
      await runAnalysis({ force: true, visits: 80, topK: 3, maxChildren: boardSize * boardSize, analysisPvLen: 4 });
      const latest = useGameStore.getState();
      const score = formatScoreResult(
        countTerritoryPoints(latest.analysisData?.territory ?? [], latest.capturedBlack, latest.capturedWhite, latest.komi)
      );
      setResult(score);
      setResultVisible(true);
      setTerritoryVisible(true);
    } finally {
      setLoading(false);
    }
  };

  const dismissScore = () => {
    setResultVisible(false);
    setTerritoryVisible(false);
  };

  const endGame = useCallback(() => {
    setTerritoryVisible(true);
    setDialogOpen(true);
  }, []);

  const closeDialog = () => setDialogOpen(false);

  return {
    result,
    resultVisible,
    territoryVisible,
    loading,
    dialogOpen,
    openScore,
    dismissScore,
    endGame,
    closeDialog,
  };
}
