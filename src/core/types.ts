import { config } from '../config';

export type Lab = [number, number, number];
export type Metric = 'de2000' | 'de76';
export type CellMode = 'average' | 'median' | 'dominant';
export type DitherMode = 'off' | 'floyd' | 'ordered';
export type SampleMode = 'median' | 'masstone' | 'tint';
export type ViewMode = 'original' | 'adjusted' | 'pixelated' | 'matched';
export type ExportLayoutKind = 'colour' | 'code' | 'plain';

export interface PaletteColor {
  id: string;
  name: string;
  code: string;
  hex: string;
  lab: Lab;
  enabled: boolean;
  isPaper?: boolean;
  sample?: {
    cx: number;
    cy: number;
    areaPx: number;
    spread: number;
    mode: SampleMode;
    /** Whether the sheet was white-balanced when sampled, so re-sampling can repeat it. */
    wb?: boolean;
  };
}

export interface Palette {
  id: string;
  name: string;
  substrate?: string;
  notes?: string;
  colors: PaletteColor[];
  sheetImageId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface AdjustParams {
  brightness: number;
  contrast: number;
  saturation: number;
  hue: number;
  warmth: number;
  blackPoint: number; // input low (L*)
  whitePoint: number; // input high (L*)
  midtones: number;
  detail: number;
  /** Output range of the levels step. Set by Fit-to-palette, 0..100 otherwise. */
  outBlack: number;
  outWhite: number;
}

export interface ExportOptions {
  layout: ExportLayoutKind;
  gridLines: boolean;
  heavyEvery: 0 | 5 | 10;
  numbers: boolean;
  codes: boolean;
  legend: boolean;
}

export type CropPreset = 'original' | '1:1' | '4:5' | '3:4' | '2:3' | 'a' | 'custom';

export interface CropState {
  preset: CropPreset;
  landscape: boolean;
  customW: number; // cm (custom preset)
  customH: number;
  zoom: number; // 1 = largest window that fits
  cx: number; // window centre, normalised 0..1 of the source image
  cy: number;
}

export interface StudioSettings {
  cols: number;
  physicalMode: boolean;
  canvasWidthCm: number;
  cellMm: number;
  adjust: AdjustParams;
  autoAdjust: boolean; // true while the sliders still hold the auto values
  cellMode: CellMode;
  metric: Metric;
  valuePriority: number;
  ditherMode: DitherMode;
  ditherStrength: number;
  simplify: number;
  minPatch: number;
  includePaper: boolean;
  view: ViewMode;
  crop: CropState;
  export: ExportOptions;
}

export interface Settings {
  activePaletteId?: string;
  studio: StudioSettings;
  installHintSeen?: boolean;
}

export const defaultAdjust = (): AdjustParams => ({
  brightness: config.adjust.brightness.default,
  contrast: config.adjust.contrast.default,
  saturation: config.adjust.saturation.default,
  hue: config.adjust.hue.default,
  warmth: config.adjust.warmth.default,
  blackPoint: config.adjust.blackPoint.default,
  whitePoint: config.adjust.whitePoint.default,
  midtones: config.adjust.midtones.default,
  detail: config.adjust.detail.default,
  outBlack: 0,
  outWhite: 100,
});

export const defaultCrop = (): CropState => ({
  preset: 'original',
  landscape: false,
  customW: 30,
  customH: 40,
  zoom: 1,
  cx: 0.5,
  cy: 0.5,
});

export const defaultStudio = (): StudioSettings => ({
  cols: config.grid.default,
  physicalMode: false,
  canvasWidthCm: config.physical.canvasWidthCm,
  cellMm: config.physical.cellMm,
  adjust: defaultAdjust(),
  autoAdjust: true,
  cellMode: config.match.cellMode,
  metric: config.match.metric,
  valuePriority: config.match.valuePriority.default,
  ditherMode: config.dither.mode,
  ditherStrength: config.dither.strength.default,
  simplify: config.cleanup.simplify.default,
  minPatch: config.cleanup.minPatch.default,
  includePaper: true,
  view: 'matched',
  crop: defaultCrop(),
  export: {
    layout: config.export.layout,
    gridLines: config.export.gridLines,
    heavyEvery: config.export.heavyEvery,
    numbers: config.export.numbers,
    codes: config.export.codes,
    legend: config.export.legend,
  },
});

export const defaultSettings = (): Settings => ({ studio: defaultStudio() });
