import { describe, expect, it } from 'vitest';
import { adjustLab, autoAdjust, isIdentityAdjust, paletteRange, unsharp } from '../src/core/adjust';
import { bytesToLab, hexToLab, SRGB_TO_LINEAR } from '../src/core/color';
import { simplify, minPatchSize } from '../src/core/cleanup';
import { floydSteinberg, orderedDither } from '../src/core/dither';
import { Matcher } from '../src/core/match';
import { cellsToLab, gridRows, pixelate } from '../src/core/pixelate';
import { matchCells } from '../src/core/pipeline';
import { defaultAdjust, type Lab } from '../src/core/types';
import { solid } from './helpers';

const lab = (hex: string) => hexToLab(hex)!;

describe('pixelate', () => {
  it('averages in linear light, not in sRGB', () => {
    // left half black, right half white, one cell
    const img = solid(2, 1, '#000000');
    img.data[4] = img.data[5] = img.data[6] = 255;
    const cells = pixelate(img, 1, 1, 'average');
    expect(cells[0]).toBeCloseTo(0.5, 5); // linear 0.5 == sRGB ~188, not 128
    expect(SRGB_TO_LINEAR[128]).toBeLessThan(0.25);
  });

  it('derives square rows from the aspect ratio', () => {
    expect(gridRows(1000, 1000, 50)).toBe(50);
    expect(gridRows(1000, 1500, 50)).toBe(75);
    expect(gridRows(1000, 10, 50)).toBe(1);
  });

  it('covers every pixel (no cell is empty even when the grid does not divide the image)', () => {
    const img = solid(103, 77, '#336699');
    const cells = pixelate(img, 10, 7, 'average');
    const first = cells[0];
    for (let i = 0; i < cells.length; i += 3) expect(cells[i]).toBeCloseTo(first, 5);
  });

  it('median and dominant ignore a minority of outliers', () => {
    const img = solid(10, 10, '#204080');
    for (let i = 0; i < 10; i++) { img.data[i * 4] = 255; img.data[i * 4 + 1] = 255; img.data[i * 4 + 2] = 255; }
    const avg = pixelate(img, 1, 1, 'average');
    const med = pixelate(img, 1, 1, 'median');
    const dom = pixelate(img, 1, 1, 'dominant');
    const base = SRGB_TO_LINEAR[0x20];
    expect(Math.abs(med[0] - base)).toBeLessThan(Math.abs(avg[0] - base));
    expect(Math.abs(dom[0] - base)).toBeLessThan(0.01);
  });
});

describe('Matcher', () => {
  const palette = [lab('#ffffff'), lab('#000000'), lab('#ff0000')];
  it('picks the nearest colour', () => {
    const m = new Matcher(palette, 'de2000', 1);
    expect(m.nearestLab(...lab('#fefefe'))).toBe(0);
    expect(m.nearestLab(...lab('#101010'))).toBe(1);
    expect(m.nearestLab(...lab('#e01010'))).toBe(2);
  });
  it('lookup table agrees with the exact search for representative colours', () => {
    const m = new Matcher(palette, 'de2000', 1);
    expect(m.nearestByte(250, 250, 250, bytesToLab)).toBe(0);
    expect(m.nearestByte(5, 5, 5, bytesToLab)).toBe(1);
    expect(m.nearestByte(230, 20, 20, bytesToLab)).toBe(2);
    expect(m.nearestByte(250, 250, 250, bytesToLab)).toBe(0); // cached path
  });
  it('supports the alternative metric', () => {
    const m = new Matcher(palette, 'de76', 1);
    expect(m.nearestLab(...lab('#fefefe'))).toBe(0);
  });
});

describe('adjust', () => {
  it('default parameters are the identity', () => {
    const p = defaultAdjust();
    expect(isIdentityAdjust(p)).toBe(true);
    const out = adjustLab(55, 20, -10, p);
    expect(out[0]).toBeCloseTo(55, 9);
    expect(out[1]).toBeCloseTo(20, 9);
    expect(out[2]).toBeCloseTo(-10, 9);
  });
  it('brightness raises L, saturation scales chroma, hue rotates', () => {
    const p = { ...defaultAdjust(), brightness: 20 };
    expect(adjustLab(50, 0, 0, p)[0]).toBeGreaterThan(55);
    const s = adjustLab(50, 20, 0, { ...defaultAdjust(), saturation: 50 });
    expect(Math.hypot(s[1], s[2])).toBeCloseTo(30, 5);
    const h = adjustLab(50, 20, 0, { ...defaultAdjust(), hue: 90 });
    expect(h[1]).toBeCloseTo(0, 5);
    expect(h[2]).toBeCloseTo(20, 5);
  });
  it('contrast pushes darks darker and lights lighter', () => {
    const p = { ...defaultAdjust(), contrast: 60 };
    expect(adjustLab(25, 0, 0, p)[0]).toBeLessThan(25);
    expect(adjustLab(75, 0, 0, p)[0]).toBeGreaterThan(75);
    expect(adjustLab(50, 0, 0, p)[0]).toBeCloseTo(50, 5);
  });
  it('fit-to-palette maps photo extremes onto the palette range', () => {
    const labs = new Float32Array(300);
    for (let i = 0; i < 100; i++) { labs[i * 3] = 10 + (i * 80) / 99; labs[i * 3 + 1] = 10; labs[i * 3 + 2] = 5; }
    const range = paletteRange([[20, 0, 0], [90, 30, 40]]);
    const p = autoAdjust(labs, range, defaultAdjust());
    const dark = adjustLab(10, 0, 0, p)[0];
    const light = adjustLab(90, 0, 0, p)[0];
    expect(dark).toBeCloseTo(20, 0);
    expect(light).toBeCloseTo(90, 0);
  });
  it('unsharp leaves flat areas alone and sharpens edges', () => {
    const flat = solid(8, 8, '#808080').data;
    expect(Array.from(unsharp(flat, 8, 8, 100).slice(0, 8))).toEqual(Array.from(flat.slice(0, 8)));
    const edge = solid(8, 8, '#404040');
    for (let y = 0; y < 8; y++) for (let x = 4; x < 8; x++) edge.data[(y * 8 + x) * 4] = 200;
    const sharp = unsharp(edge.data, 8, 8, 100);
    expect(sharp[(4 * 8 + 4) * 4]).toBeGreaterThanOrEqual(200);
    expect(sharp[(4 * 8 + 3) * 4]).toBeLessThanOrEqual(64);
  });
});

describe('dither', () => {
  const bw: Lab[] = [lab('#ffffff'), lab('#000000')];
  const grey = (n: number, L: number) => {
    const a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) a[i * 3] = L;
    return a;
  };
  it('Floyd–Steinberg reproduces mid-grey as a mix of both colours', () => {
    const m = new Matcher(bw, 'de2000', 1);
    const out = floydSteinberg(grey(400, 53), 20, 20, m, 1);
    const whites = out.filter((v) => v === 0).length;
    expect(whites).toBeGreaterThan(120);
    expect(whites).toBeLessThan(280);
  });
  it('strength 0 diffuses nothing', () => {
    const m = new Matcher(bw, 'de2000', 1);
    const out = floydSteinberg(grey(100, 53), 10, 10, m, 0);
    expect(new Set(out).size).toBe(1);
  });
  it('ordered dithering is a regular, repeatable pattern', () => {
    const m = new Matcher(bw, 'de2000', 1);
    const a = orderedDither(grey(64, 53), 8, 8, m, 1);
    const b = orderedDither(grey(64, 53), 8, 8, m, 1);
    expect(Array.from(a)).toEqual(Array.from(b));
    expect(a[0]).toBe(a[4]); // period 4
    expect(new Set(a).size).toBe(2);
  });
});

describe('cleanup', () => {
  const m = new Matcher([lab('#ffffff'), lab('#000000'), lab('#808080')], 'de2000', 1);
  it('simplify removes an isolated cell', () => {
    const idx = new Int16Array(25).fill(0);
    idx[12] = 1;
    const out = simplify(idx, 5, 5, 1, m);
    expect(out[12]).toBe(0);
  });
  it('simplify keeps a cell that has two like neighbours', () => {
    const idx = new Int16Array(25).fill(0);
    idx[12] = 1; idx[13] = 1; idx[14] = 1;
    expect(simplify(idx, 5, 5, 1, m)[13]).toBe(1);
  });
  it('minimum patch size recolours small patches with the nearest adjacent colour', () => {
    const idx = new Int16Array(36).fill(0);
    for (let y = 0; y < 6; y++) for (let x = 3; x < 6; x++) idx[y * 6 + x] = 1; // right half black
    idx[7] = 2; idx[8] = 2; // 2-cell grey patch inside the white half (neighbours: white; black at x=3)
    const out = minPatchSize(idx, 6, 6, 3, m);
    expect(out[7]).not.toBe(2);
    expect(out[8]).not.toBe(2);
    expect(minPatchSize(idx, 6, 6, 1, m)).toBe(idx);
  });
});

describe('matchCells', () => {
  it('runs the whole chain and respects the palette', () => {
    const img = solid(40, 40, '#d03030');
    const linear = pixelate(img, 4, 4);
    const palette = [lab('#ffffff'), lab('#000000'), lab('#cc2222'), lab('#2222cc')];
    const res = matchCells({
      linear, cols: 4, rows: 4, palette, adjust: defaultAdjust(), metric: 'de2000', valuePriority: 1,
      ditherMode: 'off', ditherStrength: 50, simplify: 0, minPatch: 1,
    });
    expect(Array.from(res.indices)).toEqual(new Array(16).fill(2));
    expect(cellsToLab(linear).length).toBe(48);
  });
  it('higher value priority keeps lightness over hue', () => {
    // a mid-dark saturated blue: with a dark grey and a light blue to choose from
    const target = lab('#3040a0');
    const palette = [lab('#303030'), lab('#a0b0ff')];
    const linearOf = (l: Lab) => {
      // reuse pixelate on a solid image of the same colour
      return l;
    };
    void linearOf;
    const img = solid(4, 4, '#3040a0');
    const linear = pixelate(img, 1, 1);
    const run = (vp: number) =>
      matchCells({
        linear, cols: 1, rows: 1, palette, adjust: defaultAdjust(), metric: 'de2000', valuePriority: vp,
        ditherMode: 'off', ditherStrength: 0, simplify: 0, minPatch: 1,
      }).indices[0];
    expect(target[0]).toBeLessThan(40);
    expect(run(2)).toBe(0); // dark grey keeps the value
  });
});
