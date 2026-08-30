import type { GameNode, GameSettings, Player } from '../types';
import { ENGINE_MAX_TIME_MS } from '../engine/katago/limits';
import { analysisQueue } from '../utils/analysisQueue';
import { getAiRequestEpoch, sleep } from './analysis';

/** The slice of the game store the AI player reads and drives. */
export interface AiPlayerStore {
  isAiPlaying: boolean;
  aiColor: Player | null;
  currentPlayer: Player;
  currentNode: GameNode;
  settings: GameSettings;
  isContinuousAnalysis: boolean;
  isAnalysisMode: boolean;
  isAiThinking: boolean;
  makeAiMove: (opts?: { force?: boolean }) => void;
  passTurn: () => void;
  playMove: (x: number, y: number) => void;
  toggleContinuousAnalysis: () => void;
}

export function toggleAiPlayer(
  getStore: () => AiPlayerStore,
  setStore: (patch: Partial<AiPlayerStore>) => void,
  color: Player
): void {
  const state = getStore();
  const nextOn = !(state.isAiPlaying && state.aiColor === color);
  if (!nextOn) analysisQueue.cancelGroup('move-search');
  setStore({ isAiPlaying: nextOn, aiColor: nextOn ? color : null });
  const after = getStore();
  if (after.isAiPlaying && after.aiColor === after.currentPlayer) {
    setTimeout(() => after.makeAiMove(), 0);
  }
}

export function setAiPlayerState(
  setStore: (patch: Partial<AiPlayerStore>) => void,
  color: Player | null,
  enabled = false
): void {
  if (!enabled) analysisQueue.cancelGroup('move-search');
  setStore({ aiColor: color, isAiPlaying: enabled });
}

/**
 * Schedules the AI's next move after a delay, skipping it if the visible
 * position or the AI-request epoch changed while waiting.
 */
export function scheduleAiMove(getStore: () => AiPlayerStore, delayMs: number): void {
  const scheduledEpoch = getAiRequestEpoch();
  const scheduledNodeId = getStore().currentNode.id;
  setTimeout(() => {
    const latest = getStore();
    if (getAiRequestEpoch() !== scheduledEpoch || latest.currentNode.id !== scheduledNodeId) return;
    if (!latest.isAiThinking) void latest.makeAiMove();
  }, delayMs);
}

/**
 * Runs the AI turn: thinks for the configured time, waits for the search to
 * produce candidate moves, then plays the top-ranked one (or passes when the
 * search recommends a pass).
 */
export function runAiMove(
  getStore: () => AiPlayerStore,
  setStore: (patch: Partial<AiPlayerStore>) => void,
  opts?: { force?: boolean }
): void {
  const force = opts?.force ?? false;
  const initial = getStore();
  if (!force && (!initial.isAiPlaying || !initial.aiColor || initial.currentPlayer !== initial.aiColor)) return;
  const nodeId = initial.currentNode.id;
  const playerAtStart = initial.currentPlayer;
  const epoch = getAiRequestEpoch();
  const thinkingMs = Math.max(25, Math.min(initial.settings.katagoMaxTimeMs, ENGINE_MAX_TIME_MS));
  setStore({ isAiThinking: true, isAnalysisMode: true });
  if (!initial.isContinuousAnalysis) getStore().toggleContinuousAnalysis();
  void (async () => {
    await sleep(thinkingMs);
    while (true) {
      const latest = getStore();
      if (getAiRequestEpoch() !== epoch || latest.currentNode.id !== nodeId || latest.currentPlayer !== playerAtStart) return;
      if (!force && (!latest.isAiPlaying || latest.aiColor !== playerAtStart)) return;
      if (latest.currentNode.analysis?.moves?.length) break;
      await sleep(25);
    }
    const latest = getStore();
    if (getAiRequestEpoch() !== epoch || latest.currentNode.id !== nodeId || latest.currentPlayer !== playerAtStart) return;
    if (!force && (!latest.isAiPlaying || latest.aiColor !== playerAtStart)) return;
    const best = latest.currentNode.analysis?.moves?.[0];
    if (!best) return;
    setStore({ isAiThinking: false });
    if (best.x < 0 || best.y < 0) latest.passTurn();
    else latest.playMove(best.x, best.y);
  })().catch(() => {
    if (getAiRequestEpoch() === epoch) setStore({ isAiThinking: false });
  });
}
