import type { GameNode } from '../types';

export type ActiveBranchMap = Record<string, string>;

export function rememberActiveBranchPath(activeBranches: ActiveBranchMap, node: GameNode): ActiveBranchMap {
  const next = { ...activeBranches };
  let cursor: GameNode | null = node;
  while (cursor?.parent) {
    next[cursor.parent.id] = cursor.id;
    cursor = cursor.parent;
  }
  return next;
}
