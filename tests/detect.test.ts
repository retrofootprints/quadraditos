import { describe, expect, it } from 'vitest';
import { deltaE2000, hexToLab } from '../src/core/color';
import {
  defaultDetectParams, detectBlobs, estimatePaper, makeBlob, prepareSheet, readingOrder, splitTwo,
} from '../src/core/detect';
import { boxBlur, connectedComponents, dilate, erode } from '../src/core/filters';
import { regionGrow } from '../src/core/regionGrow';
import { sampleRegion } from '../src/core/sample';
import { makeSheet } from './helpers';

const COLOURS = [
  '#c0392b', '#e67e22', '#f1c40f', '#27ae60', '#16a085', '#2980b9',
  '#8e44ad', '#2c3e50', '#a0522d', '#7f8c8d', '#e84393', '#6d4c41',
];

function sheet12(opts: { paper?: string; noise?: number } = {}) {
  const w = 1024, h = 768;
  const blobs = COLOURS.map((hex, i) => ({ x: 130 + (i % 4) * 255, y: 120 + Math.floor(i / 4) * 250, r: 55, hex }));
  const strokes = [];
  // handwritten-looking labels under each blob: thin strokes, a squiggle
  for (const b of blobs) {
    strokes.push({ x0: b.x - 40, y0: b.y + 80, x1: b.x - 10, y1: b.y + 95, width: 2 });
    strokes.push({ x0: b.x - 10, y0: b.y + 95, x1: b.x + 30, y1: b.y + 78, width: 2 });
  }
  return { img: makeSheet(w, h, { blobs, strokes, noise: opts.noise ?? 3, paper: opts.paper, seed: 7 }), blobs, w, h };
}

describe('filters', () => {
  it('erode/dilate are inverses on a solid square (away from the border)', () => {
    const w = 20, h = 20;
    const m = new Uint8Array(w * h);
    for (let y = 5; y < 15; y++) for (let x = 5; x < 15; x++) m[y * w + x] = 1;
    const e = erode(m, w, h, 2);
    expect(e.reduce((a, b) => a + b, 0)).toBe(36);
    const d = dilate(e, w, h, 2);
    expect(Array.from(d)).toEqual(Array.from(m));
  });
  it('erosion does not eat blobs at the image border', () => {
    const w = 10, h = 10;
    const m = new Uint8Array(w * h).fill(1);
    expect(erode(m, w, h, 2).every((v) => v === 1)).toBe(true);
  });
  it('labels 8-connected components', () => {
    const w = 6, h = 4;
    const m = new Uint8Array(w * h);
    m[0] = 1; m[w + 1] = 1; // diagonal -> one component
    m[w * 3 + 5] = 1; // another
    const c = connectedComponents(m, w, h);
    expect(c.count).toBe(2);
    expect(c.areas[1]).toBe(2);
  });
  it('box blur preserves a constant image', () => {
    const f = new Float32Array(5 * 5 * 3).fill(7);
    expect(boxBlur(f, 5, 5, 3, 2).every((v) => Math.abs(v - 7) < 1e-5)).toBe(true);
  });
});

describe('paper', () => {
  it('estimates the border colour', () => {
    const { img, w, h } = sheet12({ paper: '#d8c8a0' });
    const s = prepareSheet(img.data, w, h, { whiteBalance: false });
    expect(deltaE2000(...s.paperLab, ...hexToLab('#d8c8a0')!)).toBeLessThan(2);
    expect(estimatePaper(s.lab, w, h)).toEqual(s.paperLab);
  });
  it('white balance makes warm paper neutral', () => {
    const { img, w, h } = sheet12({ paper: '#f0d8a8' });
    const s = prepareSheet(img.data, w, h, { whiteBalance: true });
    expect(Math.hypot(s.paperLab[1], s.paperLab[2])).toBeLessThan(3);
  });
  it('a tap re-samples the paper', () => {
    const { img, w, h } = sheet12();
    const s = prepareSheet(img.data, w, h, { whiteBalance: false, paperAt: [510, 5] });
    expect(deltaE2000(...s.paperLab, ...hexToLab('#f4f1ea')!)).toBeLessThan(2);
  });
});

describe('auto-detect (12 blobs on white paper with handwritten labels)', () => {
  it('finds all 12 with no false positives and recovers colours within ΔE 2', () => {
    const { img, w, h, blobs } = sheet12();
    const s = prepareSheet(img.data, w, h, { whiteBalance: false });
    const t0 = performance.now();
    const res = detectBlobs(s, defaultDetectParams());
    const ms = performance.now() - t0;
    expect(res.blobs).toHaveLength(12);
    // reading order matches the generation order (rows then columns)
    res.blobs.forEach((b, i) => {
      expect(Math.hypot(b.cx - blobs[i].x, b.cy - blobs[i].y)).toBeLessThan(4);
      const truth = hexToLab(COLOURS[i])!;
      expect(deltaE2000(b.lab[0], b.lab[1], b.lab[2], truth[0], truth[1], truth[2])).toBeLessThan(2);
      expect(b.spread).toBeLessThan(5);
    });
    console.info(`detect: ${ms.toFixed(0)} ms (node, 1024x768)`);
  });

  it('works on tinted paper too', () => {
    const { img, w, h } = sheet12({ paper: '#c9b48c' });
    const s = prepareSheet(img.data, w, h, { whiteBalance: false });
    expect(detectBlobs(s, defaultDetectParams()).blobs.length).toBe(12);
  });

  it('splits two touching blobs of different colours', () => {
    const w = 400, h = 300;
    const img = makeSheet(w, h, {
      blobs: [
        { x: 150, y: 150, r: 60, hex: '#c0392b' },
        { x: 250, y: 150, r: 60, hex: '#2980b9' },
      ],
      noise: 2,
    });
    const s = prepareSheet(img.data, w, h, { whiteBalance: false });
    const on = detectBlobs(s, defaultDetectParams());
    expect(on.blobs).toHaveLength(2);
    const off = detectBlobs(s, { ...defaultDetectParams(), split: false });
    expect(off.blobs).toHaveLength(1);
  });

  it('ignores specks and thin lines', () => {
    const w = 300, h = 200;
    const img = makeSheet(w, h, {
      blobs: [{ x: 5, y: 5, r: 3, hex: '#000000' }],
      strokes: [{ x0: 20, y0: 100, x1: 280, y1: 120, width: 2 }],
    });
    const s = prepareSheet(img.data, w, h, { whiteBalance: false });
    expect(detectBlobs(s, defaultDetectParams()).blobs).toHaveLength(0);
  });
});

describe('region grow and sampling', () => {
  const { img, w, h } = sheet12();
  const s = prepareSheet(img.data, w, h, { whiteBalance: false });

  it('tap-to-add grows to the blob outline', () => {
    const g = regionGrow(s.blur, null, w, h, 130, 120, 8, 0.25);
    const expected = Math.PI * 55 * 55;
    expect(g.pixels.length).toBeGreaterThan(expected * 0.9);
    expect(g.pixels.length).toBeLessThan(expected * 1.15);
    expect(g.capped).toBe(false);
  });

  it('stops at the area cap', () => {
    const g = regionGrow(s.blur, null, w, h, 5, 5, 25, 0.05);
    expect(g.capped).toBe(true);
    expect(g.pixels.length).toBeLessThan(w * h * 0.06);
  });

  it('samples a trimmed mean, not the edge', () => {
    const g = regionGrow(s.blur, null, w, h, 130, 120, 8, 0.25);
    const r = sampleRegion(s.lab, g.pixels, w, 4, 'median');
    const truth = hexToLab(COLOURS[0])!;
    expect(deltaE2000(...r.lab, ...truth)).toBeLessThan(2);
  });

  it('masstone is darker and tint lighter than median in a graded wash', () => {
    const wash = makeSheet(200, 100, { blobs: [] });
    const px: number[] = [];
    for (let y = 20; y < 80; y++) for (let x = 20; x < 180; x++) {
      const t = (x - 20) / 160;
      const v = Math.round(60 + t * 120);
      const i = (y * 200 + x) * 4;
      wash.data[i] = v; wash.data[i + 1] = v; wash.data[i + 2] = v + 40;
      px.push(y * 200 + x);
    }
    const sh = prepareSheet(wash.data, 200, 100, { whiteBalance: false });
    const med = sampleRegion(sh.lab, px, 200, 4, 'median').lab[0];
    const dark = sampleRegion(sh.lab, px, 200, 4, 'masstone').lab[0];
    const light = sampleRegion(sh.lab, px, 200, 4, 'tint').lab[0];
    expect(dark).toBeLessThan(med - 5);
    expect(light).toBeGreaterThan(med + 5);
  });

  it('makeBlob returns a seed inside the region', () => {
    const g = regionGrow(s.blur, null, w, h, 130, 120, 8, 0.25);
    const b = makeBlob(s, g.pixels, 'median', { coreRadius: 4 });
    expect(Math.hypot(b.seed[0] - 130, b.seed[1] - 120)).toBeLessThan(10);
  });

  it('splitTwo returns null for a uniform region', () => {
    const g = regionGrow(s.blur, null, w, h, 130, 120, 8, 0.25);
    expect(splitTwo(s.blur, g.pixels)).toBeNull();
  });
});

describe('readingOrder', () => {
  it('sorts rows top to bottom, then left to right', () => {
    const mk = (cx: number, cy: number) => ({ cx, cy, areaPx: 3000 });
    const out = readingOrder([mk(300, 105), mk(100, 100), mk(200, 98), mk(100, 400), mk(250, 395)]);
    expect(out.map((b) => [b.cx, b.cy])).toEqual([[100, 100], [200, 98], [300, 105], [100, 400], [250, 395]]);
  });
});

describe('bold lettering', () => {
  it('is not mistaken for swatches (holes fill on closing, leaving a paper-coloured core)', () => {
    const w = 400, h = 300;
    // a chunky "B"-like glyph: thick vertical bar, two thick bowls with small counters
    const img = makeSheet(w, h, {
      blobs: [{ x: 100, y: 150, r: 50, hex: '#c0392b' }],
      strokes: [
        { x0: 250, y0: 100, x1: 250, y1: 200, width: 7 },
        { x0: 250, y0: 100, x1: 290, y1: 100, width: 7 },
        { x0: 290, y0: 100, x1: 290, y1: 150, width: 7 },
        { x0: 250, y0: 150, x1: 290, y1: 150, width: 7 },
        { x0: 290, y0: 150, x1: 290, y1: 200, width: 7 },
        { x0: 250, y0: 200, x1: 290, y1: 200, width: 7 },
      ],
    });
    const s = prepareSheet(img.data, w, h, { whiteBalance: false });
    const res = detectBlobs(s, defaultDetectParams());
    expect(res.blobs.every((b) => deltaE2000(...b.lab, ...s.paperLab) > 12)).toBe(true);
    const nearGlyph = res.blobs.filter((b) => b.cx > 200);
    // the glyph's strokes are solid dark ink, but it must never yield a paper-coloured "swatch"
    expect(nearGlyph.every((b) => b.lab[0] < 60)).toBe(true);
    expect(res.blobs.some((b) => Math.hypot(b.cx - 100, b.cy - 150) < 5)).toBe(true);
  });
});
