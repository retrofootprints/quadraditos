import { config } from '../config';
import { makeDistance, type DistanceFn } from './color';
import type { Metric } from './types';

/**
 * Nearest-palette-colour search. The metric is chosen in color.ts (makeDistance);
 * a lazily filled lookup table keyed by quantised sRGB caches byte-colour matches.
 */
export class Matcher {
  readonly n: number;
  private readonly labs: Float64Array;
  private readonly dist: DistanceFn;
  private readonly lut: Int16Array;
  private readonly bits = config.match.lutBits;

  constructor(palette: ArrayLike<number>[], metric: Metric, kL = 1) {
    this.n = palette.length;
    this.labs = new Float64Array(this.n * 3);
    palette.forEach((c, i) => {
      this.labs[i * 3] = c[0];
      this.labs[i * 3 + 1] = c[1];
      this.labs[i * 3 + 2] = c[2];
    });
    this.dist = makeDistance(metric, kL);
    this.lut = new Int16Array(1 << (this.bits * 3)).fill(-1);
  }

  lab(i: number): [number, number, number] {
    return [this.labs[i * 3], this.labs[i * 3 + 1], this.labs[i * 3 + 2]];
  }

  distanceTo(i: number, L: number, a: number, b: number): number {
    return this.dist(L, a, b, this.labs[i * 3], this.labs[i * 3 + 1], this.labs[i * 3 + 2]);
  }

  nearestLab(L: number, a: number, b: number): number {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < this.n; i++) {
      const d = this.dist(L, a, b, this.labs[i * 3], this.labs[i * 3 + 1], this.labs[i * 3 + 2]);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  /** Match an sRGB byte colour through the 6-bit lookup table. */
  nearestByte(r: number, g: number, b: number, labOf: (r: number, g: number, b: number) => [number, number, number]): number {
    const s = 8 - this.bits;
    const key = ((r >> s) << (this.bits * 2)) | ((g >> s) << this.bits) | (b >> s);
    let v = this.lut[key];
    if (v < 0) {
      const half = (1 << s) >> 1;
      const lab = labOf(((r >> s) << s) | half, ((g >> s) << s) | half, ((b >> s) << s) | half);
      v = this.nearestLab(lab[0], lab[1], lab[2]);
      this.lut[key] = v;
    }
    return v;
  }
}
