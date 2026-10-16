import { adjustLab, isIdentityAdjust } from './adjust';
import { bytesToLab, labToLinearRgb, linearToByte } from './color';
import { simplify, minPatchSize } from './cleanup';
import { floydSteinberg, orderedDither } from './dither';
import { Matcher } from './match';
import { cellsToLab } from './pixelate';
import type { AdjustParams, DitherMode, Lab, Metric } from './types';

export interface MatchInput {
  /** Cell colours in linear RGB (3 floats per cell). */
  linear: Float32Array;
  cols: number;
  rows: number;
  palette: Lab[];
  adjust: AdjustParams;
  metric: Metric;
  valuePriority: number;
  ditherMode: DitherMode;
  ditherStrength: number; // 0..100
  simplify: number;
  minPatch: number;
}

export interface MatchResult {
  indices: Int16Array;
  /** Adjusted cell colours, Lab. */
  adjustedLab: Float32Array;
}

/** Adjust → match (→ dither) → cleanup, on the small cell grid. */
export function matchCells(input: MatchInput): MatchResult {
  const { cols, rows } = input;
  const lab = cellsToLab(input.linear);
  if (!isIdentityAdjust(input.adjust)) {
    const tmp: Lab = [0, 0, 0];
    for (let i = 0; i < lab.length; i += 3) {
      adjustLab(lab[i], lab[i + 1], lab[i + 2], input.adjust, tmp);
      lab[i] = tmp[0];
      lab[i + 1] = tmp[1];
      lab[i + 2] = tmp[2];
    }
  }
  // Value priority is a lightness *weight*; ΔE's kL divides the lightness term, so kL = 1 / priority.
  const matcher = new Matcher(input.palette, input.metric, 1 / Math.max(0.01, input.valuePriority));
  let indices: Int16Array;
  const strength = input.ditherStrength / 100;
  if (input.ditherMode === 'floyd') {
    indices = floydSteinberg(lab, cols, rows, matcher, strength);
  } else if (input.ditherMode === 'ordered') {
    indices = orderedDither(lab, cols, rows, matcher, strength);
  } else {
    indices = new Int16Array(cols * rows);
    const rgb = [0, 0, 0];
    for (let i = 0; i < indices.length; i++) {
      labToLinearRgb(lab[i * 3], lab[i * 3 + 1], lab[i * 3 + 2], rgb);
      indices[i] = matcher.nearestByte(linearToByte(rgb[0]), linearToByte(rgb[1]), linearToByte(rgb[2]), bytesToLab);
    }
  }
  if (input.simplify > 0) indices = simplify(indices, cols, rows, input.simplify, matcher);
  if (input.minPatch > 1) indices = minPatchSize(indices, cols, rows, input.minPatch, matcher);
  return { indices, adjustedLab: lab };
}

export function countIndices(indices: Int16Array, n: number): number[] {
  const counts = new Array<number>(n).fill(0);
  for (let i = 0; i < indices.length; i++) counts[indices[i]]++;
  return counts;
}
