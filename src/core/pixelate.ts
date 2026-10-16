import { config } from '../config';
import { SRGB_TO_LINEAR, linearRgbToLab } from './color';
import type { CellMode } from './types';

export interface RGBAImage {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/** Rows for square cells: cell width is w/cols, cell height ≈ the same. */
export function gridRows(width: number, height: number, cols: number): number {
  return Math.max(1, Math.round(height / (width / cols)));
}

/** Cell bounds that partition the image exactly (no pixel is dropped). */
function bounds(size: number, n: number): Int32Array {
  const b = new Int32Array(n + 1);
  for (let i = 0; i <= n; i++) b[i] = Math.round((i * size) / n);
  for (let i = 1; i <= n; i++) if (b[i] <= b[i - 1]) b[i] = Math.min(size, b[i - 1] + 1);
  return b;
}

/** Reduce each cell to one colour. Returns linear RGB, 3 floats per cell. */
export function pixelate(img: RGBAImage, cols: number, rows: number, mode: CellMode = 'average'): Float32Array {
  const { data, width: w, height: h } = img;
  const xs = bounds(w, cols);
  const ys = bounds(h, rows);
  const out = new Float32Array(cols * rows * 3);
  const L = SRGB_TO_LINEAR;

  const hist = mode === 'median' ? new Uint32Array(768) : null;
  const bits = config.match.dominantBits;
  const bins = 1 << (bits * 3);
  const counts = mode === 'dominant' ? new Uint32Array(bins) : null;
  const shift = 8 - bits;

  for (let cy = 0; cy < rows; cy++) {
    const y0 = ys[cy];
    const y1 = Math.min(h, ys[cy + 1]);
    for (let cx = 0; cx < cols; cx++) {
      const x0 = xs[cx];
      const x1 = Math.min(w, xs[cx + 1]);
      const o = (cy * cols + cx) * 3;
      const n = Math.max(1, (y1 - y0) * (x1 - x0));

      if (mode === 'average') {
        let r = 0, g = 0, b = 0;
        for (let y = y0; y < y1; y++) {
          let i = (y * w + x0) * 4;
          for (let x = x0; x < x1; x++, i += 4) {
            r += L[data[i]];
            g += L[data[i + 1]];
            b += L[data[i + 2]];
          }
        }
        out[o] = r / n;
        out[o + 1] = g / n;
        out[o + 2] = b / n;
      } else if (hist) {
        hist.fill(0);
        for (let y = y0; y < y1; y++) {
          let i = (y * w + x0) * 4;
          for (let x = x0; x < x1; x++, i += 4) {
            hist[data[i]]++;
            hist[256 + data[i + 1]]++;
            hist[512 + data[i + 2]]++;
          }
        }
        for (let c = 0; c < 3; c++) {
          let acc = 0;
          let v = 0;
          for (; v < 255; v++) {
            acc += hist[c * 256 + v];
            if (acc * 2 >= n) break;
          }
          out[o + c] = L[v];
        }
      } else if (counts) {
        counts.fill(0);
        const key = (i: number) =>
          ((data[i] >> shift) << (bits * 2)) | ((data[i + 1] >> shift) << bits) | (data[i + 2] >> shift);
        for (let y = y0; y < y1; y++) {
          let i = (y * w + x0) * 4;
          for (let x = x0; x < x1; x++, i += 4) counts[key(i)]++;
        }
        let best = 0;
        let bestN = -1;
        for (let k = 0; k < bins; k++) {
          if (counts[k] > bestN) {
            bestN = counts[k];
            best = k;
          }
        }
        let r = 0, g = 0, b = 0, m = 0;
        for (let y = y0; y < y1; y++) {
          let i = (y * w + x0) * 4;
          for (let x = x0; x < x1; x++, i += 4) {
            if (key(i) === best) {
              r += L[data[i]];
              g += L[data[i + 1]];
              b += L[data[i + 2]];
              m++;
            }
          }
        }
        out[o] = r / m;
        out[o + 1] = g / m;
        out[o + 2] = b / m;
      }
    }
  }
  return out;
}

export function cellsToLab(linear: Float32Array): Float32Array {
  const n = linear.length / 3;
  const lab = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) linearRgbToLab(linear[i * 3], linear[i * 3 + 1], linear[i * 3 + 2], lab, i * 3);
  return lab;
}
