import { bytesToHex, hexToBytes } from '../src/core/color';

/** Deterministic PRNG (mulberry32). */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Img {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export function solid(width: number, height: number, hex: string): Img {
  const [r, g, b] = hexToBytes(hex)!;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = 255;
  }
  return { data, width, height };
}

export interface SheetOptions {
  paper?: string;
  blobs: { x: number; y: number; r: number; hex: string }[];
  noise?: number;
  /** Thin dark strokes standing in for handwritten labels. */
  strokes?: { x0: number; y0: number; x1: number; y1: number; width: number }[];
  seed?: number;
}

/** A synthetic swatch sheet: round blobs on paper with texture noise and thin strokes. */
export function makeSheet(width: number, height: number, o: SheetOptions): Img {
  const img = solid(width, height, o.paper ?? '#f4f1ea');
  const rand = rng(o.seed ?? 1);
  const put = (x: number, y: number, hex: string) => {
    const [r, g, b] = hexToBytes(hex)!;
    const i = (y * width + x) * 4;
    img.data[i] = r;
    img.data[i + 1] = g;
    img.data[i + 2] = b;
  };
  for (const b of o.blobs) {
    for (let y = Math.max(0, b.y - b.r); y <= Math.min(height - 1, b.y + b.r); y++) {
      for (let x = Math.max(0, b.x - b.r); x <= Math.min(width - 1, b.x + b.r); x++) {
        if ((x - b.x) ** 2 + (y - b.y) ** 2 <= b.r * b.r) put(x, y, b.hex);
      }
    }
  }
  for (const s of o.strokes ?? []) {
    const steps = Math.ceil(Math.hypot(s.x1 - s.x0, s.y1 - s.y0));
    for (let t = 0; t <= steps; t++) {
      const cx = Math.round(s.x0 + ((s.x1 - s.x0) * t) / steps);
      const cy = Math.round(s.y0 + ((s.y1 - s.y0) * t) / steps);
      for (let dy = -s.width; dy <= s.width; dy++)
        for (let dx = -s.width; dx <= s.width; dx++) {
          const x = cx + dx, y = cy + dy;
          if (x >= 0 && y >= 0 && x < width && y < height) put(x, y, '#2a2a2a');
        }
    }
  }
  const noise = o.noise ?? 0;
  if (noise > 0) {
    for (let i = 0; i < width * height; i++) {
      const n = (rand() - 0.5) * 2 * noise;
      for (let c = 0; c < 3; c++) img.data[i * 4 + c] = Math.max(0, Math.min(255, img.data[i * 4 + c] + n));
    }
  }
  return img;
}

export const hex = bytesToHex;
