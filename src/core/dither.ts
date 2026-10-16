import { config } from '../config';
import type { Matcher } from './match';

const BAYER4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

/** Floyd–Steinberg error diffusion in Lab with serpentine scanning. */
export function floydSteinberg(
  lab: Float32Array,
  cols: number,
  rows: number,
  matcher: Matcher,
  strength: number,
): Int16Array {
  const buf = Float32Array.from(lab);
  const out = new Int16Array(cols * rows);
  const k = Math.max(0, Math.min(1, strength));
  const clampE = config.dither.errorClamp;
  const clamp = (v: number) => (v < -clampE ? -clampE : v > clampE ? clampE : v);

  const spread = (x: number, y: number, e: number[], f: number) => {
    if (x < 0 || x >= cols || y >= rows) return;
    const o = (y * cols + x) * 3;
    buf[o] += e[0] * f;
    buf[o + 1] += e[1] * f;
    buf[o + 2] += e[2] * f;
  };

  for (let y = 0; y < rows; y++) {
    const ltr = y % 2 === 0;
    const dir = ltr ? 1 : -1;
    for (let s = 0; s < cols; s++) {
      const x = ltr ? s : cols - 1 - s;
      const o = (y * cols + x) * 3;
      const L = buf[o], a = buf[o + 1], b = buf[o + 2];
      const idx = matcher.nearestLab(L, a, b);
      out[y * cols + x] = idx;
      const p = matcher.lab(idx);
      const e = [clamp((L - p[0]) * k), clamp((a - p[1]) * k), clamp((b - p[2]) * k)];
      spread(x + dir, y, e, 7 / 16);
      spread(x - dir, y + 1, e, 3 / 16);
      spread(x, y + 1, e, 5 / 16);
      spread(x + dir, y + 1, e, 1 / 16);
    }
  }
  return out;
}

/** Ordered dithering with a 4x4 Bayer matrix applied to L*. */
export function orderedDither(
  lab: Float32Array,
  cols: number,
  rows: number,
  matcher: Matcher,
  strength: number,
): Int16Array {
  const out = new Int16Array(cols * rows);
  const amp = config.dither.orderedAmplitude * Math.max(0, Math.min(1, strength));
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const o = (y * cols + x) * 3;
      const offset = (BAYER4[y & 3][x & 3] / 16 - 0.46875) * amp;
      out[y * cols + x] = matcher.nearestLab(lab[o] + offset, lab[o + 1], lab[o + 2]);
    }
  }
  return out;
}
