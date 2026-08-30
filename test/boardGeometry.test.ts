import { describe, expect, it } from 'vitest';
import { columnLabel, getBoardGeometry, linePosition, pointPosition } from '../src/utils/boardGeometry';

describe('board geometry', () => {
  it('keeps the grid inside the board and exposes hoshi points', () => {
    const geometry = getBoardGeometry(19);
    expect(geometry.pointInset).toBeGreaterThan(2.4);
    expect(geometry.pointInset + geometry.pointSpan / 2).toBeCloseTo(50, 5);
    expect(geometry.hoshiPoints.has('3-3')).toBe(true);
    expect(geometry.hoshiPoints.has('9-9')).toBe(true);
  });

  it('adds a center hoshi for small boards without defined star points', () => {
    expect(getBoardGeometry(5).hoshiPoints.has('2-2')).toBe(true);
    expect(getBoardGeometry(7).hoshiPoints.has('3-3')).toBe(true);
  });

  it('positions points and lines within the spanned grid', () => {
    const geometry = getBoardGeometry(9);
    const first = pointPosition(geometry, 9, 0, 0);
    const last = pointPosition(geometry, 9, 8, 8);
    expect(Number.parseFloat(first.left)).toBeCloseTo(geometry.pointInset, 5);
    expect(Number.parseFloat(last.left)).toBeCloseTo(geometry.pointInset + geometry.pointSpan, 5);
    const line = linePosition(geometry, 9, 0);
    expect(line.offset).toBe(`${geometry.pointInset}%`);
    expect(line.length).toBe(`${geometry.pointSpan}%`);
  });

  it('labels columns with Go coordinates that skip I', () => {
    expect(columnLabel(0)).toBe('A');
    expect(columnLabel(7)).toBe('H');
    expect(columnLabel(8)).toBe('J');
    expect(columnLabel(18)).toBe('T');
  });
});
