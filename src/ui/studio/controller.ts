import { effect, signal, batch } from '@preact/signals';
import { activeColors } from '../../core/palette';
import { cropRect, effectiveCols } from '../../core/crop';
import { defaultAdjust, defaultCrop, type PaletteColor } from '../../core/types';
import type { ExportData } from '../../core/exportRender';
import type { ExportPlan } from '../../core/exportLayout';
import { activePalette, settings, updateStudio } from '../../storage/store';
import { call, callStrict } from '../../worker/client';
import type { PixelImage, RenderResult } from '../../worker/protocol';
import { patchDebug } from '../debug';
import { showToast } from '../common/controls';

export interface PhotoState {
  name: string;
  /** Size of the working image of the uncropped photo. */
  width: number;
  height: number;
}

export interface RenderedGrid extends Omit<RenderResult, 'timings'> {
  colors: PaletteColor[];
}

export const photo = signal<PhotoState | null>(null);
export const sourcePreview = signal<PixelImage | null>(null); // uncropped, for the crop editor
export const workingPreview = signal<PixelImage | null>(null); // after crop: the "Original" view
export const photoVersion = signal(0);
export const loading = signal(false);
export const rendering = signal(false);
export const grid = signal<RenderedGrid | null>(null);
export const renderError = signal<string | null>(null);
export const disabledIds = signal<ReadonlySet<string>>(new Set());
export const highlight = signal<number | null>(null);
export const holdOriginal = signal(false);

export const exportState = signal<{ blob: Blob; url: string; plan: ExportPlan; filename: string } | null>(null);
export const exporting = signal(false);

// ---------- loading ----------

export async function loadPhotoFile(file: File) {
  loading.value = true;
  renderError.value = null;
  try {
    const info = await callStrict('loadPhoto', { blob: file });
    batch(() => {
      photo.value = { name: file.name || 'photo', width: info.width, height: info.height };
      sourcePreview.value = info.preview;
      workingPreview.value = info.preview;
      photoVersion.value++;
      disabledIds.value = new Set();
      highlight.value = null;
      clearExport();
    });
    // a new photo always starts from "Fit to palette"; the render loop runs it when the photo version changes
    updateStudio((s) => ({
      autoAdjust: true,
      crop: { ...defaultCrop(), preset: s.crop.preset, landscape: s.crop.landscape, customW: s.crop.customW, customH: s.crop.customH },
    }));
    await applyCrop();
  } catch (e) {
    showToast(`Could not open that photo: ${e instanceof Error ? e.message : String(e)}`, 5000);
  } finally {
    loading.value = false;
  }
}

/** Send the current crop window to the worker. */
export async function applyCrop() {
  const p = photo.value;
  if (!p) return;
  const rect = cropRect(settings.value.studio.crop, p.width, p.height);
  const info = await callStrict('setCrop', { crop: rect });
  batch(() => {
    workingPreview.value = info.preview;
    photoVersion.value++;
    clearExport();
  });
}

export function currentColors(): PaletteColor[] {
  return activeColors(activePalette.value, settings.value.studio.includePaper, disabledIds.value);
}

/** "Fit to palette": sets the sliders; the user can override everything it did. */
export async function runAuto() {
  if (!photo.value) return;
  const colors = currentColors();
  if (colors.length === 0) {
    updateStudio({ adjust: defaultAdjust(), autoAdjust: true });
    return;
  }
  const base = defaultAdjust();
  const res = await call('autoAdjust', { palette: colors.map((c) => c.lab), base });
  if (res) updateStudio({ adjust: res, autoAdjust: true });
}

export function resetAdjust() {
  void runAuto();
}

export function clearExport() {
  const e = exportState.value;
  if (e) URL.revokeObjectURL(e.url);
  exportState.value = null;
}

// ---------- rendering ----------

let framePending = false;
let lastKey = '';
let lastAutoKey = '';

export function scheduleRender() {
  if (framePending) return;
  framePending = true;
  requestAnimationFrame(() => {
    framePending = false;
    void doRender();
  });
}

async function doRender() {
  const p = photo.value;
  if (!p) return;
  const s = settings.value.studio;
  const colors = currentColors();
  if (colors.length === 0) {
    grid.value = null;
    renderError.value = activePalette.value
      ? 'No colours are enabled in this palette.'
      : 'Create a palette in the Palettes tab first.';
    return;
  }
  renderError.value = null;
  rendering.value = true;
  try {
    const res = await call('render', {
      cols: effectiveCols(s),
      cellMode: s.cellMode,
      adjust: s.adjust,
      metric: s.metric,
      valuePriority: s.valuePriority,
      ditherMode: s.ditherMode,
      ditherStrength: s.ditherStrength,
      simplify: s.simplify,
      minPatch: s.minPatch,
      view: s.view,
      palette: colors.map((c) => c.lab),
    });
    if (!res) return; // superseded
    const { timings, ...rest } = res;
    grid.value = { ...rest, colors };
    patchDebug({ render: timings, renderCells: `${res.cols} × ${res.rows}` });
  } catch (e) {
    renderError.value = e instanceof Error ? e.message : String(e);
  } finally {
    rendering.value = false;
  }
}

/** Re-render whenever anything the pipeline depends on changes. */
export function startRenderLoop() {
  return effect(() => {
    const s = settings.value.studio;
    const pal = activePalette.value;
    const ver = photoVersion.value;
    const dis = disabledIds.value;
    const hasPhoto = photo.value !== null;
    if (!hasPhoto) return;
    const key = JSON.stringify([
      ver, effectiveCols(s), s.cellMode, s.adjust, s.metric, s.valuePriority, s.ditherMode, s.ditherStrength,
      s.simplify, s.minPatch, s.view, s.includePaper, pal?.id, pal?.updatedAt, [...dis],
    ]);
    if (key === lastKey) return;
    lastKey = key;
    scheduleRender();

    // palette-dependent auto adjustment follows the palette while the sliders are still "auto"
    const autoKey = JSON.stringify([ver, pal?.id, pal?.updatedAt, s.includePaper, [...dis]]);
    if (s.autoAdjust && autoKey !== lastAutoKey) {
      lastAutoKey = autoKey;
      queueMicrotask(() => void runAuto());
    }
    lastAutoKey = autoKey;
  });
}

// ---------- export ----------

export async function renderExport(): Promise<void> {
  const g = grid.value;
  const s = settings.value.studio;
  if (!g) return;
  exporting.value = true;
  try {
    const data: ExportData = {
      cols: g.cols,
      rows: g.rows,
      indices: g.indices,
      colors: g.colors.map((c, i) => ({ hex: c.hex, code: c.code, name: c.name, count: g.counts[i] })),
      layout: s.export.layout,
      paletteName: activePalette.value?.name ?? 'Palette',
      date: new Date().toISOString().slice(0, 10),
    };
    const { blob, plan } = await callStrict('exportPng', { data, options: s.export });
    clearExport();
    const stamp = data.date.replace(/-/g, '');
    exportState.value = {
      blob,
      plan,
      url: URL.createObjectURL(blob),
      filename: `pixelator-${g.cols}x${g.rows}-${stamp}.png`,
    };
  } catch (e) {
    showToast(`Export failed: ${e instanceof Error ? e.message : String(e)}`, 5000);
  } finally {
    exporting.value = false;
  }
}
