import { formatHex, parse } from 'culori';
import type { Lab, Metric } from './types';

// ---------- sRGB <-> linear ----------

export const SRGB_TO_LINEAR = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  SRGB_TO_LINEAR[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function linearToSrgb(l: number): number {
  const v = l <= 0.0031308 ? l * 12.92 : 1.055 * Math.pow(l, 1 / 2.4) - 0.055;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function linearToByte(l: number): number {
  return Math.round(linearToSrgb(l) * 255);
}

// ---------- linear RGB <-> CIELAB (D65) ----------

const XN = 0.95047;
const YN = 1;
const ZN = 1.08883;
const EPS = 216 / 24389;
const KAPPA = 24389 / 27;

const fwd = (t: number) => (t > EPS ? Math.cbrt(t) : (KAPPA * t + 16) / 116);
const inv = (f: number) => {
  const f3 = f * f * f;
  return f3 > EPS ? f3 : (116 * f - 16) / KAPPA;
};

export function linearRgbToLab(r: number, g: number, b: number, out: { [i: number]: number }, o = 0): void {
  const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / XN;
  const y = (0.2126729 * r + 0.7151522 * g + 0.072175 * b) / YN;
  const z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / ZN;
  const fx = fwd(x);
  const fy = fwd(y);
  const fz = fwd(z);
  out[o] = 116 * fy - 16;
  out[o + 1] = 500 * (fx - fy);
  out[o + 2] = 200 * (fy - fz);
}

/** Lab -> linear RGB (unclamped, may leave [0,1] for out-of-gamut colours). */
export function labToLinearRgb(L: number, a: number, b: number, out: { [i: number]: number }, o = 0): void {
  const fy = (L + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - b / 200;
  const x = inv(fx) * XN;
  const y = (L > KAPPA * EPS ? fy * fy * fy : L / KAPPA) * YN;
  const z = inv(fz) * ZN;
  out[o] = 3.2404542 * x - 1.5371385 * y - 0.4985314 * z;
  out[o + 1] = -0.969266 * x + 1.8760108 * y + 0.041556 * z;
  out[o + 2] = 0.0556434 * x - 0.2040259 * y + 1.0572252 * z;
}

export function bytesToLab(r: number, g: number, b: number): Lab {
  const out: Lab = [0, 0, 0];
  linearRgbToLab(SRGB_TO_LINEAR[r], SRGB_TO_LINEAR[g], SRGB_TO_LINEAR[b], out);
  return out;
}

const tmp = [0, 0, 0];
export function labToBytes(L: number, a: number, b: number): [number, number, number] {
  labToLinearRgb(L, a, b, tmp);
  return [linearToByte(tmp[0]), linearToByte(tmp[1]), linearToByte(tmp[2])];
}

// ---------- hex ----------

export function hexToBytes(hex: string): [number, number, number] | null {
  const c = parse(hex);
  if (!c) return null;
  const h = formatHex(c);
  if (!h) return null;
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
}

export function hexToLab(hex: string): Lab | null {
  const b = hexToBytes(hex);
  return b ? bytesToLab(b[0], b[1], b[2]) : null;
}

export function bytesToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
}

export function labToHex(lab: ArrayLike<number>): string {
  const [r, g, b] = labToBytes(lab[0], lab[1], lab[2]);
  return bytesToHex(r, g, b);
}

export function normaliseHex(input: string): string | null {
  const b = hexToBytes(input.trim());
  return b ? bytesToHex(b[0], b[1], b[2]) : null;
}

// ---------- LCh ----------

export function labToLch(L: number, a: number, b: number): [number, number, number] {
  const c = Math.hypot(a, b);
  let h = (Math.atan2(b, a) * 180) / Math.PI;
  if (h < 0) h += 360;
  return [L, c, h];
}

export function lchToLab(L: number, c: number, h: number): Lab {
  const r = (h * Math.PI) / 180;
  return [L, c * Math.cos(r), c * Math.sin(r)];
}

// ---------- distance ----------

const POW25_7 = Math.pow(25, 7);
const D2R = Math.PI / 180;

export function deltaE2000(
  L1: number, a1: number, b1: number,
  L2: number, a2: number, b2: number,
  kL = 1, kC = 1, kH = 1,
): number {
  const C1 = Math.hypot(a1, b1);
  const C2 = Math.hypot(a2, b2);
  const Cbar = (C1 + C2) / 2;
  const Cbar7 = Math.pow(Cbar, 7);
  const G = 0.5 * (1 - Math.sqrt(Cbar7 / (Cbar7 + POW25_7)));
  const a1p = (1 + G) * a1;
  const a2p = (1 + G) * a2;
  const C1p = Math.hypot(a1p, b1);
  const C2p = Math.hypot(a2p, b2);
  let h1p = Math.atan2(b1, a1p) / D2R;
  if (h1p < 0) h1p += 360;
  let h2p = Math.atan2(b2, a2p) / D2R;
  if (h2p < 0) h2p += 360;

  const dLp = L2 - L1;
  const dCp = C2p - C1p;
  const cc = C1p * C2p;
  let dhp = 0;
  if (cc !== 0) {
    dhp = h2p - h1p;
    if (dhp > 180) dhp -= 360;
    else if (dhp < -180) dhp += 360;
  }
  const dHp = 2 * Math.sqrt(cc) * Math.sin((dhp * D2R) / 2);

  const Lbarp = (L1 + L2) / 2;
  const Cbarp = (C1p + C2p) / 2;
  let hbarp: number;
  if (cc === 0) hbarp = h1p + h2p;
  else if (Math.abs(h1p - h2p) <= 180) hbarp = (h1p + h2p) / 2;
  else hbarp = h1p + h2p < 360 ? (h1p + h2p + 360) / 2 : (h1p + h2p - 360) / 2;

  const T =
    1 -
    0.17 * Math.cos((hbarp - 30) * D2R) +
    0.24 * Math.cos(2 * hbarp * D2R) +
    0.32 * Math.cos((3 * hbarp + 6) * D2R) -
    0.2 * Math.cos((4 * hbarp - 63) * D2R);
  const dTheta = 30 * Math.exp(-(((hbarp - 275) / 25) ** 2));
  const Cbarp7 = Math.pow(Cbarp, 7);
  const Rc = 2 * Math.sqrt(Cbarp7 / (Cbarp7 + POW25_7));
  const Lm = (Lbarp - 50) ** 2;
  const Sl = 1 + (0.015 * Lm) / Math.sqrt(20 + Lm);
  const Sc = 1 + 0.045 * Cbarp;
  const Sh = 1 + 0.015 * Cbarp * T;
  const Rt = -Math.sin(2 * dTheta * D2R) * Rc;

  const tl = dLp / (kL * Sl);
  const tc = dCp / (kC * Sc);
  const th = dHp / (kH * Sh);
  return Math.sqrt(tl * tl + tc * tc + th * th + Rt * tc * th);
}

export function deltaE76(L1: number, a1: number, b1: number, L2: number, a2: number, b2: number, kL = 1): number {
  const dl = (L1 - L2) / kL;
  return Math.sqrt(dl * dl + (a1 - a2) ** 2 + (b1 - b2) ** 2);
}

export type DistanceFn = (L1: number, a1: number, b1: number, L2: number, a2: number, b2: number) => number;

/** The one place the metric is chosen. Add new metrics here. */
export function makeDistance(metric: Metric, kL = 1): DistanceFn {
  switch (metric) {
    case 'de76':
      return (L1, a1, b1, L2, a2, b2) => deltaE76(L1, a1, b1, L2, a2, b2, kL);
    case 'de2000':
    default:
      return (L1, a1, b1, L2, a2, b2) => deltaE2000(L1, a1, b1, L2, a2, b2, kL);
  }
}

export function labDelta(a: ArrayLike<number>, b: ArrayLike<number>): number {
  return deltaE2000(a[0], a[1], a[2], b[0], b[1], b[2]);
}
