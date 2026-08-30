import { useEffect, useMemo, useRef, useState } from 'react';
import { FaRedo } from 'react-icons/fa';
import { useShallow } from 'zustand/react/shallow';
import { useGameStore } from '../store/gameStore';
import type { BoardSize, Player } from '../types';
import { defaultThinkingForTier, getModelTier } from '../engine/katago/modelDefaults';
import { formatIterations, formatThinkingMs } from '../utils/format';
import { countTerritoryPoints } from '../utils/territoryScore';
import { useDisplayWinRate } from '../hooks/useDisplayWinRate';
import { useHintMode } from '../hooks/useHintMode';
import { useModelManager } from '../hooks/useModelManager';
import { useScoreJudgment } from '../hooks/useScoreJudgment';
import { LogoMark } from './LogoMark';
import { MatchCard } from './MatchCard';
import { BoardGrid } from './BoardGrid';
import { BattleActions } from './BattleActions';
import { NoticeToast, ScoreToast } from './BattleToasts';
import { NewGameDialog, type NewGameDraft } from './dialogs/NewGameDialog';
import { ForceRedownloadDialog, ModelDownloadDialog } from './dialogs/ModelDownloadDialog';
import { ScoreDialog } from './dialogs/ScoreDialog';

export function BattleApp() {
  const {
    board,
    currentNode,
    currentPlayer,
    moveHistory,
    capturedBlack,
    capturedWhite,
    analysisData,
    settings,
    engineStatus,
    isAiThinking,
    aiColor,
    isAiPlaying,
    isAnalysisMode,
    isContinuousAnalysis,
    startNewGame,
    updateSettings,
    toggleAi,
    setAiPlayer,
    toggleAnalysisMode,
    playMove,
    passTurn,
    undoMove,
    toggleContinuousAnalysis,
  } = useGameStore(useShallow((state) => ({
    board: state.board,
    currentNode: state.currentNode,
    currentPlayer: state.currentPlayer,
    moveHistory: state.moveHistory,
    capturedBlack: state.capturedBlack,
    capturedWhite: state.capturedWhite,
    analysisData: state.analysisData,
    settings: state.settings,
    engineStatus: state.engineStatus,
    isAiThinking: state.isAiThinking,
    aiColor: state.aiColor,
    isAiPlaying: state.isAiPlaying,
    isAnalysisMode: state.isAnalysisMode,
    isContinuousAnalysis: state.isContinuousAnalysis,
    startNewGame: state.startNewGame,
    updateSettings: state.updateSettings,
    toggleAi: state.toggleAi,
    setAiPlayer: state.setAiPlayer,
    toggleAnalysisMode: state.toggleAnalysisMode,
    playMove: state.playMove,
    passTurn: state.passTurn,
    undoMove: state.undoMove,
    toggleContinuousAnalysis: state.toggleContinuousAnalysis,
  })));

  const [size, setSize] = useState(9);
  const [humanColor, setHumanColor] = useState<Player>('black');
  const [selfPlayMode, setSelfPlayMode] = useState(false);
  const [notice, setNotice] = useState('');
  const [initialLoading, setInitialLoading] = useState(true);
  const [hintLoading, setHintLoading] = useState(false);
  const [showNewGame, setShowNewGame] = useState(false);
  const didInitialize = useRef(false);
  const [lastPositionKey, setLastPositionKey] = useState(currentNode.id);
  const [lastPlayer, setLastPlayer] = useState(currentPlayer);

  const model = useModelManager(setNotice);
  const score = useScoreJudgment();
  const { hintMode, cycleHintMode } = useHintMode(moveHistory.length, enableHints);
  const { endGame: endScoreGame, territoryVisible: scoreTerritoryVisible } = score;

  const topMoves = useMemo(() => (analysisData?.moves ?? []).slice(0, 3), [analysisData]);
  const recommendationIterations = analysisData?.rootVisits ?? currentNode.analysisVisitsRequested ?? 0;
  const selfPlay = selfPlayMode;
  const opponentTurn = !selfPlay && currentPlayer === aiColor;
  const lastMoveWasPass = moveHistory.at(-1)?.x === -1 && moveHistory.at(-1)?.y === -1;
  const consecutivePasses = moveHistory.length >= 2
    && moveHistory.at(-2)?.x === -1 && moveHistory.at(-2)?.y === -1
    && lastMoveWasPass;
  const aiThinkingName = `${model.selectedModelLabel}-${formatThinkingMs(model.thinkingMs)}`;
  const blackSideName = selfPlay ? '黑' : humanColor === 'black' ? '你' : aiThinkingName;
  const whiteSideName = selfPlay ? '白' : humanColor === 'white' ? '你' : aiThinkingName;
  const displayWinRate = useDisplayWinRate({
    rawWinRate: analysisData?.rootWinRate ?? currentNode.analysis?.rootWinRate,
    rootVisits: analysisData?.rootVisits,
    isRoot: !currentNode.parent,
    positionKey: currentNode.id,
  });
  const territoryPoints = countTerritoryPoints(analysisData?.territory ?? [], capturedBlack, capturedWhite, 6.5);

  // Recommendations calculate automatically, but remain hidden until the
  // player explicitly enables their display.
  function enableHints() {
    if (!(analysisData?.moves?.length) && !isAiThinking && !hintLoading) {
      setHintLoading(true);
      if (!isAnalysisMode) toggleAnalysisMode();
    }
  }

  // Keep recommendations continuously improving independently of the
  // opponent's thinking preset.
  useEffect(() => {
    if (!isContinuousAnalysis) toggleContinuousAnalysis(true);
  }, [isContinuousAnalysis, toggleContinuousAnalysis]);

  useEffect(() => {
    const timer = window.setTimeout(() => setInitialLoading(false), 3000);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (didInitialize.current) return;
    didInitialize.current = true;
    updateSettings({ katagoMaxTimeMs: model.thinkingMs, katagoBatchSize: 1 });
    // Always pass through the default new-game path on a fresh page load.
    // The initial store already has a 9x9 board, so checking only the board
    // size skipped this lifecycle and left the first analysis waiting for a
    // later move to change the position.
    startNewGame({ komi: 6.5, rules: 'japanese', boardSize: 9, handicap: 0 });
    window.setTimeout(() => {
      const state = useGameStore.getState();
      if (!selfPlayMode && !state.isAiPlaying) state.toggleAi(humanColor === 'black' ? 'white' : 'black');
      if (!state.isContinuousAnalysis) state.toggleContinuousAnalysis(true);
    }, 0);
  }, [board.length, humanColor, model.thinkingMs, selfPlayMode, startNewGame, updateSettings]);

  useEffect(() => {
    if (!selfPlayMode && !isAiPlaying) toggleAi(humanColor === 'black' ? 'white' : 'black');
  }, [humanColor, isAiPlaying, selfPlayMode, toggleAi]);

  // A new position invalidates pending hint-loading state.
  if (lastPositionKey !== currentNode.id || lastPlayer !== currentPlayer) {
    setLastPositionKey(currentNode.id);
    setLastPlayer(currentPlayer);
    setHintLoading(false);
  }

  // The AI's own search satisfies a pending hint request; a fresh analysis
  // result does too, so either one can clear the hint-loading spinner.
  if ((isAiThinking || analysisData?.moves?.length) && hintLoading) {
    setHintLoading(false);
  }

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 2600);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (!consecutivePasses) return;
    endScoreGame();
  }, [consecutivePasses, endScoreGame]);

  const handlePoint = (x: number, y: number) => {
    if ((!selfPlay && currentPlayer === aiColor) || isAiThinking || board[y]?.[x]) return;
    playMove(x, y);
  };

  const handlePass = () => {
    if (!selfPlay && (currentPlayer === aiColor || isAiThinking)) return;
    if (lastMoveWasPass) {
      score.endGame();
      return;
    }
    passTurn();
  };

  const newGame = async (draft: NewGameDraft) => {
    const tier = getModelTier(draft.modelTier);
    const tierThinkingMs = draft.thinkingMsByTier[draft.modelTier] ?? defaultThinkingForTier(tier);
    const confirmed = await model.confirmModelSelection(draft.modelTier, tierThinkingMs);
    if (!confirmed) return;
    setSize(draft.boardSize);
    setHumanColor(draft.humanColor);
    setSelfPlayMode(draft.selfPlay);
    setShowNewGame(false);
    startNewGame({ komi: 6.5, rules: 'japanese', boardSize: draft.boardSize as BoardSize, handicap: 0 });
    const ai = draft.humanColor === 'black' ? 'white' : 'black';
    if (draft.selfPlay) {
      setAiPlayer(ai, false);
      updateSettings({ katagoMaxTimeMs: 2000, katagoBatchSize: 1 });
    } else {
      toggleAi(ai);
    }
    setNotice(`${draft.boardSize} 路棋盘已准备好`);
  };

  const recommendationLabel = `推荐落点（${formatIterations(recommendationIterations)}）`;
  const showThinkingSpinner = isContinuousAnalysis && engineStatus === 'loading' && !(analysisData?.moves?.length);
  const showBoardLoading =
    (initialLoading && !isAiThinking && engineStatus !== 'ready' && engineStatus !== 'error')
    || score.loading
    || (hintMode !== 'off' && hintLoading);

  return (
    <main className="battle-shell">
      <header className="battle-header">
        <div>
          <h1><LogoMark />EASY GO</h1>
        </div>
        <div className="header-tools">
          <button type="button" className="new-game-header" onClick={() => setShowNewGame(true)}><FaRedo />新对局</button>
        </div>
      </header>

      <MatchCard
        blackSideName={blackSideName}
        whiteSideName={whiteSideName}
        capturedWhite={capturedWhite}
        capturedBlack={capturedBlack}
        currentPlayer={currentPlayer}
        blackIsHuman={selfPlay || humanColor === 'black'}
        whiteIsHuman={selfPlay || humanColor === 'white'}
        displayWinRate={displayWinRate}
      />

      <section className="board-wrap" aria-label="围棋棋盘">
        <BoardGrid
          board={board}
          currentPlayer={currentPlayer}
          currentMove={currentNode.move}
          previousBoard={currentNode.parent?.gameState.board}
          hints={topMoves}
          hintMode={hintMode}
          showTerritory={scoreTerritoryVisible}
          territory={analysisData?.territory ?? []}
          thinkingActive={isAiThinking || opponentTurn}
          thinkingTimeMs={settings.katagoMaxTimeMs}
          canInteract={!opponentTurn && !isAiThinking}
          positionKey={currentNode.id}
          onPointClick={handlePoint}
        />
        {model.downloadPhase === 'downloading' && (
          <div className="board-loading"><div className="loading-track"><i /></div><span>模型下载中（B18）{model.downloadPercent()}%</span></div>
        )}
        {model.downloadPhase !== 'downloading' && showBoardLoading && (
          <div className="board-loading"><div className="loading-track"><i /></div><span>{score.loading ? 'AI 判定中…' : hintLoading ? 'AI 计算中…' : `模型加载中（${model.selectedModelLabel}）…`}</span></div>
        )}
      </section>

      <BattleActions
        canUndo={moveHistory.length > 0}
        disabled={!selfPlay && (opponentTurn || isAiThinking)}
        lastMoveWasPass={lastMoveWasPass}
        scoreActive={!!score.result && score.territoryVisible}
        hintMode={hintMode}
        recommendationLabel={recommendationLabel}
        showThinkingSpinner={showThinkingSpinner}
        onUndo={undoMove}
        onPass={handlePass}
        onScore={() => void score.openScore()}
        onCycleHints={cycleHintMode}
      />

      {score.dialogOpen && (
        <ScoreDialog
          blackPoints={territoryPoints.black}
          whitePoints={territoryPoints.white}
          onClose={score.closeDialog}
          onNewGame={() => { score.closeDialog(); setShowNewGame(true); }}
        />
      )}
      {showNewGame && (
        <NewGameDialog
          initialSize={size}
          initialHumanColor={humanColor}
          initialSelfPlay={selfPlayMode}
          initialModelTier={model.selectedModelTier}
          initialThinkingMsByTier={model.thinkingMsByTier}
          onClose={() => setShowNewGame(false)}
          onStart={(draft) => void newGame(draft)}
        />
      )}
      {model.showModelDownload && (
        <ModelDownloadDialog
          phase={model.downloadPhase}
          progress={model.downloadProgress}
          error={model.downloadError}
          percent={model.downloadPercent()}
          onCancel={model.cancelModelDownload}
          onStart={() => void model.startModelDownload()}
          onDone={() => model.setShowModelDownload(false)}
        />
      )}
      {model.showForceRedownload && (
        <ForceRedownloadDialog
          onCancel={() => model.setShowForceRedownload(false)}
          onConfirm={() => {
            model.setShowForceRedownload(false);
            model.setShowModelDownload(true);
            void model.startModelDownload();
          }}
        />
      )}
      {notice && <NoticeToast text={notice} />}
      {score.resultVisible && score.result && <ScoreToast score={score.result} onDismiss={score.dismissScore} />}
    </main>
  );
}
