import { describe, expect, it } from 'vitest';
import { buildBackup, parseBackup, planImport } from '../src/storage/backup';
import { makeColor, newPalette } from '../src/core/palette';

function palette(name: string) {
  const p = newPalette(name, 'kraft');
  p.colors.push(makeColor('#3a4b7c', p.colors, { name: 'Indigo' })!);
  p.colors.push(makeColor('#f4f1ea', p.colors, { name: 'Paper', isPaper: true })!);
  return p;
}

describe('backup', () => {
  it('round-trips palettes through JSON', () => {
    const p = palette('Kraft – gouache');
    const back = parseBackup(JSON.stringify(buildBackup([p])));
    expect(back.palettes).toHaveLength(1);
    expect(back.palettes[0].id).toBe(p.id);
    expect(back.palettes[0].colors.map((c) => [c.hex, c.code, c.isPaper ?? false])).toEqual([
      ['#3a4b7c', 'A', false],
      ['#f4f1ea', '·', true],
    ]);
    expect(back.palettes[0].colors[0].lab[0]).toBeCloseTo(p.colors[0].lab[0], 6);
  });

  it('rejects things that are not exports', () => {
    expect(() => parseBackup('not json')).toThrow(/valid JSON/);
    expect(() => parseBackup('{"a":1}')).toThrow(/not a Swatch Pixelator export/);
    expect(() => parseBackup(JSON.stringify({ format: 'swatch-pixelator', palettes: [] }))).toThrow(/no palettes/);
  });

  it('drops colours with bad hex values and recomputes missing Lab', () => {
    const p = palette('x');
    const raw = JSON.parse(JSON.stringify(buildBackup([p])));
    raw.palettes[0].colors[0].hex = 'banana';
    delete raw.palettes[0].colors[1].lab;
    const back = parseBackup(JSON.stringify(raw));
    expect(back.palettes[0].colors).toHaveLength(1);
    expect(back.palettes[0].colors[0].lab).toHaveLength(3);
  });

  it('merges by id and reports conflicts', () => {
    const a = palette('A');
    const b = palette('B');
    const a2 = { ...a, name: 'A (edited)' };
    const plan = planImport([a], [a2, b]);
    expect(plan.added.map((p) => p.name)).toEqual(['B']);
    expect(plan.conflicts).toHaveLength(1);
    expect(plan.conflicts[0].incoming.name).toBe('A (edited)');
    expect(plan.conflicts[0].existing.name).toBe('A');
  });
});
