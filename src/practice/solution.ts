import { collectBranchLeaves, type SgfNode } from './sgf';

const positiveComment = (node: SgfNode): boolean => {
  const text = (node.properties.C ?? []).join(' ').toLowerCase();
  return text.includes('correct') || text.includes('also correct') || text.includes('success');
};

export function hasSolutionTree(root: SgfNode): boolean {
  return collectBranchLeaves(root).some((node) => positiveComment(node));
}

export function nodeLeadsToSuccess(node: SgfNode): boolean {
  if (positiveComment(node)) return true;
  return node.children.some(nodeLeadsToSuccess);
}

export function solutionChildren(node: SgfNode): SgfNode[] {
  if (hasSolutionTree(node)) {
    return node.children.filter(nodeLeadsToSuccess);
  }
  return [...node.children];
}

export function isSuccessNode(node: SgfNode): boolean {
  if (hasSolutionTree(node)) return positiveComment(node);
  return node.children.length === 0;
}

export function isFailureNode(node: SgfNode): boolean {
  if (!hasSolutionTree(node)) return node.children.length === 0;
  return node.children.length === 0 && !positiveComment(node);
}

export function nodeComment(node: SgfNode): string {
  return (node.properties.C ?? []).join('\n').trim();
}

export function nodeLabel(node: SgfNode): string {
  const comment = nodeComment(node);
  if (comment) return comment;
  if (node.children.length > 1) return `${node.children.length} 个分支`;
  if (node.children.length === 1) return '下一手';
  return positiveComment(node) ? '成功' : '结束';
}

export function flattenSuccessPaths(
  node: SgfNode,
  prefix: SgfNode[] = []
): SgfNode[][] {
  const path = [...prefix, node];
  if (positiveComment(node)) return [path];
  if (node.children.length === 0) return [];
  return node.children.flatMap((child) => flattenSuccessPaths(child, path));
}
