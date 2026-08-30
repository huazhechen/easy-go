import type { CSSProperties } from 'react';
import type { Player } from '../types';

interface MatchCardProps {
  blackSideName: string;
  whiteSideName: string;
  capturedWhite: number;
  capturedBlack: number;
  currentPlayer: Player;
  blackIsHuman: boolean;
  whiteIsHuman: boolean;
  displayWinRate: number;
}

export function MatchCard({
  blackSideName,
  whiteSideName,
  capturedWhite,
  capturedBlack,
  currentPlayer,
  blackIsHuman,
  whiteIsHuman,
  displayWinRate,
}: MatchCardProps) {
  return (
    <section className="match-card" style={{ '--match-split-num': displayWinRate } as CSSProperties}>
      <span className="stone-avatar black-stone">
        {currentPlayer === 'black' && <span className={blackIsHuman ? 'turn-mark active' : 'turn-mark thinking'} aria-label="黑方回合" />}
      </span>
      <div className="match-side"><strong>{blackSideName}</strong><small className="match-captures">提子: {capturedWhite}</small></div>
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
      <div className="match-side right"><strong>{whiteSideName}</strong><small className="match-captures">提子: {capturedBlack}</small></div>
      <span className="stone-avatar white-stone">
        {currentPlayer === 'white' && <span className={whiteIsHuman ? 'turn-mark active' : 'turn-mark thinking'} aria-label="白方回合" />}
      </span>
    </section>
  );
}
