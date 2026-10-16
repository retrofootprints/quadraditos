import { config } from '../config';
import { deltaE2000 } from './color';
import { erode } from './filters';
import type { Lab, SampleMode } from './types';

export interface RegionSample {
  lab: Lab;
  spread: number;
  areaPx: number;
  cx: number;
  cy: number;
  /** The eroded core of the region (empty when the region is too thin to have one). */
  core: number[];
}

/** Pixels of `pixels` that survive erosion by `radius`. Empty if the region is too thin. */
export function coreOf(pixels: ArrayLike<number>, w: number, radius: number): number[] {
  if (pixels.length === 0) return [];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < pixels.length; i++) {
    const x = pixels[i] % w;
    const y = (pixels[i] / w) | 0;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  const pad = radius + 1;
  const bw = x1 - x0 + 1 + 2 * pad;
  const bh = y1 - y0 + 1 + 2 * pad;
  const mask = new Uint8Array(bw * bh);
  for (let i = 0; i < pixels.length; i++) {
    mask[(((pixels[i] / w) | 0) - y0 + pad) * bw + (pixels[i] % w) - x0 + pad] = 1;
  }
  const eroded = erode(mask, bw, bh, radius);
  const out: number[] = [];
  for (let i = 0; i < pixels.length; i++) {
    if (eroded[(((pixels[i] / w) | 0) - y0 + pad) * bw + (pixels[i] % w) - x0 + pad]) out.push(pixels[i]);
  }
  return out;
}

function median(values: Float32Array): number {
  const s = values.slice().sort();
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Sample a region's colour from its eroded core: per-channel Lab median, keep the
 * `keepFrac` of pixels closest to it by ΔE, average those in Lab.
 * Masstone / tint first restrict to the darkest / lightest quarter by L*.
 */
export function sampleRegion(
  lab: Float32Array,
  pixels: ArrayLike<number>,
  w: number,
  coreRadius: number,
  mode: SampleMode = 'median',
): RegionSample {
  const core = coreOf(pixels, w, coreRadius);
  const used: ArrayLike<number> = core.length ? core : pixels;

  let sx = 0, sy = 0;
  for (let i = 0; i < pixels.length; i++) {
    sx += pixels[i] % w;
    sy += (pixels[i] / w) | 0;
  }
  const cx = sx / Math.max(1, pixels.length);
  const cy = sy / Math.max(1, pixels.length);

  let idx = Uint32Array.from(used as ArrayLike<number>);
  if (mode !== 'median' && idx.length > 4) {
    idx.sort((a, b) => lab[a * 3] - lab[b * 3]);
    const keep = Math.max(1, Math.round(idx.length * config.detect.sample.extremeFrac));
    idx = mode === 'masstone' ? idx.slice(0, keep) : idx.slice(idx.length - keep);
  }
  const n = idx.length;

  const ch = new Float32Array(n);
  const med: Lab = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    for (let k = 0; k < n; k++) ch[k] = lab[idx[k] * 3 + c];
    med[c] = median(ch);
  }
  const d = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    const i = idx[k] * 3;
    d[k] = deltaE2000(lab[i], lab[i + 1], lab[i + 2], med[0], med[1], med[2]);
  }
  const keepN = Math.max(1, Math.round(n * config.detect.sample.keepFrac));
  const limit = d.slice().sort()[keepN - 1];

  const mean: Lab = [0, 0, 0];
  let kept = 0;
  for (let k = 0; k < n && kept < keepN; k++) {
    if (d[k] > limit) continue;
    const i = idx[k] * 3;
    mean[0] += lab[i];
    mean[1] += lab[i + 1];
    mean[2] += lab[i + 2];
    kept++;
  }
  mean[0] /= kept;
  mean[1] /= kept;
  mean[2] /= kept;

  let ss = 0;
  let used2 = 0;
  for (let k = 0; k < n && used2 < kept; k++) {
    if (d[k] > limit) continue;
    const i = idx[k] * 3;
    const e = deltaE2000(lab[i], lab[i + 1], lab[i + 2], mean[0], mean[1], mean[2]);
    ss += e * e;
    used2++;
  }
  return { lab: mean, spread: Math.sqrt(ss / kept), areaPx: pixels.length, cx, cy, core };
}
