import { config } from '../config';
import { deltaE2000, hexToLab, labToHex, normaliseHex } from './color';
import type { Lab, Palette, PaletteColor } from './types';

export function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/** A, B, … Z, AA, AB, … for index 0, 1, … */
export function codeForIndex(i: number): string {
  let s = '';
  let n = i;
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

/** First code in the A, B, C … sequence that no colour in the palette uses. */
export function nextFreeCode(colors: PaletteColor[]): string {
  const used = new Set(colors.map((c) => c.code));
  for (let i = 0; ; i++) {
    const code = codeForIndex(i);
    if (!used.has(code)) return code;
  }
}

/** Re-letter every non-paper colour A, B, C … in list order. The paper colour gets the paper code. */
export function reassignCodes(colors: PaletteColor[]): PaletteColor[] {
  let i = 0;
  return colors.map((c) => ({ ...c, code: c.isPaper ? config.palette.defaultPaperCode : codeForIndex(i++) }));
}

export function isCodeTaken(colors: PaletteColor[], code: string, exceptId?: string): boolean {
  return colors.some((c) => c.id !== exceptId && c.code === code);
}

export function makeColor(hex: string, colors: PaletteColor[], extra: Partial<PaletteColor> = {}): PaletteColor | null {
  const norm = normaliseHex(hex);
  const lab = norm ? hexToLab(norm) : null;
  if (!norm || !lab) return null;
  return {
    id: uuid(),
    name: `Colour ${colors.length + 1}`,
    code: extra.isPaper ? config.palette.defaultPaperCode : nextFreeCode(colors),
    hex: norm,
    lab,
    enabled: true,
    ...extra,
  };
}

export function makeColorFromLab(lab: Lab, colors: PaletteColor[], extra: Partial<PaletteColor> = {}): PaletteColor {
  return makeColor(labToHex(lab), colors, { ...extra, lab })!;
}

export function newPalette(name: string, substrate?: string): Palette {
  const now = Date.now();
  return { id: uuid(), name, substrate, colors: [], createdAt: now, updatedAt: now };
}

/** Pairs of colours closer than the near-duplicate threshold. Returns colour ids that have a twin. */
export function nearDuplicates(colors: PaletteColor[], threshold = config.palette.nearDuplicateDeltaE): Map<string, string> {
  const out = new Map<string, string>();
  for (let i = 0; i < colors.length; i++) {
    for (let j = i + 1; j < colors.length; j++) {
      const a = colors[i].lab, b = colors[j].lab;
      if (deltaE2000(a[0], a[1], a[2], b[0], b[1], b[2]) < threshold) {
        if (!out.has(colors[i].id)) out.set(colors[i].id, colors[j].name);
        if (!out.has(colors[j].id)) out.set(colors[j].id, colors[i].name);
      }
    }
  }
  return out;
}

/** Colours that take part in matching for this image. */
export function activeColors(palette: Palette | undefined, includePaper: boolean, disabledIds: ReadonlySet<string> | string[] = []): PaletteColor[] {
  if (!palette) return [];
  const off = disabledIds instanceof Set ? disabledIds : new Set(disabledIds);
  return palette.colors.filter((c) => c.enabled && !off.has(c.id) && (!c.isPaper || includePaper));
}
