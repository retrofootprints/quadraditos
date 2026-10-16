/// Web Worker: decoding, adjustment, detection, pixelation, matching and export rendering.
/// Pure algorithms live in src/core; this file only holds state and message plumbing.
import { config } from '../config';
import { adjustImage, autoAdjust, paletteRange, unsharp } from '../core/adjust';
import { linearRgbToLab, labToLinearRgb, linearToByte } from '../core/color';
import {
  detectBlobs, foregroundMask, makeBlob, prepareSheet, splitTwo, type SheetData,
} from '../core/detect';
import { planExport } from '../core/exportLayout';
import { renderExport } from '../core/exportRender';
import { countIndices, matchCells } from '../core/pipeline';
import { gridRows, pixelate } from '../core/pixelate';
import { regionGrow } from '../core/regionGrow';
import { LATEST_ONLY, type Api, type CropRect, type Method, type PixelImage, type WorkerRequest, type WorkerResponse } from './protocol';

type Scope = {
  postMessage(msg: unknown, transfer?: Transferable[]): void;
  onmessage: ((e: MessageEvent<WorkerRequest>) => void) | null;
};
const ctx = self as unknown as Scope;

// ---------- image helpers ----------

function canvasOf(w: number, h: number) {
  const c = new OffscreenCanvas(w, h);
  const g = c.getContext('2d', { willReadFrequently: true })!;
  return { c, g };
}

async function decode(blob: Blob, maxSide: number): Promise<PixelImage & { bitmapW: number; bitmapH: number }> {
  const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  const s = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * s));
  const h = Math.max(1, Math.round(bmp.height * s));
  const { c, g } = canvasOf(w, h);
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, w, h);
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  g.drawImage(bmp, 0, 0, w, h);
  const bitmapW = bmp.width, bitmapH = bmp.height;
  bmp.close();
  const data = g.getImageData(0, 0, w, h).data;
  c.width = 0;
  c.height = 0;
  return { data, width: w, height: h, bitmapW, bitmapH };
}

function downscale(img: PixelImage, maxSide: number): PixelImage {
  const s = Math.min(1, maxSide / Math.max(img.width, img.height));
  if (s >= 1) return { data: img.data.slice(), width: img.width, height: img.height };
  const w = Math.max(1, Math.round(img.width * s));
  const h = Math.max(1, Math.round(img.height * s));
  const src = canvasOf(img.width, img.height);
  src.g.putImageData(new ImageData(img.data as Uint8ClampedArray<ArrayBuffer>, img.width, img.height), 0, 0);
  const dst = canvasOf(w, h);
  dst.g.imageSmoothingEnabled = true;
  dst.g.imageSmoothingQuality = 'high';
  dst.g.drawImage(src.c, 0, 0, w, h);
  const data = dst.g.getImageData(0, 0, w, h).data;
  src.c.width = src.c.height = dst.c.width = dst.c.height = 0;
  return { data, width: w, height: h };
}

const timer = () => {
  const t0 = performance.now();
  return () => Math.round((performance.now() - t0) * 10) / 10;
};

// ---------- state ----------

let photoSrc: PixelImage | null = null;
let photo: PixelImage | null = null; // working image (after crop)
let photoPreview: PixelImage | null = null;
let photoVersion = 0;
let detailCache: { version: number; detail: number; img: PixelImage } | null = null;
let cellCache: { key: string; linear: Float32Array } | null = null;

let sheetRgba: PixelImage | null = null; // detection copy
let sheet: SheetData | null = null;
let rawFg: { threshold: number; mask: Uint8Array } | null = null;

/** A copy for posting: the result buffers are transferred, so the worker must keep its own. */
const transferable = (img: PixelImage): PixelImage => ({ data: img.data.slice(), width: img.width, height: img.height });

function setPhoto(img: PixelImage) {
  photo = img;
  photoVersion++;
  detailCache = null;
  cellCache = null;
  photoPreview = downscale(img, config.image.previewMax);
}

function workingImage(detail: number): PixelImage {
  if (!photo) throw new Error('No photo loaded');
  if (detail <= 0) return photo;
  if (detailCache && detailCache.version === photoVersion && detailCache.detail === detail) return detailCache.img;
  const img = { data: unsharp(photo.data, photo.width, photo.height, detail), width: photo.width, height: photo.height };
  detailCache = { version: photoVersion, detail, img };
  return img;
}

// ---------- handlers ----------

type Handlers = { [M in Method]: (p: Api[M][0]) => Promise<Api[M][1]> | Api[M][1] };

const handlers: Handlers = {
  async loadPhoto({ blob }) {
    const img = await decode(blob, config.image.workingMax);
    photoSrc = { data: img.data, width: img.width, height: img.height };
    setPhoto(photoSrc);
    return { width: photo!.width, height: photo!.height, preview: transferable(photoPreview!) };
  },

  setCrop({ crop }: { crop: CropRect | null }) {
    if (!photoSrc) throw new Error('No photo loaded');
    if (!crop) {
      setPhoto(photoSrc);
    } else {
      const x0 = Math.max(0, Math.min(photoSrc.width - 1, Math.round(crop.x * photoSrc.width)));
      const y0 = Math.max(0, Math.min(photoSrc.height - 1, Math.round(crop.y * photoSrc.height)));
      const w = Math.max(1, Math.min(photoSrc.width - x0, Math.round(crop.w * photoSrc.width)));
      const h = Math.max(1, Math.min(photoSrc.height - y0, Math.round(crop.h * photoSrc.height)));
      const data = new Uint8ClampedArray(w * h * 4);
      for (let y = 0; y < h; y++) {
        const from = ((y0 + y) * photoSrc.width + x0) * 4;
        data.set(photoSrc.data.subarray(from, from + w * 4), y * w * 4);
      }
      setPhoto({ data, width: w, height: h });
    }
    return { width: photo!.width, height: photo!.height, preview: transferable(photoPreview!) };
  },

  render(req) {
    if (!photo || !photoPreview) throw new Error('No photo loaded');
    const timings: Record<string, number> = {};
    let lap = timer();
    const rows = gridRows(photo.width, photo.height, req.cols);
    const key = `${photoVersion}|${req.cols}|${rows}|${req.cellMode}|${req.adjust.detail}`;
    if (!cellCache || cellCache.key !== key) {
      cellCache = { key, linear: pixelate(workingImage(req.adjust.detail), req.cols, rows, req.cellMode) };
      timings.pixelate = lap();
    }
    lap = timer();
    const { indices, adjustedLab } = matchCells({
      linear: cellCache.linear,
      cols: req.cols,
      rows,
      palette: req.palette,
      adjust: req.adjust,
      metric: req.metric,
      valuePriority: req.valuePriority,
      ditherMode: req.ditherMode,
      ditherStrength: req.ditherStrength,
      simplify: req.simplify,
      minPatch: req.minPatch,
    });
    timings.match = lap();
    const result: Api['render'][1] = {
      cols: req.cols,
      rows,
      indices,
      counts: countIndices(indices, req.palette.length),
      timings,
    };
    if (req.view === 'pixelated') {
      const data = new Uint8ClampedArray(req.cols * rows * 4);
      const rgb = [0, 0, 0];
      for (let i = 0; i < req.cols * rows; i++) {
        labToLinearRgb(adjustedLab[i * 3], adjustedLab[i * 3 + 1], adjustedLab[i * 3 + 2], rgb);
        data[i * 4] = linearToByte(rgb[0]);
        data[i * 4 + 1] = linearToByte(rgb[1]);
        data[i * 4 + 2] = linearToByte(rgb[2]);
        data[i * 4 + 3] = 255;
      }
      result.pixelated = { data, width: req.cols, height: rows };
    } else if (req.view === 'adjusted') {
      lap = timer();
      result.adjusted = {
        data: adjustImage(unsharp(photoPreview.data, photoPreview.width, photoPreview.height, req.adjust.detail), req.adjust),
        width: photoPreview.width,
        height: photoPreview.height,
      };
      timings.adjustedView = lap();
    }
    return result;
  },

  autoAdjust({ palette, base }) {
    if (!photoPreview) throw new Error('No photo loaded');
    const px = photoPreview.width * photoPreview.height;
    const step = Math.max(1, Math.floor(px / 40000));
    const labs: number[] = [];
    const out = [0, 0, 0];
    const d = photoPreview.data;
    for (let i = 0; i < px; i += step) {
      linearRgbToLab(srgbLin(d[i * 4]), srgbLin(d[i * 4 + 1]), srgbLin(d[i * 4 + 2]), out);
      labs.push(out[0], out[1], out[2]);
    }
    return autoAdjust(Float32Array.from(labs), paletteRange(palette), base);
  },

  // ----- swatch sheet -----

  async loadSheet({ blob }) {
    const full = await decode(blob, config.image.workingMax);
    const { c, g } = canvasOf(full.width, full.height);
    g.putImageData(new ImageData(full.data as Uint8ClampedArray<ArrayBuffer>, full.width, full.height), 0, 0);
    const jpeg = await c.convertToBlob({ type: 'image/jpeg', quality: config.image.sheetJpegQuality });
    c.width = c.height = 0;
    sheetRgba = downscale(full, config.detect.detectionMax);
    sheet = null;
    rawFg = null;
    return { jpeg, preview: transferable(sheetRgba), fullWidth: full.width, fullHeight: full.height };
  },

  sheetPrepare({ whiteBalance, paperAt }) {
    if (!sheetRgba) throw new Error('No sheet loaded');
    sheet = prepareSheet(sheetRgba.data, sheetRgba.width, sheetRgba.height, { whiteBalance, paperAt });
    rawFg = null;
    return { paperLab: sheet.paperLab };
  },

  sheetDetect({ params }) {
    if (!sheet) throw new Error('Sheet not prepared');
    const lap = timer();
    const res = detectBlobs(sheet, params);
    return {
      blobs: res.blobs,
      fg: res.fg,
      core: res.core,
      paperLab: sheet.paperLab,
      width: sheet.w,
      height: sheet.h,
      timings: { detect: lap() },
    };
  },

  sheetGrow({ x, y, tolerance, mode, fgThreshold, coreRadius }) {
    if (!sheet) throw new Error('Sheet not prepared');
    if (!rawFg || rawFg.threshold !== fgThreshold) {
      rawFg = { threshold: fgThreshold, mask: foregroundMask(sheet.blur, sheet.w * sheet.h, sheet.paperLab, fgThreshold) };
    }
    const g = regionGrow(sheet.blur, rawFg.mask, sheet.w, sheet.h, x, y, tolerance, config.detect.growMaxAreaFrac);
    const blob = makeBlob(sheet, g.pixels, mode, { coreRadius }, true);
    blob.seed = [Math.round(x), Math.round(y)];
    return { blob, capped: g.capped };
  },

  sheetSample({ pixels, mode, coreRadius }) {
    if (!sheet) throw new Error('Sheet not prepared');
    return { blob: makeBlob(sheet, pixels, mode, { coreRadius }, true) };
  },

  sheetSplit({ pixels, coreRadius }) {
    if (!sheet) throw new Error('Sheet not prepared');
    const two = splitTwo(sheet.blur, pixels);
    if (!two) return { blobs: null };
    return { blobs: two.map((p) => makeBlob(sheet!, p, 'median', { coreRadius }, true)) };
  },

  // ----- export -----

  async exportPng({ data, options }) {
    const plan = planExport({
      cols: data.cols,
      rows: data.rows,
      colorsUsed: data.colors.filter((c) => c.count > 0).length,
      options,
    });
    const { c, g } = canvasOf(plan.width, plan.height);
    renderExport(g, plan, data);
    const blob = await c.convertToBlob({ type: 'image/png' });
    c.width = c.height = 0;
    return { blob, plan };
  },
};

function srgbLin(v: number): number {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

// ---------- queue with "latest wins" ----------

const queue: WorkerRequest[] = [];
const newest = new Map<Method, number>();
let draining = false;

async function drain() {
  if (draining) return;
  draining = true;
  while (queue.length) {
    const job = queue.shift()!;
    if (LATEST_ONLY.has(job.method) && newest.get(job.method) !== job.id) {
      post({ id: job.id, ok: true, stale: true });
      continue;
    }
    try {
      const handler = handlers[job.method] as (p: unknown) => unknown;
      const result = (await handler(job.payload)) as Record<string, unknown>;
      post({ id: job.id, ok: true, result }, transfersOf(result));
    } catch (e) {
      post({ id: job.id, ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }
  draining = false;
}

function post(msg: WorkerResponse, transfer: Transferable[] = []) {
  ctx.postMessage(msg, transfer);
}

/** Large typed arrays in a result are moved, not copied. */
function transfersOf(result: unknown): Transferable[] {
  const out: Transferable[] = [];
  const seen = new Set<ArrayBufferLike>();
  const visit = (v: unknown, depth: number) => {
    if (!v || typeof v !== 'object' || depth > 3) return;
    if (ArrayBuffer.isView(v)) {
      if (v.buffer instanceof ArrayBuffer && !seen.has(v.buffer) && v.byteLength > 4096) {
        seen.add(v.buffer);
        out.push(v.buffer);
      }
      return;
    }
    if (v instanceof Blob) return;
    for (const k of Object.keys(v)) visit((v as Record<string, unknown>)[k], depth + 1);
  };
  visit(result, 0);
  return out;
}

ctx.onmessage = (e) => {
  const req = e.data;
  if (LATEST_ONLY.has(req.method)) newest.set(req.method, req.id);
  queue.push(req);
  setTimeout(drain, 0);
};
