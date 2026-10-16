import { config } from '../config';
import {
  SRGB_TO_LINEAR, deltaE2000, labToLinearRgb, linearRgbToLab,
} from './color';
import { boxBlur, connectedComponents, erode, morphClose, morphOpen } from './filters';
import { sampleRegion, type RegionSample } from './sample';
import type { Lab, SampleMode } from './types';

export interface SheetData {
  w: number;
  h: number;
  /** Lab of the (optionally white-balanced) image. */
  lab: Float32Array;
  /** Box-blurred Lab, used for detection and region growing. */
  blur: Float32Array;
  paperLab: Lab;
}

export interface DetectParams {
  fgThreshold: number;
  minAreaFrac: number;
  coreRadius: number;
  openRadius: number;
  closeRadius: number;
  split: boolean;
}

export const defaultDetectParams = (): DetectParams => ({
  fgThreshold: config.detect.fgThreshold.default,
  minAreaFrac: config.detect.minAreaFrac,
  coreRadius: config.detect.coreRadius,
  openRadius: config.detect.openRadius,
  closeRadius: config.detect.closeRadius,
  split: config.detect.split.enabled,
});

/** A detected or hand-grown swatch region. Coordinates are in detection-image pixels. */
export interface Blob {
  pixels: Int32Array;
  seed: [number, number];
  cx: number;
  cy: number;
  areaPx: number;
  lab: Lab;
  spread: number;
  mode: SampleMode;
  manual?: boolean;
}

export interface DetectResult {
  blobs: Blob[];
  /** Foreground mask after open/close, for the debug panel. */
  fg: Uint8Array;
  core: Uint8Array;
}

// ---------- paper ----------

/** Most common colour in a coarse Lab histogram of the outer border of the image. */
export function estimatePaper(lab: Float32Array, w: number, h: number, borderFrac = config.detect.paperBorderFrac): Lab {
  const bx = Math.max(1, Math.round(w * borderFrac));
  const by = Math.max(1, Math.round(h * borderFrac));
  const { lStep, abStep } = config.detect.paperHist;
  const bins = new Map<number, { n: number; L: number; a: number; b: number }>();
  for (let y = 0; y < h; y++) {
    const edgeY = y < by || y >= h - by;
    for (let x = 0; x < w; x++) {
      if (!edgeY && x >= bx && x < w - bx) {
        x = w - bx - 1; // jump across the interior
        continue;
      }
      const i = (y * w + x) * 3;
      const key =
        (Math.floor(lab[i] / lStep) + 2) * 1_000_000 +
        (Math.floor(lab[i + 1] / abStep) + 200) * 1000 +
        (Math.floor(lab[i + 2] / abStep) + 200);
      let e = bins.get(key);
      if (!e) bins.set(key, (e = { n: 0, L: 0, a: 0, b: 0 }));
      e.n++;
      e.L += lab[i];
      e.a += lab[i + 1];
      e.b += lab[i + 2];
    }
  }
  let best: { n: number; L: number; a: number; b: number } | null = null;
  for (const e of bins.values()) if (!best || e.n > best.n) best = e;
  return best ? [best.L / best.n, best.a / best.n, best.b / best.n] : [95, 0, 0];
}

/** Median Lab inside a disc, e.g. around a "tap bare paper" point. */
export function sampleDisc(lab: Float32Array, w: number, h: number, cx: number, cy: number, radius: number): Lab {
  const Ls: number[] = [], As: number[] = [], Bs: number[] = [];
  const r2 = radius * radius;
  for (let y = Math.max(0, Math.floor(cy - radius)); y <= Math.min(h - 1, Math.ceil(cy + radius)); y++) {
    for (let x = Math.max(0, Math.floor(cx - radius)); x <= Math.min(w - 1, Math.ceil(cx + radius)); x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 > r2) continue;
      const i = (y * w + x) * 3;
      Ls.push(lab[i]); As.push(lab[i + 1]); Bs.push(lab[i + 2]);
    }
  }
  const med = (v: number[]) => {
    v.sort((p, q) => p - q);
    return v.length ? v[v.length >> 1] : 0;
  };
  return [med(Ls), med(As), med(Bs)];
}

function rgbaToLab(data: Uint8ClampedArray, n: number, gains?: [number, number, number]): Float32Array {
  const lab = new Float32Array(n * 3);
  let lr = -1, lg = -1, lb = -1;
  let L = 0, A = 0, B = 0;
  const out = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
    if (r !== lr || g !== lg || b !== lb) {
      let R = SRGB_TO_LINEAR[r], G = SRGB_TO_LINEAR[g], Bc = SRGB_TO_LINEAR[b];
      if (gains) {
        R = Math.min(1, R * gains[0]);
        G = Math.min(1, G * gains[1]);
        Bc = Math.min(1, Bc * gains[2]);
      }
      linearRgbToLab(R, G, Bc, out);
      L = out[0]; A = out[1]; B = out[2];
      lr = r; lg = g; lb = b;
    }
    lab[i * 3] = L;
    lab[i * 3 + 1] = A;
    lab[i * 3 + 2] = B;
  }
  return lab;
}

export interface PrepareOptions {
  whiteBalance: boolean;
  /** Tapped paper position (detection-image pixels). Auto-estimated when absent. */
  paperAt?: [number, number];
  blurRadius?: number;
}

/** Convert the sheet to Lab, find the paper colour, optionally white-balance, blur. */
export function prepareSheet(rgba: Uint8ClampedArray, w: number, h: number, opts: PrepareOptions): SheetData {
  const n = w * h;
  let lab = rgbaToLab(rgba, n);
  const pick = (l: Float32Array): Lab =>
    opts.paperAt
      ? sampleDisc(l, w, h, opts.paperAt[0], opts.paperAt[1], config.detect.paperTapRadius)
      : estimatePaper(l, w, h);
  let paper = pick(lab);

  if (opts.whiteBalance) {
    const lin = [0, 0, 0];
    labToLinearRgb(paper[0], paper[1], paper[2], lin);
    const target = 0.2126729 * lin[0] + 0.7151522 * lin[1] + 0.072175 * lin[2];
    const gains: [number, number, number] = [
      lin[0] > 1e-4 ? target / lin[0] : 1,
      lin[1] > 1e-4 ? target / lin[1] : 1,
      lin[2] > 1e-4 ? target / lin[2] : 1,
    ];
    lab = rgbaToLab(rgba, n, gains);
    paper = pick(lab);
  }
  const blur = boxBlur(lab, w, h, 3, opts.blurRadius ?? config.detect.blurRadius);
  return { w, h, lab, blur, paperLab: paper };
}

// ---------- detection ----------

export function foregroundMask(blur: Float32Array, n: number, paper: Lab, threshold: number): Uint8Array {
  const mask = new Uint8Array(n);
  const pL = paper[0], pA = paper[1], pB = paper[2];
  // ΔE76 is a cheap bound on ΔE2000 (within a factor ~2 either way): decide the easy pixels without it.
  const lo2 = (threshold * 0.4) ** 2;
  const hi2 = (threshold * 3) ** 2;
  for (let i = 0; i < n; i++) {
    const L = blur[i * 3], a = blur[i * 3 + 1], b = blur[i * 3 + 2];
    const d2 = (L - pL) ** 2 + (a - pA) ** 2 + (b - pB) ** 2;
    if (d2 < lo2) continue;
    mask[i] = d2 > hi2 || deltaE2000(L, a, b, pL, pA, pB) > threshold ? 1 : 0;
  }
  return mask;
}

interface Cluster {
  pixels: number[];
}

/** k-means (k=2) in Lab over the given pixels. Returns null if the split criteria fail. */
export function splitTwo(lab: Float32Array, pixels: ArrayLike<number>): [number[], number[]] | null {
  const n = pixels.length;
  if (n < 8) return null;
  const sc = config.detect.split;
  const get = (p: number): Lab => [lab[p * 3], lab[p * 3 + 1], lab[p * 3 + 2]];
  const mean: Lab = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    const v = get(pixels[i]);
    mean[0] += v[0]; mean[1] += v[1]; mean[2] += v[2];
  }
  mean[0] /= n; mean[1] /= n; mean[2] /= n;
  const far = (from: Lab) => {
    let best = pixels[0], bd = -1;
    for (let i = 0; i < n; i++) {
      const v = get(pixels[i]);
      const d = (v[0] - from[0]) ** 2 + (v[1] - from[1]) ** 2 + (v[2] - from[2]) ** 2;
      if (d > bd) { bd = d; best = pixels[i]; }
    }
    return get(best);
  };
  let c1 = far(mean);
  let c2 = far(c1);
  const assign = new Uint8Array(n);
  for (let it = 0; it < sc.iterations; it++) {
    const s1: Lab = [0, 0, 0], s2: Lab = [0, 0, 0];
    let n1 = 0, n2 = 0;
    for (let i = 0; i < n; i++) {
      const v = get(pixels[i]);
      const d1 = (v[0] - c1[0]) ** 2 + (v[1] - c1[1]) ** 2 + (v[2] - c1[2]) ** 2;
      const d2 = (v[0] - c2[0]) ** 2 + (v[1] - c2[1]) ** 2 + (v[2] - c2[2]) ** 2;
      if (d1 <= d2) { assign[i] = 0; s1[0] += v[0]; s1[1] += v[1]; s1[2] += v[2]; n1++; }
      else { assign[i] = 1; s2[0] += v[0]; s2[1] += v[1]; s2[2] += v[2]; n2++; }
    }
    if (n1 === 0 || n2 === 0) return null;
    c1 = [s1[0] / n1, s1[1] / n1, s1[2] / n1];
    c2 = [s2[0] / n2, s2[1] / n2, s2[2] / n2];
  }
  const a: number[] = [], b: number[] = [];
  for (let i = 0; i < n; i++) (assign[i] ? b : a).push(pixels[i]);
  if (a.length < n * sc.minClusterFrac || b.length < n * sc.minClusterFrac) return null;
  if (deltaE2000(c1[0], c1[1], c1[2], c2[0], c2[1], c2[2]) <= sc.minCentroidDeltaE) return null;
  return [a, b];
}

/** Closest region pixel to the centroid that lies in the core, used as the grow seed. */
function pickSeed(pixels: ArrayLike<number>, core: number[], w: number, cx: number, cy: number): [number, number] {
  const pool = core.length ? core : Array.from(pixels);
  let best = pool[0], bd = Infinity;
  for (const p of pool) {
    const d = ((p % w) - cx) ** 2 + (((p / w) | 0) - cy) ** 2;
    if (d < bd) { bd = d; best = p; }
  }
  return [best % w, (best / w) | 0];
}

export function makeBlob(
  sheet: SheetData,
  pixels: ArrayLike<number>,
  mode: SampleMode,
  params: Pick<DetectParams, 'coreRadius'>,
  manual = false,
  sample?: RegionSample,
): Blob {
  const s = sample ?? sampleRegion(sheet.lab, pixels, sheet.w, params.coreRadius, mode);
  return {
    pixels: Int32Array.from(pixels),
    seed: pickSeed(pixels, s.core, sheet.w, s.cx, s.cy),
    cx: s.cx, cy: s.cy, areaPx: s.areaPx, lab: s.lab, spread: s.spread, mode, manual,
  };
}

export function detectBlobs(sheet: SheetData, params: DetectParams): DetectResult {
  const { w, h } = sheet;
  const n = w * h;
  let fg = foregroundMask(sheet.blur, n, sheet.paperLab, params.fgThreshold);
  const opened = morphOpen(fg, w, h, params.openRadius);
  fg = morphClose(opened, w, h, params.closeRadius);
  const core = erode(fg, w, h, params.coreRadius);

  const comps = connectedComponents(fg, w, h);
  const minArea = params.minAreaFrac * n;
  const hasCore = new Uint8Array(comps.count + 1);
  const rawArea = new Int32Array(comps.count + 1);
  for (let i = 0; i < n; i++) {
    const l = comps.labels[i];
    if (!l) continue;
    if (core[i]) hasCore[l] = 1;
    if (opened[i]) rawArea[l]++;
  }

  const lists: Cluster[] = [];
  const slot = new Int32Array(comps.count + 1).fill(-1);
  for (let l = 1; l <= comps.count; l++) {
    if (comps.areas[l] >= minArea && hasCore[l] && rawArea[l] >= config.detect.minSolidity * comps.areas[l]) {
      slot[l] = lists.length;
      lists.push({ pixels: [] });
    }
  }
  for (let i = 0; i < n; i++) {
    const l = comps.labels[i];
    if (l && slot[l] >= 0) lists[slot[l]].pixels.push(i);
  }

  const blobs: Blob[] = [];
  const sc = config.detect.split;
  const differsFromPaper = (lab: Lab) =>
    deltaE2000(lab[0], lab[1], lab[2], sheet.paperLab[0], sheet.paperLab[1], sheet.paperLab[2]) > params.fgThreshold;
  for (const { pixels } of lists) {
    const base = sampleRegion(sheet.lab, pixels, w, params.coreRadius, 'median');
    if (params.split && base.spread > sc.spreadThreshold) {
      const two = splitTwo(sheet.blur, pixels);
      if (two) {
        for (const part of two) {
          const b = makeBlob(sheet, part, 'median', params);
          if (differsFromPaper(b.lab)) blobs.push(b);
        }
        continue;
      }
    }
    // a swatch has to look like paint: a region whose colour is the paper's is lettering with its holes filled
    if (differsFromPaper(base.lab)) blobs.push(makeBlob(sheet, pixels, 'median', params, false, base));
  }
  return { blobs: readingOrder(blobs), fg, core };
}

/** Sort top-to-bottom rows, then left-to-right inside each row. */
export function readingOrder<T extends { cx: number; cy: number; areaPx: number }>(blobs: T[]): T[] {
  if (blobs.length < 2) return blobs.slice();
  const diam = blobs.map((b) => 2 * Math.sqrt(b.areaPx / Math.PI)).sort((a, b) => a - b);
  const rowTol = 0.6 * diam[diam.length >> 1];
  const byY = blobs.slice().sort((a, b) => a.cy - b.cy);
  const rows: T[][] = [];
  let rowStart = -Infinity;
  for (const b of byY) {
    if (rows.length === 0 || b.cy - rowStart > rowTol) {
      rows.push([b]);
      rowStart = b.cy;
    } else rows[rows.length - 1].push(b);
  }
  return rows.flatMap((r) => r.sort((a, b) => a.cx - b.cx));
}
