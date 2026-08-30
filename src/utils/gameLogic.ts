import type { BoardState, Player } from '../types';

export const getOpponent = (player: Player): Player => player === 'black' ? 'white' : 'black';

export const boardsEqual = (a: BoardState, b: BoardState): boolean => {
  if (a.length !== b.length) return false;
  const size = a.length;
  for (let y = 0; y < size; y++) {
    const rowA = a[y];
    const rowB = b[y];
    if (!rowA || !rowB || rowA.length !== rowB.length) return false;
    for (let x = 0; x < size; x++) {
      if (rowA[x] !== rowB[x]) return false;
    }
  }
  return true;
};

export const getLiberties = (board: BoardState, x: number, y: number): { liberties: number, group: {x: number, y: number}[] } => {
  const player = board[y][x];
  if (!player) return { liberties: 0, group: [] };

  const size = board.length;
  const group: {x: number, y: number}[] = [];
  const visited = new Set<string>();
  const liberties = new Set<string>();
  const stack = [{x, y}];

  visited.add(`${x},${y}`);
  group.push({x, y});

  while (stack.length > 0) {
    const current = stack.pop()!;
    const neighbors = [
      {x: current.x + 1, y: current.y},
      {x: current.x - 1, y: current.y},
      {x: current.x, y: current.y + 1},
      {x: current.x, y: current.y - 1},
    ];

    for (const n of neighbors) {
      if (n.x < 0 || n.x >= size || n.y < 0 || n.y >= size) continue;

      const key = `${n.x},${n.y}`;
      const content = board[n.y][n.x];

      if (content === null) {
        liberties.add(key);
      } else if (content === player && !visited.has(key)) {
        visited.add(key);
        group.push(n);
        stack.push(n);
      }
    }
  }

  return { liberties: liberties.size, group };
};

export const applyCapturesInPlace = (board: BoardState, x: number, y: number, player: Player): { x: number; y: number }[] => {
  const opponent = getOpponent(player);
  const size = board.length;
  const neighbors = [
    {x: x + 1, y},
    {x: x - 1, y},
    {x, y: y + 1},
    {x, y: y - 1},
  ];

  const captured: {x: number, y: number}[] = [];

  for (const n of neighbors) {
    if (n.x < 0 || n.x >= size || n.y < 0 || n.y >= size) continue;

    if (board[n.y][n.x] === opponent) {
      const { liberties, group } = getLiberties(board, n.x, n.y);
      if (liberties === 0) {
        captured.push(...group);
        for (const stone of group) {
          board[stone.y][stone.x] = null;
        }
      }
    }
  }

  return captured;
};

/**
 * Simulates playing `player` at (x, y): clones the board, places the stone,
 * and removes any captured opponent groups. The returned board always
 * contains the played stone, so callers can use it directly as the position
 * after the move.
 */
export const checkCaptures = (board: BoardState, x: number, y: number, player: Player): { captured: {x: number, y: number}[], newBoard: BoardState } => {
  const newBoard = board.map(row => [...row]);
  newBoard[y]![x] = player;
  const captured = applyCapturesInPlace(newBoard, x, y, player);
  return { captured, newBoard };
};

export const isValidMove = (board: BoardState, x: number, y: number, player: Player, previousBoard?: BoardState): boolean => {
    const size = board.length;
    // 1. Bounds
    if (x < 0 || x >= size || y < 0 || y >= size) return false;

    // 2. Occupied
    if (board[y][x] !== null) return false;

    // Simulate move
    const tentativeBoard = board.map(row => [...row]);
    tentativeBoard[y][x] = player;

    // 3. Check Captures
    const captured = applyCapturesInPlace(tentativeBoard, x, y, player);

    // 4. Suicide Check
    if (captured.length === 0) {
        const { liberties } = getLiberties(tentativeBoard, x, y);
        if (liberties === 0) return false;
    }

    // 5. Ko Check (Simple Ko)
    if (previousBoard) {
        if (boardsEqual(tentativeBoard, previousBoard)) return false;
    }

    return true;
};
