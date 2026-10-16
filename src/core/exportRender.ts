import { config } from '../config';
import { hexToBytes } from './color';
import type { ExportPlan } from './exportLayout';
import type { ExportLayoutKind } from './types';

export type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export interface ExportColor {
  hex: string;
  code: string;
  name: string;
  count: number;
}

export interface ExportData {
  cols: number;
  rows: number;
  indices: ArrayLike<number>;
  colors: ExportColor[];
  layout: ExportLayoutKind;
  paletteName: string;
  date: string;
}

/** Black or white, whichever reads better on the given background. */
export function contrastInk(hex: string): string {
  const c = hexToBytes(hex) ?? [128, 128, 128];
  const lum = (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255;
  return lum > 0.55 ? '#000000' : '#ffffff';
}

const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';

function fit(ctx: Ctx2D, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1);
  return t + '…';
}

export function renderExport(ctx: Ctx2D, plan: ExportPlan, data: ExportData): void {
  const { cell, gridX, gridY, gridW, gridH } = plan;
  const { cols, rows, indices, colors } = data;

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, plan.width, plan.height);

  // cells
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const c = colors[indices[y * cols + x]];
      if (!c) continue;
      if (data.layout !== 'code') {
        ctx.fillStyle = c.hex;
        ctx.fillRect(gridX + x * cell, gridY + y * cell, cell, cell);
      }
    }
  }

  // codes
  if (plan.showCodes) {
    ctx.font = `600 ${Math.max(8, Math.round(cell * 0.5))}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const c = colors[indices[y * cols + x]];
        if (!c) continue;
        ctx.fillStyle = data.layout === 'code' ? '#000000' : contrastInk(c.hex);
        ctx.fillText(c.code, gridX + x * cell + cell / 2, gridY + y * cell + cell / 2 + 1);
      }
    }
  }

  // grid lines
  if (plan.lines) {
    ctx.strokeStyle = data.layout === 'code' ? '#9aa0a8' : 'rgba(0,0,0,0.28)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= cols; x++) {
      ctx.moveTo(gridX + x * cell + 0.5, gridY);
      ctx.lineTo(gridX + x * cell + 0.5, gridY + gridH);
    }
    for (let y = 0; y <= rows; y++) {
      ctx.moveTo(gridX, gridY + y * cell + 0.5);
      ctx.lineTo(gridX + gridW, gridY + y * cell + 0.5);
    }
    ctx.stroke();
  }
  if (plan.heavyEvery > 0) {
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let x = 0; x <= cols; x += plan.heavyEvery) {
      ctx.moveTo(gridX + x * cell, gridY);
      ctx.lineTo(gridX + x * cell, gridY + gridH);
    }
    for (let y = 0; y <= rows; y += plan.heavyEvery) {
      ctx.moveTo(gridX, gridY + y * cell);
      ctx.lineTo(gridX + gridW, gridY + y * cell);
    }
    ctx.stroke();
  }

  // row and column numbers
  if (plan.showNumbers) {
    ctx.fillStyle = '#333333';
    ctx.font = `${Math.max(9, Math.min(plan.fontPx, Math.round(cell * 0.6)))}px ${FONT}`;
    const every = cell >= 20 ? 1 : cell >= 14 ? 2 : 5;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let x = 0; x < cols; x++) {
      if ((x + 1) % every === 0 || x === 0) ctx.fillText(String(x + 1), gridX + x * cell + cell / 2, gridY / 2);
    }
    ctx.textAlign = 'right';
    for (let y = 0; y < rows; y++) {
      if ((y + 1) % every === 0 || y === 0) ctx.fillText(String(y + 1), gridX - 6, gridY + y * cell + cell / 2);
    }
  }

  // legend + footer
  if (plan.showLegend) {
    const e = config.export;
    const used = colors.filter((c) => c.count > 0);
    const padX = gridX > 0 && plan.showNumbers ? 12 : Math.max(12, gridX);
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    used.forEach((c, i) => {
      const col = i % plan.legendPerRow;
      const row = Math.floor(i / plan.legendPerRow);
      const x = padX + col * e.legendEntryW;
      const y = plan.legendY + row * e.legendEntryH;
      ctx.fillStyle = c.hex;
      ctx.fillRect(x, y + 4, 26, 26);
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 4.5, 25, 25);
      ctx.fillStyle = '#000000';
      ctx.font = `700 17px ${FONT}`;
      ctx.fillText(c.code, x + 34, y + 18);
      ctx.font = `15px ${FONT}`;
      const label = fit(ctx, `${c.name} · ${c.count}`, e.legendEntryW - 34 - 28 - 12);
      ctx.fillText(label, x + 34 + 28, y + 18);
    });
    ctx.fillStyle = '#555555';
    ctx.font = `14px ${FONT}`;
    ctx.fillText(
      `${data.paletteName} · ${cols} × ${rows} cells · ${data.date}`,
      padX,
      plan.legendY + plan.legendRows * e.legendEntryH + 16,
    );
  }
}
