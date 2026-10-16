import { describe, expect, it } from 'vitest';
import { cropAspect, cropRect, effectiveCols } from '../src/core/crop';
import { defaultCrop, defaultStudio } from '../src/core/types';

describe('crop', () => {
  it('original at zoom 1 is a no-op', () => {
    expect(cropRect(defaultCrop(), 1500, 1000)).toBeNull();
  });

  it('1:1 on a landscape photo is the full height, centred', () => {
    const r = cropRect({ ...defaultCrop(), preset: '1:1' }, 1500, 1000)!;
    expect(r.h).toBeCloseTo(1, 6);
    expect(r.w).toBeCloseTo(1000 / 1500, 6);
    expect(r.x).toBeCloseTo((1 - r.w) / 2, 6);
  });

  it('keeps the window inside the image when the centre is near an edge', () => {
    const r = cropRect({ ...defaultCrop(), preset: '4:5', zoom: 2, cx: 0.02, cy: 0.99 }, 1000, 1000)!;
    expect(r.x).toBeGreaterThanOrEqual(0);
    expect(r.y + r.h).toBeLessThanOrEqual(1 + 1e-9);
    expect((r.w * 1000) / (r.h * 1000)).toBeCloseTo(0.8, 6);
  });

  it('landscape flips the fixed ratios and A-series is 1:√2', () => {
    const c = { ...defaultCrop(), preset: 'a' as const };
    expect(cropAspect(c, 1, 1)).toBeCloseTo(1 / Math.SQRT2, 6);
    expect(cropAspect({ ...c, landscape: true }, 1, 1)).toBeCloseTo(Math.SQRT2, 6);
  });

  it('custom physical size gives its aspect', () => {
    expect(cropAspect({ ...defaultCrop(), preset: 'custom', customW: 30, customH: 40 }, 1, 1)).toBeCloseTo(0.75, 6);
  });
});

describe('effectiveCols', () => {
  it('uses the slider unless physical mode is on', () => {
    const s = defaultStudio();
    expect(effectiveCols(s)).toBe(48);
    expect(effectiveCols({ ...s, physicalMode: true, canvasWidthCm: 30, cellMm: 5 })).toBe(60);
    expect(effectiveCols({ ...s, physicalMode: true, canvasWidthCm: 1000, cellMm: 1 })).toBe(200);
    expect(effectiveCols({ ...s, physicalMode: true, canvasWidthCm: 1, cellMm: 50 })).toBe(8);
  });
});
