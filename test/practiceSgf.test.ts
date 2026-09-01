import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { hasSolutionTree, nodeLeadsToSuccess } from '../src/practice/solution';
import { parseSgf, positionForNode, sgfCoordToPoint } from '../src/practice/sgf';
import { compactBoardRect, cropBoard, intersectionMask } from '../src/practice/geometry';

const readData = (path: string): string => fs.readFileSync(path, 'utf8');

describe('practice SGF reader', () => {
  it('parses a commented Go Game Guru solution tree', () => {
    const sgf = readData('public/data/tsumego/ggg/easy/ggg-easy-01.sgf');
    const parsed = parseSgf(sgf);
    const root = parsed.roots[0]!;
    const initial = positionForNode(root, root);

    expect(initial.board).toHaveLength(19);
    expect(initial.currentPlayer).toBe('black');
    expect(initial.board.filter((row) => row.includes('black')).length).toBeGreaterThan(0);
    expect(root.children.length).toBeGreaterThanOrEqual(4);
    expect(root.children[0]?.move).toMatchObject({ x: 17, y: 18, player: 'black' });
    expect(root.children[0]?.children[0]?.move).toMatchObject({ x: 17, y: 17, player: 'white' });
    expect(hasSolutionTree(root)).toBe(true);
    expect(nodeLeadsToSuccess(root.children[0]!)).toBe(true);
  });

  it('maps SGF coordinates from the top-left', () => {
    expect(sgfCoordToPoint('aa')).toEqual({ x: 0, y: 0 });
    expect(sgfCoordToPoint('rs')).toEqual({ x: 17, y: 18 });
  });

  it('crops a problem to its stones and solution moves', () => {
    const parsed = parseSgf('(;GM[1]SZ[19]AB[cc][cd][dc]AW[dd](;B[ce])(;B[ec]))');
    const root = parsed.roots[0]!;
    const initial = positionForNode(root, root);
    const points = root.children.map((child) => child.move!).map((move) => ({ x: move.x, y: move.y }));
    const rect = compactBoardRect(initial.board, points, 1);
    const crop = cropBoard(initial.board, rect);
    const mask = intersectionMask(rect, 19, points);

    expect(rect.left).toBeLessThanOrEqual(1);
    expect(rect.right).toBeGreaterThanOrEqual(4);
    expect(crop.length).toBe(rect.bottom - rect.top);
    expect(mask.filter(Boolean).length).toBeGreaterThan(0);
  });
});
