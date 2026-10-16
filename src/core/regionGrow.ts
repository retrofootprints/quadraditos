import { deltaE2000 } from './color';

export interface GrowResult {
  pixels: Int32Array;
  /** True when growth stopped at the area cap. */
  capped: boolean;
}

/**
 * Region-grow from a seed on the blurred Lab image. A 4-connected neighbour joins
 * when its ΔE to the region's running mean is below `tolerance` and it is
 * foreground (when a foreground mask is given). Stops at `maxFrac` of the image.
 */
export function regionGrow(
  blurLab: Float32Array,
  fg: Uint8Array | null,
  w: number,
  h: number,
  sx: number,
  sy: number,
  tolerance: number,
  maxFrac: number,
): GrowResult {
  const seed = Math.min(h - 1, Math.max(0, Math.round(sy))) * w + Math.min(w - 1, Math.max(0, Math.round(sx)));
  const maxCount = Math.max(1, Math.floor(w * h * maxFrac));
  const seen = new Uint8Array(w * h);
  const queue: number[] = [seed];
  seen[seed] = 1;
  let mL = blurLab[seed * 3], mA = blurLab[seed * 3 + 1], mB = blurLab[seed * 3 + 2];
  let count = 1;
  let capped = false;
  const accepted: number[] = [seed];

  for (let q = 0; q < queue.length; q++) {
    const p = queue[q];
    const x = p % w;
    const y = (p / w) | 0;
    const tryAdd = (n: number) => {
      if (seen[n]) return;
      seen[n] = 1;
      if (fg && !fg[n]) return;
      const L = blurLab[n * 3], a = blurLab[n * 3 + 1], b = blurLab[n * 3 + 2];
      if (deltaE2000(L, a, b, mL, mA, mB) >= tolerance) return;
      accepted.push(n);
      queue.push(n);
      count++;
      mL += (L - mL) / count;
      mA += (a - mA) / count;
      mB += (b - mB) / count;
    };
    if (x > 0) tryAdd(p - 1);
    if (x < w - 1) tryAdd(p + 1);
    if (y > 0) tryAdd(p - w);
    if (y < h - 1) tryAdd(p + w);
    if (count >= maxCount) {
      capped = true;
      break;
    }
  }
  return { pixels: Int32Array.from(accepted), capped };
}
