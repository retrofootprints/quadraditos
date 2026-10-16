import { config } from '../config';
import type { ExportOptions } from './types';

export interface ExportPlan {
  cell: number;
  width: number;
  height: number;
  gridX: number;
  gridY: number;
  gridW: number;
  gridH: number;
  legendY: number;
  legendPerRow: number;
  legendRows: number;
  fontPx: number;
  showCodes: boolean;
  showNumbers: boolean;
  showLegend: boolean;
  lines: boolean;
  heavyEvery: number;
  warnings: string[];
}

export interface PlanInput {
  cols: number;
  rows: number;
  colorsUsed: number;
  options: ExportOptions;
}

function sizeFor(cell: number, { cols, rows, colorsUsed, options }: PlanInput) {
  const e = config.export;
  const plain = options.layout === 'plain';
  const font = Math.max(9, Math.min(22, Math.round(cell * 0.42)));
  const numMargin = !plain && options.numbers ? Math.max(28, Math.round(font * 2.6)) : 0;
  const pad = plain ? 0 : Math.max(12, Math.round(cell * 0.4));
  const gridX = numMargin + (numMargin ? 0 : pad);
  const gridY = numMargin + (numMargin ? 0 : pad);
  const gridW = cols * cell;
  const gridH = rows * cell;
  const showLegend = !plain && options.legend;
  let width = gridX + gridW + pad;
  if (showLegend) width = Math.max(width, e.legendEntryW + 2 * pad);
  const perRow = showLegend ? Math.max(1, Math.floor((width - 2 * pad) / e.legendEntryW)) : 0;
  const legendRows = showLegend ? Math.ceil(Math.max(1, colorsUsed) / perRow) : 0;
  const legendH = showLegend ? pad + legendRows * e.legendEntryH + 36 + pad : plain ? 0 : pad;
  const height = gridY + gridH + legendH;
  return { font, numMargin, pad, gridX, gridY, gridW, gridH, width, height, perRow, legendRows, showLegend };
}

/**
 * Choose the cell size: as large as `maxCell`, shrunk until the longest side is at
 * most `maxSide`, and never below `minCell` (a warning is added if both cannot hold).
 */
export function planExport(input: PlanInput): ExportPlan {
  const e = config.export;
  const warnings: string[] = [];
  let cell = e.maxCell;
  let s = sizeFor(cell, input);
  while (cell > e.minCell && Math.max(s.width, s.height) > e.maxSide) {
    cell--;
    s = sizeFor(cell, input);
  }
  if (Math.max(s.width, s.height) > e.maxSide) {
    warnings.push(
      `The grid needs ${s.width} × ${s.height} px at the minimum cell size of ${e.minCell} px, which is over the ${e.maxSide} px limit. Use fewer columns or turn off the legend.`,
    );
  }
  const plain = input.options.layout === 'plain';
  const codesWanted = input.options.layout === 'code' || (input.options.layout === 'colour' && input.options.codes);
  const showCodes = codesWanted && cell >= e.minCodeCell;
  if (codesWanted && !showCodes) warnings.push(`Cells are smaller than ${e.minCodeCell} px, so codes are hidden.`);
  return {
    cell,
    width: s.width,
    height: s.height,
    gridX: s.gridX,
    gridY: s.gridY,
    gridW: s.gridW,
    gridH: s.gridH,
    legendY: s.gridY + s.gridH + s.pad,
    legendPerRow: s.perRow,
    legendRows: s.legendRows,
    fontPx: s.font,
    showCodes,
    showNumbers: !plain && input.options.numbers && s.numMargin > 0,
    showLegend: s.showLegend,
    lines: !plain && input.options.gridLines,
    heavyEvery: plain ? 0 : input.options.heavyEvery,
    warnings,
  };
}

/** CSV of the grid: one line per cell, "row,column,code" (1-based). */
export function gridToCsv(indices: ArrayLike<number>, cols: number, rows: number, codes: string[]): string {
  const lines = ['row,column,code'];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const code = codes[indices[y * cols + x]] ?? '';
      lines.push(`${y + 1},${x + 1},${code.includes(',') || code.includes('"') ? `"${code.replace(/"/g, '""')}"` : code}`);
    }
  }
  return lines.join('\n') + '\n';
}
