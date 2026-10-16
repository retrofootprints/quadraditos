import { config } from '../config';
import { SRGB_TO_LINEAR, labToLch, lchToLab, linearRgbToLab, labToLinearRgb, linearToByte } from './color';
import { boxBlur } from './filters';
import type { AdjustParams, Lab } from './types';

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const smoothstep = (t: number) => t * t * (3 - 2 * t);

export function isIdentityAdjust(p: AdjustParams): boolean {
  return (
    p.brightness === 0 && p.contrast === 0 && p.saturation === 0 && p.hue === 0 && p.warmth === 0 &&
    p.midtones === 1 && p.blackPoint === p.outBlack && p.whitePoint === p.outWhite
  );
}

/**
 * Point operations in Lab/LCh, applied in the fixed order:
 * levels, midtones, brightness, contrast, warmth, hue, saturation.
 * (Detail is a local filter and is applied separately, first.)
 */
export function adjustLab(L: number, a: number, b: number, p: AdjustParams, out: Lab = [0, 0, 0]): Lab {
  // levels + midtones
  const span = Math.max(1e-6, p.whitePoint - p.blackPoint);
  let t = clamp((L - p.blackPoint) / span, 0, 1);
  if (p.midtones !== 1) t = Math.pow(t, 1 / p.midtones);
  L = p.outBlack + t * (p.outWhite - p.outBlack);

  // brightness
  L += p.brightness * config.adjust.brightnessScale;

  // contrast: blend toward (or away from) a smoothstep S-curve
  if (p.contrast !== 0) {
    const c = p.contrast / 100;
    const x = clamp(L / 100, 0, 1);
    L = 100 * (x + c * (smoothstep(x) - x));
  }
  L = clamp(L, 0, 100);

  // warmth
  if (p.warmth !== 0) {
    b += p.warmth * config.adjust.warmthB;
    a += p.warmth * config.adjust.warmthA;
  }

  // hue + saturation in LCh
  if (p.hue !== 0 || p.saturation !== 0) {
    const lch = labToLch(L, a, b);
    const c = Math.max(0, lch[1] * (1 + p.saturation / 100));
    const lab = lchToLab(L, c, lch[2] + p.hue);
    a = lab[1];
    b = lab[2];
  }
  out[0] = L;
  out[1] = a;
  out[2] = b;
  return out;
}

/** Unsharp mask on RGBA bytes (alpha untouched). Returns a new array. */
export function unsharp(data: Uint8ClampedArray, w: number, h: number, detail: number): Uint8ClampedArray {
  if (detail <= 0) return data;
  const radius = Math.max(1, Math.round(Math.min(w, h) / config.adjust.detailRadiusDivisor));
  const amount = (detail / 100) * config.adjust.detailAmount;
  const f = new Float32Array(w * h * 3);
  for (let i = 0, j = 0; i < data.length; i += 4, j += 3) {
    f[j] = data[i];
    f[j + 1] = data[i + 1];
    f[j + 2] = data[i + 2];
  }
  const blur = boxBlur(f, w, h, 3, radius);
  const out = new Uint8ClampedArray(data.length);
  for (let i = 0, j = 0; i < data.length; i += 4, j += 3) {
    out[i] = f[j] + amount * (f[j] - blur[j]);
    out[i + 1] = f[j + 1] + amount * (f[j + 1] - blur[j + 1]);
    out[i + 2] = f[j + 2] + amount * (f[j + 2] - blur[j + 2]);
    out[i + 3] = data[i + 3];
  }
  return out;
}

/** Per-pixel adjusted copy of an RGBA image (used for the "Adjusted" view). */
export function adjustImage(data: Uint8ClampedArray, p: AdjustParams): Uint8ClampedArray {
  const out = new Uint8ClampedArray(data.length);
  const lab: Lab = [0, 0, 0];
  const adj: Lab = [0, 0, 0];
  const rgb = [0, 0, 0];
  // memoise on the previous colour: photos have many runs of equal pixels
  let lr = -1, lg = -1, lb = -1;
  let or = 0, og = 0, ob = 0;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    if (r !== lr || g !== lg || b !== lb) {
      linearRgbToLab(SRGB_TO_LINEAR[r], SRGB_TO_LINEAR[g], SRGB_TO_LINEAR[b], lab);
      adjustLab(lab[0], lab[1], lab[2], p, adj);
      labToLinearRgb(adj[0], adj[1], adj[2], rgb);
      or = linearToByte(rgb[0]);
      og = linearToByte(rgb[1]);
      ob = linearToByte(rgb[2]);
      lr = r; lg = g; lb = b;
    }
    out[i] = or;
    out[i + 1] = og;
    out[i + 2] = ob;
    out[i + 3] = data[i + 3];
  }
  return out;
}

export interface PaletteRange {
  minL: number;
  maxL: number;
  maxC: number;
}

export function paletteRange(labs: ArrayLike<number>[]): PaletteRange {
  let minL = 100, maxL = 0, maxC = 0;
  for (const lab of labs) {
    minL = Math.min(minL, lab[0]);
    maxL = Math.max(maxL, lab[0]);
    maxC = Math.max(maxC, Math.hypot(lab[1], lab[2]));
  }
  return labs.length ? { minL, maxL, maxC } : { minL: 0, maxL: 100, maxC: 100 };
}

const percentile = (sorted: Float32Array, q: number) =>
  sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))];

/**
 * "Fit to palette": map the photo's L* range onto the palette's, add a gentle
 * contrast curve for narrow histograms, and scale chroma to the palette's reach.
 * `labs` is interleaved Lab of a sample of the photo.
 */
export function autoAdjust(labs: Float32Array, range: PaletteRange, base: AdjustParams): AdjustParams {
  const n = labs.length / 3;
  const out = { ...base };
  if (n === 0) return out;
  const Ls = new Float32Array(n);
  const Cs = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    Ls[i] = labs[i * 3];
    Cs[i] = Math.hypot(labs[i * 3 + 1], labs[i * 3 + 2]);
  }
  Ls.sort();
  Cs.sort();
  const a = config.adjust.auto;
  const lo = percentile(Ls, a.lowPercentile);
  const hi = percentile(Ls, a.highPercentile);
  const sb = config.adjust.blackPoint;
  const sw = config.adjust.whitePoint;
  out.blackPoint = clamp(lo, sb.min, sb.max);
  out.whitePoint = clamp(hi, sw.min, sw.max);
  if (out.whitePoint - out.blackPoint < 5) out.whitePoint = Math.min(100, out.blackPoint + 5);
  out.outBlack = range.minL;
  out.outWhite = Math.max(range.maxL, range.minL + 1);

  const spread = percentile(Ls, 0.95) - percentile(Ls, 0.05);
  out.contrast = spread < a.narrowRange ? a.contrastBoost : 0;

  const photoC = percentile(Cs, a.chromaPercentile);
  out.saturation = photoC > 1 ? Math.round(clamp((range.maxC / photoC - 1) * 100, -100, 100)) : 0;
  return out;
}
