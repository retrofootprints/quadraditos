/**
 * Every default threshold, radius and slider range lives here and nowhere else.
 * All numbers are starting points taken from SPEC.md; tune them after real use.
 */
export const config = {
  version: '1.0.0',

  image: {
    workingMax: 2048, // long side of the working image
    previewMax: 1024, // long side of the preview / detection copy
    sheetJpegQuality: 0.9,
    maxCanvas: 4096,
  },

  grid: { min: 8, max: 200, default: 48 },
  physical: { canvasWidthCm: 30, cellMm: 5 },

  palette: {
    nearDuplicateDeltaE: 3,
    defaultPaperCode: '·',
  },

  detect: {
    detectionMax: 1024,
    blurRadius: 2, // 5x5 box blur
    fgThreshold: { default: 12, min: 4, max: 30 },
    openRadius: 2,
    closeRadius: 3,
    minAreaFrac: 0.0015, // 0.15% of the image area
    coreRadius: 4,
    minSolidity: 0.6, // share of a region that must be real foreground before hole-filling; rejects bold lettering
    split: {
      enabled: true,
      spreadThreshold: 6, // only try to split blobs whose core spread (std of ΔE) exceeds this
      minClusterFrac: 0.25,
      minCentroidDeltaE: 10,
      iterations: 12,
    },
    paperBorderFrac: 0.1,
    paperHist: { lStep: 5, abStep: 4 },
    paperTapRadius: 15,
    growTolerance: { default: 8, min: 2, max: 25 },
    growMaxAreaFrac: 0.25,
    sample: { keepFrac: 0.6, extremeFrac: 0.25 },
    spreadWarning: 5, // sample spread above which a blob is flagged
    whiteBalance: false,
  },

  adjust: {
    brightness: { min: -100, max: 100, default: 0 },
    contrast: { min: -100, max: 100, default: 0 },
    saturation: { min: -100, max: 100, default: 0 },
    hue: { min: -180, max: 180, default: 0 },
    warmth: { min: -100, max: 100, default: 0 },
    blackPoint: { min: 0, max: 50, default: 0 },
    whitePoint: { min: 50, max: 100, default: 100 },
    midtones: { min: 0.5, max: 2, default: 1 },
    detail: { min: 0, max: 100, default: 0 },
    brightnessScale: 0.5, // L* units per slider unit
    warmthB: 0.3, // b* units per slider unit
    warmthA: 0.06, // a* units per slider unit
    auto: {
      lowPercentile: 0.005,
      highPercentile: 0.995,
      chromaPercentile: 0.95,
      narrowRange: 55, // p5..p95 L* spread under which a contrast S-curve is added
      contrastBoost: 25,
    },
    detailRadiusDivisor: 700, // unsharp radius = max(1, round(minSide / this))
    detailAmount: 1.5,
  },

  match: {
    valuePriority: { min: 0.5, max: 2, default: 1 },
    lutBits: 6,
    metric: 'de2000' as 'de2000' | 'de76',
    cellMode: 'average' as 'average' | 'median' | 'dominant',
    dominantBits: 4,
  },

  dither: {
    mode: 'off' as 'off' | 'floyd' | 'ordered',
    strength: { min: 0, max: 100, default: 50 },
    orderedAmplitude: 30, // L* units at 100% strength
    errorClamp: 40, // per-component cap on diffused error, keeps out-of-gamut colours from running away
  },

  cleanup: {
    simplify: { min: 0, max: 3, default: 0 },
    minPatch: { min: 1, max: 10, default: 1 },
  },

  export: {
    layout: 'colour' as 'colour' | 'code' | 'plain',
    gridLines: true,
    heavyEvery: 10 as 0 | 5 | 10,
    numbers: false,
    codes: false,
    legend: true,
    maxSide: 4096,
    minCell: 12,
    maxCell: 48,
    minCodeCell: 14, // codes are hidden below this cell size
    legendEntryW: 280,
    legendEntryH: 36,
  },

  perf: { sliderCoalesceFrames: 1 },
} as const;
