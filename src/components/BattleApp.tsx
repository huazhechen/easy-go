import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { FaRedo, FaUndo } from 'react-icons/fa';
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
  { id: '匆忙', ms: 500 },
  { id: '草率', ms: 1000 },
  { id: '从容', ms: 2000 },
  { id: '深思', ms: 5000 },
  { id: '长考', ms: 10000 },
  { id: '自弈', ms: 0 },
] as const;

function percent(value: number) {
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
    makeAiMove,
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
    makeAiMove: state.makeAiMove,
  }));
  const [size, setSize] = useState<number>(9);
  const [showHints, setShowHints] = useState(true);
  const [showNewGame, setShowNewGame] = useState(false);
  const [showScore, setShowScore] = useState(false);
  const [humanColor, setHumanColor] = useState<'black' | 'white'>('black');
  const [thinking, setThinking] = useState<(typeof THINKING_OPTIONS)[number]['id']>('从容');
  const [notice, setNotice] = useState('');
  const [initialLoading, setInitialLoading] = useState(true);
  const [lastWinRate, setLastWinRate] = useState(0.5);
  const didInitialize = useRef(false);
  const boardSize = board.length;
  const topMoves = useMemo(() => (analysisData?.moves ?? []).slice(0, 3), [analysisData]);
  const selfPlay = thinking === '自弈';
  const hintsVisible = showHints && (selfPlay || currentPlayer === (aiColor === 'black' ? 'white' : 'black'));

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
    const aiTurn = !selfPlay && currentPlayer === aiColor;
    if (!showHints || aiTurn) {
      if (isContinuousAnalysis) toggleContinuousAnalysis(true);
      return;
    }
    if (!isContinuousAnalysis) toggleContinuousAnalysis(true);
  }, [aiColor, board.length, currentNode.id, currentPlayer, isContinuousAnalysis, selfPlay, showHints, toggleContinuousAnalysis]);

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

  const enableHints = async () => {
    const next = !showHints;
    setShowHints(next);
    if (!next) {
      if (isContinuousAnalysis) toggleContinuousAnalysis(true);
      return;
    }
    setNotice('正在计算推荐落点…');
    await Promise.resolve();
    setNotice('推荐落点已更新');
  };

  const handlePoint = (x: number, y: number) => {
    if ((!selfPlay && currentPlayer === aiColor) || isAiThinking || board[y]?.[x]) return;
    playMove(x, y);
    if (thinking !== '自弈') {
      window.setTimeout(() => {
        const state = useGameStore.getState();
        if (state.isAiPlaying && state.aiColor === state.currentPlayer && !state.isAiThinking) state.makeAiMove();
      }, 120);
    }
  };
  const manualAiTurn = thinking === '自弈' && currentPlayer === aiColor;
  const handlePass = () => {
    if (currentPlayer === aiColor || isAiThinking) return;
    passTurn();
    window.setTimeout(() => {
      const state = useGameStore.getState();
      const moves = state.moveHistory.slice(-2);
      if (moves.length === 2 && moves.every((move) => move.x === -1 && move.y === -1)) setShowScore(true);
    }, 700);
  };

  const hintAt = (x: number, y: number): CandidateMove | undefined =>
    topMoves.find((move) => move.x === x && move.y === y);
  const hoshi = new Set((boardSize === 9 || boardSize === 13 ? getHoshiPoints(boardSize as BoardSize) : []).map(([x, y]) => `${x}-${y}`));
  const humanRate = (rate: number | undefined) => typeof rate === 'number' ? (humanColor === 'black' ? rate : 1 - rate) : null;
  const currentRate = humanRate(analysisData?.rootWinRate);
  const parentRate = humanRate(currentNode.parent?.analysis?.rootWinRate);
  const displayWinRate = currentRate ?? parentRate ?? lastWinRate;
  useEffect(() => {
    const next = currentRate ?? parentRate;
    if (next === null) return;
    const timer = window.setTimeout(() => setLastWinRate(next), 0);
    return () => window.clearTimeout(timer);
  }, [currentRate, parentRate]);
  const territoryValues = analysisData?.territory?.flat() ?? [];
  const blackPoints = territoryValues.length ? territoryValues.filter((value) => value >= 0).length + capturedWhite : 0;
  const whitePoints = territoryValues.length ? territoryValues.filter((value) => value < 0).length + capturedBlack + 6.5 : 6.5;
  const pointInset = 42 / boardSize;
  const hintFontSize = typeof window === 'undefined' ? 16 : Math.max(11, Math.min(24, (Math.min(window.innerWidth, 560) * 0.9 / boardSize) * 0.52));
  const undoTwoMoves = () => {
    if (!moveHistory.length) return;
    undoMove();
    if (moveHistory.length > 1) undoMove();
  };
  const openScore = async () => {
    if (!isAnalysisMode) toggleAnalysisMode();
    await runAnalysis({ force: true, visits: 80, topK: 3, maxChildren: boardSize * boardSize, analysisPvLen: 4 });
    setShowScore(true);
  };

  return (
    <main className="battle-shell">
      <header className="battle-header">
        <div>
          <h1>EASY-GO</h1>
        </div>
        <div className="header-tools">{isContinuousAnalysis && engineStatus === 'loading' && <span className="thinking-spinner" aria-label="AI 推荐计算中" />}<span>AI 推荐</span><label className="switch" aria-label="AI 推荐"><input type="checkbox" checked={showHints} onChange={() => void enableHints()} /><span /></label></div>
      </header>

      <section className="match-card">
        <span className="stone-avatar black-stone" />
        <div className="match-side"><strong>{selfPlay ? '甲' : humanColor === 'black' ? '你' : 'AI'}</strong>{currentPlayer === 'black' && <span className={selfPlay || humanColor === 'black' ? 'turn-mark active' : 'turn-mark thinking'} aria-label="黑方回合" />}</div>
        <div className="match-score"><strong>{percent(displayWinRate)}</strong></div>
        <div className="match-side right">{currentPlayer === 'white' && <span className={selfPlay || humanColor === 'white' ? 'turn-mark active' : 'turn-mark thinking'} aria-label="白方回合" />}<strong>{selfPlay ? '乙' : humanColor === 'white' ? '你' : 'AI'}</strong></div>
        <span className="stone-avatar white-stone" />
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
            const territoryValue = analysisData?.territory?.[y]?.[x];
            const territoryOwner = typeof territoryValue === 'number' ? territoryValue >= 0 ? 'black' : 'white' : null;
            const pointStyle = { left: `${pointInset + (x / (boardSize - 1)) * (100 - pointInset * 2)}%`, top: `${pointInset + (y / (boardSize - 1)) * (100 - pointInset * 2)}%` };
            return <button key={`${x}-${y}`} style={pointStyle} className={`intersection ${hoshi.has(`${x}-${y}`) ? 'hoshi' : ''}`} onClick={() => handlePoint(x, y)} aria-label={`${x + 1},${y + 1}`}>
              {hint && !stone && <span className={`hint-dot rank-${hint.order}`} style={{ fontSize: `${hintFontSize}px` }}>{percent(hint.winRate)}</span>}
              {stone && <span className={`board-stone ${stone === 'black' ? 'black-stone' : 'white-stone'}`} />}
              {currentNode.move?.x === x && currentNode.move?.y === y && <span className="last-move-marker" />}
              {showScore && !stone && territoryOwner && <span className={`score-mark ${territoryOwner}`} />}
            </button>;
          })}
        </div>
        {initialLoading && !isAiThinking && engineStatus !== 'ready' && engineStatus !== 'error' && <div className="board-loading"><div className="loading-track"><i /></div><span>AI 加载中…</span></div>}
      </section>

      <div className="battle-actions"><div><button onClick={undoTwoMoves} disabled={!moveHistory.length}><FaUndo />悔棋</button><button onClick={handlePass} disabled={(!selfPlay && currentPlayer === aiColor) || isAiThinking}>停着</button></div><div>{!selfPlay && manualAiTurn && <button onClick={() => makeAiMove({ force: true })} disabled={isAiThinking}>AI 落子</button>}<button onClick={() => void openScore()}>终局判定</button><button onClick={() => setShowNewGame(true)}><FaRedo />新对局</button></div></div>
      {showScore && <div className="dialog-backdrop"><section className="result-dialog"><strong>终局结果</strong><p>{blackPoints > whitePoints ? `黑胜 ${(blackPoints - whitePoints).toFixed(1)} 目` : `白胜 ${(whitePoints - blackPoints).toFixed(1)} 目`}</p><div className="score-legend"><span><i className="black" />黑 {blackPoints.toFixed(1)} 目</span><span><i className="white" />白 {whitePoints.toFixed(1)} 目</span></div><div><button onClick={() => setShowScore(false)}>返回</button><button className="dialog-start" onClick={() => { setShowScore(false); setShowNewGame(true); }}>新对局</button></div></section></div>}
      {showNewGame && <div className="dialog-backdrop"><section className="new-game-dialog"><div className="dialog-title"><strong>新对局</strong><button onClick={() => setShowNewGame(false)} aria-label="关闭">×</button></div><label>棋盘大小<div className="dialog-options board-options">{SIZES.map((option) => <button key={option.size} className={size === option.size ? 'selected' : ''} onClick={() => setSize(option.size)}>{option.name}({option.size})</button>)}</div></label><label>执方<div className="dialog-options full-options"><button className={humanColor === 'black' ? 'selected' : ''} onClick={() => setHumanColor('black')}>执黑</button><button className={humanColor === 'white' ? 'selected' : ''} onClick={() => setHumanColor('white')}>执白</button></div></label><label>棋力<div className="dialog-options full-options thinking-options">{THINKING_OPTIONS.map((option) => <button key={option.id} className={thinking === option.id ? 'selected' : ''} onClick={() => setThinking(option.id)}>{option.id}</button>)}</div></label><button className="dialog-start" onClick={() => newGame(size, humanColor)}>开始对局</button></section></div>}
      {notice && <div className="battle-toast">{notice}</div>}
    </main>
  );
}
