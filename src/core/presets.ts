import { codeForIndex, makeColor, newPalette } from './palette';
import type { Palette, PaletteColor } from './types';

export interface PresetColor {
  name: string;
  hex: string;
}

export interface Preset {
  key: string;
  name: string;
  substrate: string;
  notes: string;
  colors: PresetColor[];
}

/**
 * Melted fuse beads, sampled from a photo of an ironed swatch (black bead border, daylight, phone camera).
 * Each value is the trimmed mean of a patch in the middle of the bead. Near-identical cells were merged.
 */
const fuseBeads: Preset = {
  key: 'fuse-beads',
  name: 'Fuse beads',
  substrate: 'Fuse beads (ironed)',
  notes: 'Built-in preset sampled from a photo of an ironed bead swatch. Re-sample or tweak hexes if your lighting differs.',
  colors: [
    { name: 'White', hex: '#fafcf7' },
    { name: 'Cream', hex: '#f9f3e3' },
    { name: 'Pearl white', hex: '#cdd2c4' },
    { name: 'Light grey', hex: '#bfc6be' },
    { name: 'Grey (marbled)', hex: '#7a7a78' },
    { name: 'Black', hex: '#2c2b29' },
    { name: 'Blush', hex: '#f8d6ce' },
    { name: 'Peach', hex: '#e1b38f' },
    { name: 'Light orange', hex: '#eaa059' },
    { name: 'Orange', hex: '#eb7837' },
    { name: 'Red', hex: '#d74047' },
    { name: 'Crimson', hex: '#c74158' },
    { name: 'Magenta', hex: '#dc4574' },
    { name: 'Pink', hex: '#fa9eb1' },
    { name: 'Plum', hex: '#693f43' },
    { name: 'Brown', hex: '#71544e' },
    { name: 'Khaki brown (marbled)', hex: '#745c44' },
    { name: 'Yellow', hex: '#efdb3e' },
    { name: 'Chartreuse', hex: '#cadb37' },
    { name: 'Lime', hex: '#afcb33' },
    { name: 'Light green', hex: '#79c868' },
    { name: 'Green', hex: '#439259' },
    { name: 'Turquoise', hex: '#7fe9d3' },
    { name: 'Pastel blue', hex: '#a6d7e5' },
    { name: 'Light blue', hex: '#6cb3cf' },
    { name: 'Blue', hex: '#3670c2' },
    { name: 'Lavender', hex: '#af9de7' },
  ],
};

export const presets: Preset[] = [fuseBeads];

export function paletteFromPreset(preset: Preset): Palette {
  const p = newPalette(preset.name, preset.substrate);
  p.notes = preset.notes;
  const colors: PaletteColor[] = [];
  preset.colors.forEach((c, i) => {
    const col = makeColor(c.hex, colors, { name: c.name, code: codeForIndex(i) });
    if (col) colors.push(col);
  });
  p.colors = colors;
  return p;
}
