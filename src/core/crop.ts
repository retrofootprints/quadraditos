import { config } from '../config';
import type { CropState, StudioSettings } from './types';

export interface NormRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Width / height of the crop window for a preset (portrait orientation for the fixed ratios). */
export function cropAspect(crop: CropState, imgW: number, imgH: number): number {
  let a: number;
  switch (crop.preset) {
    case '1:1': return 1;
    case '4:5': a = 4 / 5; break;
    case '3:4': a = 3 / 4; break;
    case '2:3': a = 2 / 3; break;
    case 'a': a = 1 / Math.SQRT2; break;
    case 'custom': return Math.max(0.05, crop.customW) / Math.max(0.05, crop.customH);
    case 'original':
    default: return imgW / imgH;
  }
  return crop.landscape ? 1 / a : a;
}

/**
 * The crop window as a normalised rectangle of the source image: the largest window of the
 * chosen aspect, shrunk by `zoom`, centred at (cx, cy) and kept inside the image.
 * Returns null when the crop is a no-op (whole image).
 */
export function cropRect(crop: CropState, imgW: number, imgH: number): NormRect | null {
  const aspect = cropAspect(crop, imgW, imgH);
  let w = imgW;
  let h = imgW / aspect;
  if (h > imgH) {
    h = imgH;
    w = imgH * aspect;
  }
  const z = Math.max(1, crop.zoom);
  w /= z;
  h /= z;
  const nw = w / imgW;
  const nh = h / imgH;
  const x = Math.min(1 - nw, Math.max(0, crop.cx - nw / 2));
  const y = Math.min(1 - nh, Math.max(0, crop.cy - nh / 2));
  if (nw > 0.9999 && nh > 0.9999) return null;
  return { x, y, w: nw, h: nh };
}

/** Columns for the grid: from the slider, or from physical canvas width and cell size. */
export function effectiveCols(s: Pick<StudioSettings, 'cols' | 'physicalMode' | 'canvasWidthCm' | 'cellMm'>): number {
  if (!s.physicalMode) return s.cols;
  const cols = Math.round((s.canvasWidthCm * 10) / Math.max(0.1, s.cellMm));
  return Math.max(config.grid.min, Math.min(config.grid.max, cols));
}
