interface ScoreDialogProps {
  blackPoints: number;
  whitePoints: number;
  onClose: () => void;
  onNewGame: () => void;
}

export function ScoreDialog({ blackPoints, whitePoints, onClose, onNewGame }: ScoreDialogProps) {
  const winner = blackPoints > whitePoints
    ? `黑胜 ${(blackPoints - whitePoints).toFixed(1)} 目`
    : `白胜 ${(whitePoints - blackPoints).toFixed(1)} 目`;
  return (
    <div className="dialog-backdrop">
      <section className="result-dialog">
        <strong>终局结果</strong>
        <p>{winner}</p>
        <div className="score-legend">
          <span><i className="black" />黑 {blackPoints.toFixed(1)} 目</span>
          <span><i className="white" />白 {whitePoints.toFixed(1)} 目</span>
        </div>
        <div>
          <button onClick={onClose}>返回</button>
          <button className="dialog-start" onClick={onNewGame}>新对局</button>
        </div>
      </section>
    </div>
  );
}
