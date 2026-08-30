import { useState } from 'react';
import type { Player } from '../../types';
import {
  defaultThinkingForTier,
  getModelTier,
  KATAGO_MODEL_TIERS,
  type KataGoModelTierId,
} from '../../engine/katago/modelDefaults';
import { formatThinkingSeconds } from '../../utils/format';

const SIZES = [
  { size: 5, name: '启蒙枰' }, { size: 7, name: '斗星枰' },
  { size: 9, name: '方圆枰' }, { size: 11, name: '玲珑枰' },
  { size: 13, name: '星野枰' }, { size: 15, name: '中和枰' },
  { size: 17, name: '古韵枰' }, { size: 19, name: '标准枰' },
] as const;

export interface NewGameDraft {
  boardSize: number;
  humanColor: Player;
  selfPlay: boolean;
  modelTier: KataGoModelTierId;
  thinkingMsByTier: Record<KataGoModelTierId, number>;
}

interface NewGameDialogProps {
  initialSize: number;
  initialHumanColor: Player;
  initialSelfPlay: boolean;
  initialModelTier: KataGoModelTierId;
  initialThinkingMsByTier: Record<KataGoModelTierId, number>;
  onClose: () => void;
  onStart: (draft: NewGameDraft) => void;
}

export function NewGameDialog({
  initialSize,
  initialHumanColor,
  initialSelfPlay,
  initialModelTier,
  initialThinkingMsByTier,
  onClose,
  onStart,
}: NewGameDialogProps) {
  const [draftSize, setDraftSize] = useState(initialSize);
  const [draftHumanColor, setDraftHumanColor] = useState<Player>(initialHumanColor);
  const [draftSelfPlay, setDraftSelfPlay] = useState(initialSelfPlay);
  const [draftModelTier, setDraftModelTier] = useState<KataGoModelTierId>(initialModelTier);
  const [draftThinkingMsByTier, setDraftThinkingMsByTier] = useState(initialThinkingMsByTier);
  const selectedTier = getModelTier(draftModelTier);

  const selectThinkingMs = (ms: number) => {
    setDraftThinkingMsByTier((prev) => ({ ...prev, [draftModelTier]: ms }));
  };

  // Self-play always uses the bundled B10 model; the model selector is
  // disabled so the pair can never depend on a 96 MB download.
  const selectSelfPlay = () => {
    setDraftSelfPlay(true);
    setDraftModelTier('b10');
  };

  const start = () => {
    onStart({
      boardSize: draftSize,
      humanColor: draftHumanColor,
      selfPlay: draftSelfPlay,
      modelTier: draftModelTier,
      thinkingMsByTier: draftThinkingMsByTier,
    });
  };

  return (
    <div className="dialog-backdrop">
      <section className="new-game-dialog">
        <div className="dialog-title">
          <strong>新对局</strong>
          <button onClick={onClose} aria-label="关闭">×</button>
        </div>
        <label>棋盘<div className="dialog-options board-options">
          {SIZES.map((option) => (
            <button key={option.size} className={draftSize === option.size ? 'selected' : ''} onClick={() => setDraftSize(option.size)}>
              {option.name}({option.size})
            </button>
          ))}
        </div></label>
        <label>执方<div className="dialog-options full-options player-options">
          <button className={draftHumanColor === 'black' && !draftSelfPlay ? 'selected' : ''} onClick={() => { setDraftHumanColor('black'); setDraftSelfPlay(false); }}>
            <span className="dialog-stone black-stone" />执黑
          </button>
          <button className={draftHumanColor === 'white' && !draftSelfPlay ? 'selected' : ''} onClick={() => { setDraftHumanColor('white'); setDraftSelfPlay(false); }}>
            <span className="dialog-stone white-stone" />执白
          </button>
          <button className={draftSelfPlay ? 'selected' : ''} onClick={selectSelfPlay}>
            <span className="dialog-stone black-stone" /><span className="dialog-stone white-stone" />自弈
          </button>
        </div></label>
        <label>模型<div className="dialog-options model-options">
          {KATAGO_MODEL_TIERS.map((tier) => (
            <button
              key={tier.id}
              className={draftModelTier === tier.id ? 'selected' : ''}
              disabled={draftSelfPlay}
              onClick={() => setDraftModelTier(tier.id)}
              title={`${tier.modelName} · 思考 ${tier.minThinkingMs / 1000}–${tier.maxThinkingMs / 1000} 秒`}
            >
              {tier.label}
              {draftModelTier === tier.id && <small>{formatThinkingSeconds(draftThinkingMsByTier[tier.id] ?? defaultThinkingForTier(tier))}</small>}
            </button>
          ))}
        </div>
        {draftSelfPlay && <small className="selfplay-model-note">自弈固定使用 B10 模型</small>}
        <input
          type="range"
          className="thinking-slider"
          min={selectedTier ? Math.round(selectedTier.minThinkingMs / 1000) : 2}
          max={selectedTier ? Math.round(selectedTier.maxThinkingMs / 1000) : 30}
          step={1}
          value={(draftThinkingMsByTier[draftModelTier] ?? defaultThinkingForTier(selectedTier)) / 1000}
          disabled={draftSelfPlay}
          onChange={(event) => selectThinkingMs(Number(event.target.value) * 1000)}
          aria-label="每步思考时间（秒）"
        /></label>
        <button className="dialog-start" onClick={start}>开始对局</button>
      </section>
    </div>
  );
}
