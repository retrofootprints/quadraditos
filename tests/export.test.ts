import { describe, expect, it } from 'vitest';
import { config } from '../src/config';
import { gridToCsv, planExport } from '../src/core/exportLayout';
import { contrastInk } from '../src/core/exportRender';
import { defaultStudio } from '../src/core/types';

const opts = (over = {}) => ({ ...defaultStudio().export, ...over });

describe('planExport', () => {
  it('keeps the longest side within 4096 px and cells at least 12 px', () => {
    const p = planExport({ cols: 48, rows: 64, colorsUsed: 10, options: opts() });
    expect(Math.max(p.width, p.height)).toBeLessThanOrEqual(config.export.maxSide);
    expect(p.cell).toBeGreaterThanOrEqual(config.export.minCell);
    expect(p.warnings).toEqual([]);
  });

  it('shrinks cells for big grids and warns when 12 px cells cannot fit', () => {
    const big = planExport({ cols: 100, rows: 100, colorsUsed: 10, options: opts() });
    expect(big.cell).toBeLessThan(config.export.maxCell);
    expect(Math.max(big.width, big.height)).toBeLessThanOrEqual(config.export.maxSide);
    const huge = planExport({ cols: 200, rows: 400, colorsUsed: 10, options: opts() });
    expect(huge.cell).toBe(config.export.minCell);
    expect(huge.warnings.length).toBeGreaterThan(0);
  });

  it('plain layout is exactly the grid', () => {
    const p = planExport({ cols: 20, rows: 30, colorsUsed: 5, options: opts({ layout: 'plain' }) });
    expect(p.width).toBe(20 * p.cell);
    expect(p.height).toBe(30 * p.cell);
    expect(p.showLegend).toBe(false);
    expect(p.lines).toBe(false);
  });

  it('hides codes under 14 px cells', () => {
    const p = planExport({ cols: 300, rows: 200, colorsUsed: 10, options: opts({ layout: 'code' }) });
    expect(p.cell).toBeLessThan(config.export.minCodeCell);
    expect(p.showCodes).toBe(false);
    expect(p.warnings.some((w) => w.includes('codes are hidden'))).toBe(true);
    const q = planExport({ cols: 10, rows: 10, colorsUsed: 3, options: opts({ layout: 'code' }) });
    expect(q.showCodes).toBe(true);
  });

  it('reserves room for the legend', () => {
    const withLegend = planExport({ cols: 20, rows: 20, colorsUsed: 12, options: opts() });
    const without = planExport({ cols: 20, rows: 20, colorsUsed: 12, options: opts({ legend: false }) });
    expect(withLegend.height).toBeGreaterThan(without.height);
  });
});

describe('export helpers', () => {
  it('picks readable ink', () => {
    expect(contrastInk('#ffffff')).toBe('#000000');
    expect(contrastInk('#101030')).toBe('#ffffff');
  });
  it('writes a 1-based CSV', () => {
    const csv = gridToCsv([0, 1, 1, 0], 2, 2, ['A', 'B']);
    expect(csv.trim().split('\n')).toEqual(['row,column,code', '1,1,A', '1,2,B', '2,1,B', '2,2,A']);
  });
});
