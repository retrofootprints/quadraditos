/** Separable box blur on interleaved float data. Edges are clamped (replicated). */
export function boxBlur(src: Float32Array, w: number, h: number, channels: number, radius: number): Float32Array {
  if (radius <= 0) return src.slice();
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  const win = 2 * radius + 1;
  // horizontal
  for (let y = 0; y < h; y++) {
    for (let c = 0; c < channels; c++) {
      const row = y * w * channels + c;
      let sum = 0;
      for (let k = -radius; k <= radius; k++) sum += src[row + Math.min(w - 1, Math.max(0, k)) * channels];
      for (let x = 0; x < w; x++) {
        tmp[row + x * channels] = sum / win;
        const add = Math.min(w - 1, x + radius + 1);
        const sub = Math.max(0, x - radius);
        sum += src[row + add * channels] - src[row + sub * channels];
      }
    }
  }
  // vertical
  const stride = w * channels;
  for (let x = 0; x < w; x++) {
    for (let c = 0; c < channels; c++) {
      const col = x * channels + c;
      let sum = 0;
      for (let k = -radius; k <= radius; k++) sum += tmp[col + Math.min(h - 1, Math.max(0, k)) * stride];
      for (let y = 0; y < h; y++) {
        out[col + y * stride] = sum / win;
        const add = Math.min(h - 1, y + radius + 1);
        const sub = Math.max(0, y - radius);
        sum += tmp[col + add * stride] - tmp[col + sub * stride];
      }
    }
  }
  return out;
}

/** Number of set pixels in the (in-bounds) square window of radius r around every pixel. */
function windowCount(mask: Uint8Array, w: number, h: number, r: number): Uint8Array {
  const tmp = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let c = 0;
    for (let x = 0; x <= Math.min(r, w - 1); x++) c += mask[row + x];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = c;
      const add = x + r + 1;
      const sub = x - r;
      if (add < w) c += mask[row + add];
      if (sub >= 0) c -= mask[row + sub];
    }
  }
  const count = new Uint8Array(w * h);
  for (let x = 0; x < w; x++) {
    let c = 0;
    for (let y = 0; y <= Math.min(r, h - 1); y++) c += tmp[y * w + x];
    for (let y = 0; y < h; y++) {
      count[y * w + x] = c;
      const add = y + r + 1;
      const sub = y - r;
      if (add < h) c += tmp[add * w + x];
      if (sub >= 0) c -= tmp[sub * w + x];
    }
  }
  return count;
}

/** A pixel survives only if its whole (in-bounds) window is set. */
export function erode(mask: Uint8Array, w: number, h: number, r: number): Uint8Array {
  if (r <= 0) return mask.slice();
  const count = windowCount(mask, w, h, r);
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const vy = Math.min(h - 1, y + r) - Math.max(0, y - r) + 1;
    for (let x = 0; x < w; x++) {
      const hx = Math.min(w - 1, x + r) - Math.max(0, x - r) + 1;
      out[y * w + x] = count[y * w + x] === hx * vy ? 1 : 0;
    }
  }
  return out;
}

export function dilate(mask: Uint8Array, w: number, h: number, r: number): Uint8Array {
  if (r <= 0) return mask.slice();
  const count = windowCount(mask, w, h, r);
  const out = new Uint8Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = count[i] > 0 ? 1 : 0;
  return out;
}

export const morphOpen = (m: Uint8Array, w: number, h: number, r: number) => dilate(erode(m, w, h, r), w, h, r);
export const morphClose = (m: Uint8Array, w: number, h: number, r: number) => erode(dilate(m, w, h, r), w, h, r);

export interface Components {
  labels: Int32Array; // 0 = background, 1..count
  count: number;
  areas: Int32Array; // index = label
}

/** 8-connected component labelling with union-find. */
export function connectedComponents(mask: Uint8Array, w: number, h: number): Components {
  const parent: number[] = [0];
  const find = (a: number): number => {
    while (parent[a] !== a) {
      parent[a] = parent[parent[a]];
      a = parent[a];
    }
    return a;
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) {
      if (ra < rb) parent[rb] = ra;
      else parent[ra] = rb;
    }
  };
  const labels = new Int32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!mask[i]) continue;
      let lab = 0;
      const n0 = x > 0 ? labels[i - 1] : 0;
      const n1 = y > 0 && x > 0 ? labels[i - w - 1] : 0;
      const n2 = y > 0 ? labels[i - w] : 0;
      const n3 = y > 0 && x < w - 1 ? labels[i - w + 1] : 0;
      for (const n of [n0, n1, n2, n3]) {
        if (n === 0) continue;
        if (lab === 0) lab = n;
        else union(lab, n);
      }
      if (lab === 0) {
        lab = parent.length;
        parent.push(lab);
      }
      labels[i] = lab;
    }
  }
  const remap = new Int32Array(parent.length);
  let count = 0;
  for (let l = 1; l < parent.length; l++) {
    const r = find(l);
    if (remap[r] === 0) remap[r] = ++count;
    remap[l] = remap[r];
  }
  const areas = new Int32Array(count + 1);
  for (let i = 0; i < labels.length; i++) {
    if (labels[i]) {
      labels[i] = remap[labels[i]];
      areas[labels[i]]++;
    }
  }
  return { labels, count, areas };
}
