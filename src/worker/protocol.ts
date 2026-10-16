import type { Blob as SwatchBlob, DetectParams } from '../core/detect';
import type { ExportPlan } from '../core/exportLayout';
import type { ExportData } from '../core/exportRender';
import type {
  AdjustParams, CellMode, DitherMode, ExportOptions, Lab, Metric, SampleMode, ViewMode,
} from '../core/types';

/** Normalised crop rectangle in source-image coordinates (0..1). */
export interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PixelImage {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export interface RenderRequest {
  cols: number;
  cellMode: CellMode;
  adjust: AdjustParams;
  metric: Metric;
  valuePriority: number;
  ditherMode: DitherMode;
  ditherStrength: number;
  simplify: number;
  minPatch: number;
  view: ViewMode;
  /** Lab of every colour that takes part in matching. */
  palette: Lab[];
}

export interface RenderResult {
  cols: number;
  rows: number;
  indices: Int16Array;
  counts: number[];
  /** Adjusted cell colours as RGBA (cols × rows). Present for the Pixelated view. */
  pixelated?: PixelImage;
  /** Adjusted preview. Present for the Adjusted view. */
  adjusted?: PixelImage;
  timings: Record<string, number>;
}

export interface SheetInfo {
  jpeg: Blob;
  preview: PixelImage;
  fullWidth: number;
  fullHeight: number;
}

export interface DetectResponse {
  blobs: SwatchBlob[];
  fg: Uint8Array;
  core: Uint8Array;
  paperLab: Lab;
  width: number;
  height: number;
  timings: Record<string, number>;
}

/** Method name -> [request, response]. */
export interface Api {
  loadPhoto: [{ blob: Blob }, { width: number; height: number; preview: PixelImage }];
  setCrop: [{ crop: CropRect | null }, { width: number; height: number; preview: PixelImage }];
  render: [RenderRequest, RenderResult];
  autoAdjust: [{ palette: Lab[]; base: AdjustParams }, AdjustParams];
  loadSheet: [{ blob: Blob }, SheetInfo];
  sheetPrepare: [{ whiteBalance: boolean; paperAt?: [number, number] }, { paperLab: Lab }];
  sheetDetect: [{ params: DetectParams }, DetectResponse];
  sheetGrow: [
    { x: number; y: number; tolerance: number; mode: SampleMode; fgThreshold: number; coreRadius: number },
    { blob: SwatchBlob; capped: boolean },
  ];
  sheetSample: [{ pixels: Int32Array; mode: SampleMode; coreRadius: number }, { blob: SwatchBlob }];
  sheetSplit: [{ pixels: Int32Array; coreRadius: number }, { blobs: SwatchBlob[] | null }];
  exportPng: [{ data: ExportData; options: ExportOptions }, { blob: Blob; plan: ExportPlan }];
}

export type Method = keyof Api;

export interface WorkerRequest<M extends Method = Method> {
  id: number;
  method: M;
  payload: Api[M][0];
}

export type WorkerResponse =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: string }
  | { id: number; ok: true; stale: true };

/** Methods where only the newest request matters; older ones are dropped. */
export const LATEST_ONLY: ReadonlySet<Method> = new Set<Method>(['render', 'sheetGrow', 'sheetDetect', 'autoAdjust']);
