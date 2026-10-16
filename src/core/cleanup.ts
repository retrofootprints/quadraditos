import type { Matcher } from './match';

const NEIGHBOURS8: [number, number][] = [
  [-1, -1], [0, -1], [1, -1],
  [-1, 0], [1, 0],
  [-1, 1], [0, 1], [1, 1],
];

/** Palette-to-palette distance, in the matcher's metric. */
function paletteDistance(m: Matcher, i: number, j: number): number {
  const l = m.lab(j);
  return m.distanceTo(i, l[0], l[1], l[2]);
}

/**
 * Majority filter. A cell that agrees with fewer than two of its 8 neighbours
 * takes the most common neighbour colour; ties go to the colour nearest in ΔE.
 */
export function simplify(indices: Int16Array, cols: number, rows: number, passes: number, matcher: Matcher): Int16Array {
  let cur = indices.slice();
  const counts = new Map<number, number>();
  for (let p = 0; p < passes; p++) {
    const next = cur.slice();
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const me = cur[y * cols + x];
        counts.clear();
        let same = 0;
        for (const [dx, dy] of NEIGHBOURS8) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
          const c = cur[ny * cols + nx];
          if (c === me) same++;
          counts.set(c, (counts.get(c) ?? 0) + 1);
        }
        if (same >= 2) continue;
        let best = me;
        let bestN = -1;
        let bestD = Infinity;
        for (const [c, n] of counts) {
          if (c === me) continue;
          const d = paletteDistance(matcher, me, c);
          if (n > bestN || (n === bestN && d < bestD)) {
            best = c;
            bestN = n;
            bestD = d;
          }
        }
        next[y * cols + x] = best;
      }
    }
    cur = next;
  }
  return cur;
}

/**
 * Recolour every 4-connected same-colour patch smaller than `minSize` with the
 * adjacent patch colour nearest in ΔE. Repeats until stable (bounded).
 */
export function minPatchSize(indices: Int16Array, cols: number, rows: number, minSize: number, matcher: Matcher): Int16Array {
  if (minSize <= 1) return indices;
  const out = indices.slice();
  const n = cols * rows;
  for (let iter = 0; iter < 8; iter++) {
    const patchOf = new Int32Array(n).fill(-1);
    const patches: number[][] = [];
    for (let s = 0; s < n; s++) {
      if (patchOf[s] >= 0) continue;
      const id = patches.length;
      const cells = [s];
      patchOf[s] = id;
      for (let q = 0; q < cells.length; q++) {
        const c = cells[q];
        const x = c % cols, y = (c / cols) | 0;
        if (x > 0 && patchOf[c - 1] < 0 && out[c - 1] === out[s]) { patchOf[c - 1] = id; cells.push(c - 1); }
        if (x < cols - 1 && patchOf[c + 1] < 0 && out[c + 1] === out[s]) { patchOf[c + 1] = id; cells.push(c + 1); }
        if (y > 0 && patchOf[c - cols] < 0 && out[c - cols] === out[s]) { patchOf[c - cols] = id; cells.push(c - cols); }
        if (y < rows - 1 && patchOf[c + cols] < 0 && out[c + cols] === out[s]) { patchOf[c + cols] = id; cells.push(c + cols); }
      }
      patches.push(cells);
    }
    const small = patches.filter((p) => p.length < minSize).sort((a, b) => a.length - b.length);
    if (small.length === 0) break;
    let changed = false;
    for (const cells of small) {
      const me = out[cells[0]];
      // the patch may have grown or merged since labelling; skip if no longer small
      const adj = new Set<number>();
      for (const c of cells) {
        const x = c % cols, y = (c / cols) | 0;
        if (x > 0 && out[c - 1] !== me) adj.add(out[c - 1]);
        if (x < cols - 1 && out[c + 1] !== me) adj.add(out[c + 1]);
        if (y > 0 && out[c - cols] !== me) adj.add(out[c - cols]);
        if (y < rows - 1 && out[c + cols] !== me) adj.add(out[c + cols]);
      }
      if (adj.size === 0) continue;
      let best = -1;
      let bestD = Infinity;
      for (const c of adj) {
        const d = paletteDistance(matcher, me, c);
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
      for (const c of cells) out[c] = best;
      changed = true;
    }
    if (!changed) break;
  }
  return out;
}
