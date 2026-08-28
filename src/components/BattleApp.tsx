import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { FaCalculator, FaFlag, FaLightbulb, FaRedo, FaUndo } from 'react-icons/fa';
import { useGameStore } from '../store/gameStore';
import type { BoardSize, CandidateMove } from '../types';
import { getHoshiPoints } from '../utils/boardSize';

const SIZES = [
  { size: 5, name: '启蒙枰' }, { size: 7, name: '斗星枰' },
  { size: 9, name: '方圆枰' }, { size: 11, name: '玲珑枰' },
  { size: 13, name: '星野枰' }, { size: 15, name: '中和枰' },
  { size: 17, name: '古韵枰' }, { size: 19, name: '标准枰' },
] as const;
const THINKING_OPTIONS = [
  { id: '速决', ms: 500 },
  { id: '快思', ms: 1000 },
  { id: '从容', ms: 2000 },
  { id: '深思', ms: 5000 },
  { id: '长考', ms: 10000 },
  { id: '自弈', ms: 0 },
] as const;

function percent(value: number) {
  if (value >= 0.9995) return '∞';
  return `${Math.round(value * 100)}`;
}

export function BattleApp() {
  const {
    board,
    currentNode,
    currentPlayer,
    moveHistory,
    capturedBlack,
    capturedWhite,
    analysisData,
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
    toggleContinuousAnalysis,
    playMove,
    passTurn,
    runAnalysis,
    undoMove,
  } = useGameStore((state) => ({
    board: state.board,
    currentNode: state.currentNode,
    currentPlayer: state.currentPlayer,
    moveHistory: state.moveHistory,
    capturedBlack: state.capturedBlack,
    capturedWhite: state.capturedWhite,
    analysisData: state.analysisData,
    engineStatus: state.engineStatus,
    engineError: state.engineError,
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
    toggleContinuousAnalysis: state.toggleContinuousAnalysis,
    playMove: state.playMove,
    passTurn: state.passTurn,
    runAnalysis: state.runAnalysis,
    undoMove: state.undoMove,
  }));
  const [size, setSize] = useState<number>(9);
  const [showHints, setShowHints] = useState(true);
  const [showNewGame, setShowNewGame] = useState(false);
  const [showScore, setShowScore] = useState(false);
  const [showTerritory, setShowTerritory] = useState(false);
  const [scoreLoading, setScoreLoading] = useState(false);
  const [hintLoading, setHintLoading] = useState(false);
  const [scoreNotice, setScoreNotice] = useState<{ black: string; white: string; leader: string } | null>(null);
  const [scoreCache, setScoreCache] = useState<{ black: string; white: string; leader: string } | null>(null);
  const [humanColor, setHumanColor] = useState<'black' | 'white'>('black');
  const [thinking, setThinking] = useState<(typeof THINKING_OPTIONS)[number]['id']>('从容');
  const [notice, setNotice] = useState('');
  const [initialLoading, setInitialLoading] = useState(true);
  const didInitialize = useRef(false);
  const boardSize = board.length;
  const topMoves = useMemo(() => (analysisData?.moves ?? []).slice(0, 3), [analysisData]);
  const hintRates = topMoves.map((move) => move.winRate);
  const minHintRate = hintRates.length ? Math.min(...hintRates) : 0;
  const maxHintRate = hintRates.length ? Math.max(...hintRates) : 1;
  const selfPlay = thinking === '自弈';
  const hintsVisible = showHints;

  useEffect(() => {
    const timer = window.setTimeout(() => setInitialLoading(false), 3000);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (didInitialize.current) return;
    didInitialize.current = true;
    updateSettings({ katagoMaxTimeMs: 2000, katagoBatchSize: 1 });
    if (board.length !== 9) {
      startNewGame({ komi: 6.5, rules: 'japanese', boardSize: 9, handicap: 0 });
      window.setTimeout(() => {
        const state = useGameStore.getState();
        if (thinking !== '自弈' && !state.isAiPlaying) state.toggleAi(humanColor === 'black' ? 'white' : 'black');
      }, 0);
    }
  }, [board.length, humanColor, startNewGame, thinking]);

  useEffect(() => {
    if (thinking !== '自弈' && !isAiPlaying) toggleAi(humanColor === 'black' ? 'white' : 'black');
  }, [humanColor, isAiPlaying, thinking, toggleAi]);

  useEffect(() => {
    // Recommendations are always computed in the background; visibility is a
    // separate presentation toggle controlled by the button below.
    if (!isContinuousAnalysis) toggleContinuousAnalysis(true);
  }, [isContinuousAnalysis, toggleContinuousAnalysis]);

  // Hint visibility is intentionally per-turn: every new position starts
  // hidden and requires an explicit tap on the recommendation button.
  useEffect(() => {
    setShowHints(false);
    setScoreNotice(null);
    setScoreCache(null);
    setShowTerritory(false);
  }, [currentNode.id, currentPlayer]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 2600);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const newGame = (nextSize = size, color = humanColor) => {
    const engineSize = nextSize as BoardSize;
    const thinkingMs = THINKING_OPTIONS.find((option) => option.id === thinking)?.ms ?? 2000;
    updateSettings({ katagoMaxTimeMs: thinkingMs, katagoBatchSize: 1, aiRankKyu: 5 });
    startNewGame({ komi: 6.5, rules: 'japanese', boardSize: engineSize, handicap: 0 });
    setSize(nextSize);
    setHumanColor(color);
    setShowScore(false);
    setShowNewGame(false);
    const ai = color === 'black' ? 'white' : 'black';
    if (thinking === '自弈') {
      setAiPlayer(ai, false);
      updateSettings({ katagoMaxTimeMs: 2000, katagoBatchSize: 1 });
    } else {
      toggleAi(ai);
    }
    setNotice(`${nextSize} 路棋盘已准备好`);
  };

  const toggleHintVisibility = () => {
    setShowTerritory(false);
    setScoreNotice(null);
    const nextVisible = !showHints;
    setShowHints(nextVisible);
    if (nextVisible && !(analysisData?.moves?.length) && !isAiThinking) {
      setHintLoading(true);
      void runAnalysis({ force: true, visits: 32, topK: 3, analysisPvLen: 4 })
        .finally(() => setHintLoading(false));
    }
  };

  const handlePoint = (x: number, y: number) => {
    if ((!selfPlay && currentPlayer === aiColor) || isAiThinking || board[y]?.[x]) return;
    playMove(x, y);
  };
  const opponentTurn = !selfPlay && currentPlayer === aiColor;
  const handlePass = () => {
    if (!selfPlay && (currentPlayer === aiColor || isAiThinking)) return;
    passTurn();
    window.setTimeout(() => {
      const state = useGameStore.getState();
      const moves = state.moveHistory.slice(-2);
      if (moves.length === 2 && moves.every((move) => move.x === -1 && move.y === -1)) {
        setShowTerritory(true);
        setShowScore(true);
      }
    }, 700);
  };

  const hintAt = (x: number, y: number): CandidateMove | undefined =>
    topMoves.find((move) => move.x === x && move.y === y);
  const hoshiPoints = getHoshiPoints(boardSize as BoardSize);
  if ((boardSize === 5 || boardSize === 7) && hoshiPoints.length === 0) hoshiPoints.push([Math.floor(boardSize / 2), Math.floor(boardSize / 2)]);
  const hoshi = new Set(hoshiPoints.map(([x, y]) => `${x}-${y}`));
  const territoryValues = analysisData?.territory?.flat() ?? [];
  const blackPoints = territoryValues.length ? territoryValues.filter((value) => value >= 0).length + capturedWhite : 0;
  const whitePoints = territoryValues.length ? territoryValues.filter((value) => value < 0).length + capturedBlack + 6.5 : 6.5;
  const [previousWinRate, setPreviousWinRate] = useState(0.5);
  const rawWinRate = analysisData?.rootWinRate ?? currentNode.analysis?.rootWinRate;
  // KataGo can publish an initial 50% placeholder before the first search
  // visits arrive. Treat that frame as "refreshing" so it cannot overwrite the
  // previous position's useful estimate.
  const analyzedWinRate = typeof rawWinRate === 'number'
    && Number.isFinite(rawWinRate)
    && (!analysisData || analysisData.rootVisits == null || analysisData.rootVisits > 1)
    ? rawWinRate
    : null;
  useEffect(() => {
    if (typeof analyzedWinRate !== 'number' || !Number.isFinite(analyzedWinRate)) return;
    const next = Math.max(0, Math.min(1, analyzedWinRate));
    const timer = window.setTimeout(() => setPreviousWinRate(next), 0);
    return () => window.clearTimeout(timer);
  }, [analyzedWinRate]);
  useEffect(() => {
    if (currentNode.parent) return;
    const timer = window.setTimeout(() => setPreviousWinRate(0.5), 0);
    return () => window.clearTimeout(timer);
  }, [currentNode.id, currentNode.parent]);
  // A newly played node has no analysis for a short time. Keep the last useful
  // estimate visible until KataGo returns the new position's result.
  const displayWinRate = typeof analyzedWinRate === 'number' && Number.isFinite(analyzedWinRate)
    ? Math.max(0, Math.min(1, analyzedWinRate))
    : previousWinRate;
  const pointInset = 42 / boardSize;
  const undoTwoMoves = () => {
    if (!moveHistory.length) return;
    undoMove();
  };
  const openScore = async () => {
    if (scoreNotice) {
      setScoreNotice(null);
      setShowTerritory(false);
      return;
    }
    if (scoreCache) {
      setShowHints(false);
      setScoreNotice(scoreCache);
      setShowTerritory(true);
      return;
    }
    setShowHints(false);
    if (!isAnalysisMode) toggleAnalysisMode();
    setScoreLoading(true);
    await runAnalysis({ force: true, visits: 80, topK: 3, maxChildren: boardSize * boardSize, analysisPvLen: 4 });
    const latest = useGameStore.getState();
    const territory = latest.analysisData?.territory?.flat() ?? [];
    const black = territory.length ? territory.filter((value) => value >= 0).length + latest.capturedWhite : 0;
    const white = territory.length ? territory.filter((value) => value < 0).length + latest.capturedBlack + latest.komi : latest.komi;
    const leader = black >= white ? `黑方领先 ${(black - white).toFixed(1)} 目` : `白方领先 ${(white - black).toFixed(1)} 目`;
    const result = { black: `黑 ${black.toFixed(1)} 目`, white: `白 ${white.toFixed(1)} 目`, leader };
    setScoreCache(result);
    setScoreNotice(result);
    setShowTerritory(true);
    setScoreLoading(false);
  };

  return (
    <main className="battle-shell">
      <header className="battle-header">
        <div>
          <h1>EASY GO</h1>
        </div>
        <div className="header-tools"><button type="button" className="new-game-header" onClick={() => setShowNewGame(true)}><FaRedo />新对局</button></div>
      </header>

      <section className="match-card" style={{ '--match-split-num': displayWinRate } as CSSProperties}>
        <span className="stone-avatar black-stone">
          {currentPlayer === 'black' && <span className={selfPlay || humanColor === 'black' ? 'turn-mark active' : 'turn-mark thinking'} aria-label="黑方回合" />}
        </span>
        <div className="match-side"><strong>{selfPlay ? '甲' : humanColor === 'black' ? '你' : 'AI'}</strong></div>
        <div className="match-score">
          <div className="match-rate-track" aria-hidden="true">
            <span className="match-rate-track-black" />
            <span className="match-rate-track-white" />
          </div>
          <div className="match-rate-values" aria-label={`黑方 ${Math.round(displayWinRate * 100)}%，白方 ${Math.round((1 - displayWinRate) * 100)}%`}>
            <strong className="match-rate-black">{Math.round(displayWinRate * 100)}</strong>
            <strong className="match-rate-white">{Math.round((1 - displayWinRate) * 100)}</strong>
          </div>
        </div>
        <div className="match-side right"><strong>{selfPlay ? '乙' : humanColor === 'white' ? '你' : 'AI'}</strong></div>
        <span className="stone-avatar white-stone">
          {currentPlayer === 'white' && <span className={selfPlay || humanColor === 'white' ? 'turn-mark active' : 'turn-mark thinking'} aria-label="白方回合" />}
        </span>
      </section>

      <section className="board-wrap" aria-label="围棋棋盘">
        <div className="board-grid" style={{ '--board-size': boardSize, '--board-inset': `${pointInset}%` } as CSSProperties}>
          {Array.from({ length: boardSize }, (_, index) => <span key={`h-${index}`} className="board-line horizontal" style={{ top: `${pointInset + (index / (boardSize - 1)) * (100 - pointInset * 2)}%` }} />)}
          {Array.from({ length: boardSize }, (_, index) => <span key={`v-${index}`} className="board-line vertical" style={{ left: `${pointInset + (index / (boardSize - 1)) * (100 - pointInset * 2)}%` }} />)}
          {Array.from({ length: boardSize * boardSize }, (_, index) => {
            const x = index % boardSize;
            const y = Math.floor(index / boardSize);
            const stone = board[y]?.[x];
            const hint = hintsVisible ? hintAt(x, y) : undefined;
            const hintAlpha = hint
              ? 0.35 + (maxHintRate === minHintRate ? 0.6 : ((hint.winRate - minHintRate) / (maxHintRate - minHintRate)) * 0.6)
              : 0;
            const territoryValue = analysisData?.territory?.[y]?.[x];
            const territoryOwner = typeof territoryValue === 'number' ? territoryValue >= 0 ? 'black' : 'white' : null;
            const pointStyle = { left: `${pointInset + (x / (boardSize - 1)) * (100 - pointInset * 2)}%`, top: `${pointInset + (y / (boardSize - 1)) * (100 - pointInset * 2)}%` };
            return <button key={`${x}-${y}`} style={pointStyle} className={`intersection ${hoshi.has(`${x}-${y}`) ? 'hoshi' : ''}`} onClick={() => handlePoint(x, y)} aria-label={`${x + 1},${y + 1}`}>
              {hint && !stone && <span className={`hint-dot rank-${topMoves.findIndex((move) => move === hint)}`} style={{ backgroundColor: `rgba(211,47,47,${hintAlpha.toFixed(3)})` }}>{percent(selfPlay && currentPlayer === 'white' ? 1 - hint.winRate : hint.winRate)}</span>}
              {stone && <span className={`board-stone ${stone === 'black' ? 'black-stone' : 'white-stone'}`} />}
              {currentNode.move?.x === x && currentNode.move?.y === y && <span className="last-move-marker" />}
              {showTerritory && territoryOwner && (!stone || territoryOwner !== stone) && <span className={`score-mark ${territoryOwner}`} />}
            </button>;
          })}
        </div>
        {((initialLoading && !isAiThinking && engineStatus !== 'ready' && engineStatus !== 'error') || scoreLoading || hintLoading) && <div className="board-loading"><div className="loading-track"><i /></div><span>{scoreLoading ? 'AI 判定中…' : hintLoading ? 'AI 计算中…' : 'AI 加载中…'}</span></div>}
      </section>

      <div className="battle-actions"><button type="button" onClick={undoTwoMoves} disabled={!moveHistory.length}><FaUndo />悔棋</button><button type="button" onClick={handlePass} disabled={!selfPlay && (opponentTurn || isAiThinking)}><FaFlag />停着</button><button type="button" onClick={() => void openScore()} disabled={!selfPlay && (opponentTurn || isAiThinking)} className={scoreCache && showTerritory ? 'score-toggle active' : 'score-toggle'}><FaCalculator />局势判定</button><button type="button" className={showHints ? 'recommendation-toggle active' : 'recommendation-toggle'} aria-pressed={showHints} onClick={toggleHintVisibility} disabled={!selfPlay && (opponentTurn || isAiThinking)}><FaLightbulb />推荐落点{isContinuousAnalysis && engineStatus === 'loading' && !(analysisData?.moves?.length) && <span className="thinking-spinner" aria-label="推荐落点计算中" />}</button></div>
      {showScore && <div className="dialog-backdrop"><section className="result-dialog"><strong>终局结果</strong><p>{blackPoints > whitePoints ? `黑胜 ${(blackPoints - whitePoints).toFixed(1)} 目` : `白胜 ${(whitePoints - blackPoints).toFixed(1)} 目`}</p><div className="score-legend"><span><i className="black" />黑 {blackPoints.toFixed(1)} 目</span><span><i className="white" />白 {whitePoints.toFixed(1)} 目</span></div><div><button onClick={() => setShowScore(false)}>返回</button><button className="dialog-start" onClick={() => { setShowScore(false); setShowNewGame(true); }}>新对局</button></div></section></div>}
      {showNewGame && <div className="dialog-backdrop"><section className="new-game-dialog"><div className="dialog-title"><strong>新对局</strong><button onClick={() => setShowNewGame(false)} aria-label="关闭">×</button></div><label>棋盘<div className="dialog-options board-options">{SIZES.map((option) => <button key={option.size} className={size === option.size ? 'selected' : ''} onClick={() => setSize(option.size)}>{option.name}({option.size})</button>)}</div></label><label>执方<div className="dialog-options full-options player-options"><button className={humanColor === 'black' && !selfPlay ? 'selected' : ''} onClick={() => { setHumanColor('black'); if (selfPlay) setThinking('从容'); }}><span className="dialog-stone black-stone" />执黑</button><button className={humanColor === 'white' && !selfPlay ? 'selected' : ''} onClick={() => { setHumanColor('white'); if (selfPlay) setThinking('从容'); }}><span className="dialog-stone white-stone" />执白</button><button className={selfPlay ? 'selected' : ''} onClick={() => setThinking('自弈')}><span className="dialog-stone black-stone" /><span className="dialog-stone white-stone" />自弈</button></div></label><label>棋力<div className="dialog-options thinking-options">{THINKING_OPTIONS.filter((option) => option.id !== '自弈').map((option) => <button key={option.id} disabled={selfPlay} className={thinking === option.id ? 'selected' : ''} onClick={() => setThinking(option.id)}>{option.id}</button>)}</div></label><button className="dialog-start" onClick={() => newGame(size, humanColor)}>开始对局</button></section></div>}
      {notice && <div className="battle-toast">{notice}</div>}
      {scoreNotice && <div className="battle-toast score-toast" role="button" tabIndex={0} onClick={() => { setScoreNotice(null); setShowTerritory(false); }} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { setScoreNotice(null); setShowTerritory(false); } }}><div className="score-toast-points"><span>{scoreNotice.black}</span><span>{scoreNotice.white}</span></div><span className="score-toast-divider" /><strong className="score-toast-leader">{scoreNotice.leader}</strong></div>}
    </main>
  );
}
