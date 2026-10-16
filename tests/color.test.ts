import { describe, expect, it } from 'vitest';
import { converter, differenceCiede2000 } from 'culori';
import {
  bytesToLab, deltaE2000, hexToLab, labToBytes, labToHex, labToLch, lchToLab, normaliseHex,
} from '../src/core/color';
import { codeForIndex, nearDuplicates, nextFreeCode, makeColor, reassignCodes } from '../src/core/palette';

const toLab = converter('lab65');
const de = differenceCiede2000();

describe('colour conversions', () => {
  it('matches culori for sRGB -> CIELAB (D65)', () => {
    for (const [r, g, b] of [[0, 0, 0], [255, 255, 255], [200, 30, 40], [20, 160, 90], [30, 60, 200], [128, 128, 128]]) {
      const ours = bytesToLab(r, g, b);
      const ref = toLab({ mode: 'rgb', r: r / 255, g: g / 255, b: b / 255 });
      expect(Math.abs(ours[0] - ref.l)).toBeLessThan(0.1);
      expect(Math.abs(ours[1] - ref.a)).toBeLessThan(0.15);
      expect(Math.abs(ours[2] - ref.b)).toBeLessThan(0.15);
    }
  });

  it('round-trips bytes through Lab', () => {
    for (let r = 0; r < 256; r += 51)
      for (let g = 0; g < 256; g += 51)
        for (let b = 0; b < 256; b += 51) {
          const lab = bytesToLab(r, g, b);
          expect(labToBytes(lab[0], lab[1], lab[2])).toEqual([r, g, b]);
        }
  });

  it('parses and formats hex', () => {
    expect(normaliseHex('#ABC')).toBe('#aabbcc');
    expect(normaliseHex('nope')).toBeNull();
    expect(labToHex(hexToLab('#3a4b7c')!)).toBe('#3a4b7c');
  });

  it('round-trips LCh', () => {
    const [L, c, h] = labToLch(50, -20, 30);
    const lab = lchToLab(L, c, h);
    expect(lab[1]).toBeCloseTo(-20, 6);
    expect(lab[2]).toBeCloseTo(30, 6);
  });
});

describe('ΔE2000', () => {
  // Sharma, Wu & Dalal (2005) reference pairs
  const pairs: [number[], number[], number][] = [
    [[50, 2.6772, -79.7751], [50, 0, -82.7485], 2.0425],
    [[50, 3.1571, -77.2803], [50, 0, -82.7485], 2.8615],
    [[50, 2.5, 0], [50, 0, -2.5], 4.3065],
    [[50, 0, 0], [50, -1, 2], 2.3669],
    [[60.2574, -34.0099, 36.2677], [60.4626, -34.1751, 39.4387], 1.2644],
    [[22.7233, 20.0904, -46.694], [23.0331, 14.973, -42.5619], 2.0373],
  ];
  it.each(pairs)('matches the published value %#', (a, b, expected) => {
    expect(deltaE2000(a[0], a[1], a[2], b[0], b[1], b[2])).toBeCloseTo(expected, 3);
  });

  it('agrees with culori', () => {
    const a = { mode: 'lab65' as const, l: 55, a: 30, b: -12 };
    const b = { mode: 'lab65' as const, l: 62, a: 24, b: -2 };
    expect(deltaE2000(a.l, a.a, a.b, b.l, b.a, b.b)).toBeCloseTo(de(a, b), 3);
  });

  it('is zero for identical colours and symmetric', () => {
    expect(deltaE2000(40, 10, 10, 40, 10, 10)).toBe(0);
    expect(deltaE2000(40, 10, 10, 55, -5, 20)).toBeCloseTo(deltaE2000(55, -5, 20, 40, 10, 10), 6);
  });

  it('kL > 1 de-emphasises lightness', () => {
    const base = deltaE2000(40, 10, 10, 55, 10, 10);
    expect(deltaE2000(40, 10, 10, 55, 10, 10, 2)).toBeLessThan(base);
  });
});

describe('palette helpers', () => {
  it('generates A..Z, AA..', () => {
    expect([0, 1, 25, 26, 27, 51, 52].map(codeForIndex)).toEqual(['A', 'B', 'Z', 'AA', 'AB', 'AZ', 'BA']);
  });

  it('assigns the next free code and re-letters with paper as a dot', () => {
    const a = makeColor('#ff0000', [])!;
    const b = makeColor('#00ff00', [a])!;
    expect([a.code, b.code]).toEqual(['A', 'B']);
    const paper = makeColor('#f4f1ea', [a, b], { isPaper: true })!;
    expect(paper.code).toBe('·');
    expect(nextFreeCode([a, b, paper])).toBe('C');
    expect(reassignCodes([paper, b, a]).map((c) => c.code)).toEqual(['·', 'A', 'B']);
  });

  it('flags colours closer than ΔE 3', () => {
    const a = makeColor('#808080', [])!;
    const b = makeColor('#818181', [a])!;
    const c = makeColor('#ff0000', [a, b])!;
    const dup = nearDuplicates([a, b, c]);
    expect(dup.has(a.id) && dup.has(b.id)).toBe(true);
    expect(dup.has(c.id)).toBe(false);
  });
});
