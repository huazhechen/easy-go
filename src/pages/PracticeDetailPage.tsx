import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  FaHome,
  FaListUl,
  FaPause,
  FaPlay,
  FaRedo,
  FaStepBackward,
  FaStepForward,
} from 'react-icons/fa';
import type { Move, Player } from '../types';
import { PracticeBoardGrid } from '../components/PracticeBoardGrid';
import { loadPracticeGroups, loadProblemRoot, type PracticeItem } from '../practice/data';
import { positionForNode, sgfPointToCoord, type NodePosition, type SgfNode } from '../practice/sgf';
import { compactBoardRect, intersectionMask, movesToPoints, type BoardRect } from '../practice/geometry';
import { hasSolutionTree, isFailureNode, isSuccessNode, nodeComment, nodeLabel } from '../practice/solution';
import { pickPracticeAiMove, type PracticeAiChoice } from '../practice/engine';
import { getOpponent, simulateMove } from '../utils/gameLogic';

type PracticeMode = 'decompose' | 'practice' | 'reverse';

const KOMI = 6.5;
const AI_ATTEMPT_LIMIT = 14;

function collectTreeMoves(node: SgfNode, out: Move[] = []): Move[] {
  if (node.move && node.move.x >= 0 && node.move.y >= 0) out.push(node.move);
  for (const child of node.children) collectTreeMoves(child, out);
  return out;
}

function applyMoveToPosition(position: NodePosition, move: Move): NodePosition | null {
  const simulation = simulateMove(position.board, move.x, move.y, move.player);
  if (!simulation.legal) return null;
  return {
    board: simulation.newBoard,
    currentPlayer: getOpponent(position.currentPlayer),
    moveHistory: [...position.moveHistory, move],
    lastMove: move,
  };
}

function moveCoordinate(move: Move | null): string {
  return move && move.x >= 0 && move.y >= 0 ? sgfPointToCoord(move.x, move.y).toUpperCase() : '停着';
}

export function PracticeDetailPage() {
  const [searchParams] = useSearchParams();
  const id = searchParams.get('id') ?? '';
  const [item, setItem] = useState<PracticeItem | null>(null);
  const [root, setRoot] = useState<SgfNode | null>(null);
  const [activeNode, setActiveNode] = useState<SgfNode | null>(null);
  const [offTreePosition, setOffTreePosition] = useState<NodePosition | null>(null);
  const [mode, setMode] = useState<PracticeMode>('decompose');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [thinking, setThinking] = useState<Player | null>(null);
  const [autoPlay, setAutoPlay] = useState(false);
  const modeRef = useRef<PracticeMode>(mode);
  const attemptingRef = useRef(false);

  modeRef.current = mode;

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');
    void (async () => {
      try {
        const groups = await loadPracticeGroups();
        const found = groups.flatMap((group) => group.items).find((entry) => entry.id === id);
        if (!found) throw new Error('未找到该题目');
        const { root: problemRoot } = await loadProblemRoot(found);
        if (!alive) return;
        setItem(found);
        setRoot(problemRoot);
        setActiveNode(problemRoot);
        setOffTreePosition(null);
        setMode('decompose');
        setStatus(problemRoot ? '题目已就绪，选择下方模式开始练习。' : '');
        setLoading(false);
      } catch (err) {
        if (!alive) return;
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [id]);

  const solverSide: Player = useMemo(() => {
    if (!root) return 'black';
    const position = positionForNode(root, root);
    return position.currentPlayer;
  }, [root]);

  const userSide: Player = mode === 'reverse' ? getOpponent(solverSide) : solverSide;

  const currentPosition = useMemo(() => {
    if (!root) return null;
    if (activeNode) return positionForNode(root, activeNode);
    return offTreePosition;
  }, [activeNode, offTreePosition, root]);

  const problemRect = useMemo<BoardRect | null>(() => {
    if (!root) return null;
    const initialPosition = positionForNode(root, root);
    const solutionPoints = movesToPoints(collectTreeMoves(root));
    return compactBoardRect(initialPosition.board, solutionPoints, 1);
  }, [root]);

  const interestMask = useMemo<boolean[]>(() => {
    if (!root || !currentPosition || !problemRect) return [];
    const solutionPoints = movesToPoints(collectTreeMoves(root));
    return intersectionMask(problemRect, currentPosition.board.length, solutionPoints);
  }, [currentPosition, problemRect, root]);

  const hasSolutions = root ? hasSolutionTree(root) : false;

  const clearAutoPlay = () => {
    setAutoPlay(false);
  };

  useEffect(() => clearAutoPlay, []);

  const setModeWithReset = (nextMode: PracticeMode) => {
    clearAutoPlay();
    attemptingRef.current = false;
    if (root) {
      setActiveNode(root);
      setOffTreePosition(null);
    }
    setMode(nextMode);
    setStatus(nextMode === 'decompose'
      ? '题目拆解：按前进或选择分支，逐一拆解题目。'
      : nextMode === 'practice'
        ? `题目试做：你执${solverSide === 'black' ? '黑' : '白'}，请达成题目目标。`
        : `逆转挑战：AI 执${solverSide === 'black' ? '黑' : '白'}解题，你执${getOpponent(solverSide) === 'black' ? '黑' : '白'}阻止它。`);
  };

  const setNode = (node: SgfNode) => {
    setActiveNode(node);
    setOffTreePosition(null);
    setStatus(nodeComment(node) || nodeLabel(node));
  };

  const setOffTree = (position: NodePosition) => {
    setActiveNode(null);
    setOffTreePosition(position);
    setStatus(position.lastMove ? `${position.lastMove.player === 'black' ? '黑' : '白'} ${moveCoordinate(position.lastMove)} · 已离开题目分支` : '');
  };

  const getCurrentNode = () => activeNode;

  const runAiAttempt = async (start: NodePosition) => {
    if (attemptingRef.current) return;
    attemptingRef.current = true;
    let position = start;
    setStatus('交给 AI 试做中…');
    for (let step = 0; step < AI_ATTEMPT_LIMIT; step++) {
      const player = position.currentPlayer;
      setThinking(player);
      const choice: PracticeAiChoice | null = await pickPracticeAiMove({
        board: position.board,
        currentPlayer: player,
        moveHistory: position.moveHistory,
        komi: KOMI,
        rules: 'japanese',
        interestMask,
      });
      setThinking(null);
      if (!choice) {
        setStatus('没有可下在兴趣区域内的合法着点，试做结束。');
        break;
      }
      const move: Move = { x: choice.x, y: choice.y, player };
      const next = applyMoveToPosition(position, move);
      if (!next) {
        setStatus('AI 无法继续落子，试做结束。');
        break;
      }
      position = next;
      setOffTree(position);
      await new Promise((resolve) => setTimeout(resolve, 320));
    }
    setThinking(null);
    attemptingRef.current = false;
    setStatus((prev) => prev || 'AI 试做完成。');
  };

  const runReverseAiTurn = useCallback(async (position: NodePosition) => {
    if (attemptingRef.current || thinking) return;
    attemptingRef.current = true;
    setThinking(position.currentPlayer);
    const choice = await pickPracticeAiMove({
      board: position.board,
      currentPlayer: position.currentPlayer,
      moveHistory: position.moveHistory,
      komi: KOMI,
      rules: 'japanese',
      interestMask,
    });
    setThinking(null);
    if (choice) {
      const move: Move = { x: choice.x, y: choice.y, player: position.currentPlayer };
      const next = applyMoveToPosition(position, move);
      if (next) {
        setOffTree(next);
        setActiveNode(null);
        setStatus(`AI 落子 ${moveCoordinate(move)}，请你继续阻止它。`);
      }
    } else {
      setStatus('AI 在题目范围内无棋可下，你成功阻止了它！');
    }
    attemptingRef.current = false;
  }, [interestMask, thinking]);

  // Auto-advance along the first branch in decomposition mode.
  useEffect(() => {
    if (!autoPlay || mode !== 'decompose') return;
    const timer = window.setInterval(() => {
      setActiveNode((node) => {
        if (!node || node.children.length === 0) {
          setAutoPlay(false);
          return node;
        }
        const next = node.children[0]!;
        setStatus(nodeComment(next) || nodeLabel(next));
        return next;
      });
    }, 1300);
    return () => window.clearInterval(timer);
  }, [autoPlay, mode]);

  // In reversal mode the AI takes the first move and keeps solving after a
  // correct branch response, unless the user has knocked the session off-tree.
  useEffect(() => {
    if (!root || mode !== 'reverse' || thinking || attemptingRef.current) return;
    if (!currentPosition || currentPosition.currentPlayer !== solverSide) return;
    if (activeNode) {
      if (activeNode.children.length > 0) {
        const timer = window.setTimeout(() => {
          setActiveNode((current) => {
            if (!current || current.id !== activeNode.id || current.children.length === 0) return current;
            const next = current.children[0]!;
            setStatus(nodeComment(next) || nodeLabel(next));
            return next;
          });
        }, 420);
        return () => window.clearTimeout(timer);
      }
      setStatus(isSuccessNode(activeNode) ? 'AI 达成题目目标，你未能阻止它。' : isFailureNode(activeNode) ? '你成功阻止了 AI！' : 'AI 停止解题。');
      return;
    }
    if (offTreePosition) {
      void runReverseAiTurn(offTreePosition);
    }
  }, [activeNode, currentPosition, mode, offTreePosition, root, runReverseAiTurn, solverSide, thinking]);

  const handleBoardClick = (x: number, y: number) => {
    if (!root || !currentPosition || thinking) return;

    if (mode === 'decompose') {
      const node = getCurrentNode();
      const child = node?.children.find((candidate) => candidate.move?.x === x && candidate.move?.y === y);
      if (child) setNode(child);
      return;
    }

    if (mode === 'practice') {
      if (currentPosition.currentPlayer !== userSide) return;
      const node = getCurrentNode();
      const child = node?.children.find((candidate) => candidate.move?.x === x && candidate.move?.y === y);
      if (child) {
        setNode(child);
        const next = positionForNode(root, child);
        if (child.children.length > 0 && next.currentPlayer !== userSide) {
          window.setTimeout(() => {
            setActiveNode((current) => {
              if (!current || current.id !== child.id || current.children.length === 0) return current;
              const response = current.children[0]!;
              setStatus(nodeComment(response) || nodeLabel(response));
              return response;
            });
          }, 420);
        }
        if (isSuccessNode(child)) setStatus('成功！你达成了题目目标。');
        return;
      }

      const move: Move = { x, y, player: currentPosition.currentPlayer };
      const next = applyMoveToPosition(currentPosition, move);
      if (!next) return;
      setOffTree(next);
      setActiveNode(null);
      setStatus('这手不在题目分支内，交给 AI 试做。');
      void runAiAttempt(next);
      return;
    }

    if (mode === 'reverse') {
      if (currentPosition.currentPlayer === solverSide) return;
      const node = getCurrentNode();
      const child = node?.children.find((candidate) => candidate.move?.x === x && candidate.move?.y === y);
      if (child) {
        setNode(child);
        if (isFailureNode(child)) setStatus('你成功阻止了 AI！');
        else if (isSuccessNode(child)) setStatus('AI 达成题目目标，你未能阻止它。');
        return;
      }
      const move: Move = { x, y, player: currentPosition.currentPlayer };
      const next = applyMoveToPosition(currentPosition, move);
      if (!next) return;
      setOffTree(next);
      setActiveNode(null);
      setStatus(`你走了 ${moveCoordinate(move)}，轮到 AI 解题。`);
      void runReverseAiTurn(next);
    }
  };

  const stepBack = () => {
    if (!root || !currentPosition) return;
    clearAutoPlay();
    if (activeNode?.parent && activeNode !== root) {
      setNode(activeNode.parent);
      return;
    }
    if (offTreePosition && offTreePosition.moveHistory.length > 0) {
      const moves = offTreePosition.moveHistory.slice(0, -1);
      let node = root;
      let position = positionForNode(root, root);
      for (const move of moves) {
        const child = node.children.find((candidate) => candidate.move?.x === move.x && candidate.move?.y === move.y && candidate.move?.player === move.player);
        if (child) {
          node = child;
          position = positionForNode(root, child);
        } else {
          const next = applyMoveToPosition(position, move);
          if (!next) break;
          position = next;
        }
      }
      setActiveNode(node === root ? root : node);
      setOffTreePosition(node === root ? null : position);
      setStatus('');
    }
  };

  const stepForward = () => {
    if (!root) return;
    clearAutoPlay();
    const node = getCurrentNode();
    if (node?.children[0]) setNode(node.children[0]);
  };

  const branchChildren = getCurrentNode()?.children ?? [];

  return (
    <main className="practice-shell practice-detail-shell">
      <header className="practice-header">
        <div className="practice-header-links">
          <Link to="/practice" className="home-button"><FaListUl />题库</Link>
          <Link to="/" className="home-button"><FaHome />主页</Link>
        </div>
        <h1>{item?.title ?? '练习'}</h1>
      </header>

      {loading && <div className="practice-status">正在载入题目…</div>}
      {error && <div className="practice-status practice-error">{error}</div>}

      {!loading && !error && root && currentPosition && problemRect && (
        <>
          <div className="practice-meta">
            <span>{item?.collection ? `#${item.n ?? item.id}` : ''}</span>
            {item?.level != null && <span>难度 {item.level}</span>}
            <span>{hasSolutions ? '含完整解题分支' : '位置摆题'}</span>
          </div>

          <div className="practice-board-wrap">
            <PracticeBoardGrid
              board={currentPosition.board}
              rect={problemRect}
              currentMove={currentPosition.lastMove}
              currentPlayer={currentPosition.currentPlayer}
              canInteract={!thinking}
              onPointClick={handleBoardClick}
            />
            {thinking && <div className="board-loading"><div className="loading-track"><i /></div><span>AI 计算中…</span></div>}
          </div>

          <div className="practice-turn">
            <span className={`practice-turn-dot ${currentPosition.currentPlayer}`} />
            轮到 {currentPosition.currentPlayer === 'black' ? '黑' : '白'}方
            {mode === 'practice' && currentPosition.currentPlayer !== userSide && '（AI 应对）'}
            {mode === 'reverse' && currentPosition.currentPlayer === solverSide && '（AI 解题）'}
          </div>

          <div className="practice-status-line">{status || (getCurrentNode() ? nodeLabel(getCurrentNode()!) : '')}</div>

          <div className="practice-mode-tabs" role="tablist" aria-label="练习模式">
            <button type="button" className={mode === 'decompose' ? 'active' : ''} onClick={() => setModeWithReset('decompose')}>题目拆解</button>
            <button type="button" className={mode === 'practice' ? 'active' : ''} onClick={() => setModeWithReset('practice')}>题目试做</button>
            <button type="button" className={mode === 'reverse' ? 'active' : ''} onClick={() => setModeWithReset('reverse')}>逆转挑战</button>
          </div>

          <div className="practice-controls">
            <button type="button" onClick={stepBack} disabled={!currentPosition.moveHistory.length && !activeNode?.parent}>
              <FaStepBackward />后退
            </button>
            {mode === 'decompose' && (
              <>
                <button type="button" onClick={stepForward} disabled={!getCurrentNode()?.children.length}>
                  <FaStepForward />前进
                </button>
                <button type="button" onClick={() => (autoPlay ? clearAutoPlay() : setAutoPlay(true))}>
                  {autoPlay ? <FaPause /> : <FaPlay />}{autoPlay ? '暂停' : '自动走谱'}
                </button>
                <button type="button" onClick={() => setModeWithReset('decompose')}><FaRedo />重置</button>
              </>
            )}
            {mode !== 'decompose' && (
              <button type="button" onClick={() => setModeWithReset(mode)}><FaRedo />重置题目</button>
            )}
          </div>

          {mode === 'decompose' && branchChildren.length > 0 && (
            <div className="practice-branches">
              <div className="practice-branches-title">当前分支（{branchChildren.length}）</div>
              {branchChildren.map((child) => (
                <button
                  key={child.id}
                  type="button"
                  className="practice-branch"
                  onClick={() => setNode(child)}
                >
                  <span>{moveCoordinate(child.move)}</span>
                  <small>{nodeLabel(child)}</small>
                </button>
              ))}
            </div>
          )}

          {mode === 'practice' && !hasSolutions && (
            <p className="practice-hint">该题只有局面、没有官方解答。你可先落子，AI 会在题目范围内与你试做。</p>
          )}
        </>
      )}
    </main>
  );
}
