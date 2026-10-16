import { useRef } from 'preact/hooks';
import { config } from '../../config';
import { effectiveCols } from '../../core/crop';
import { gridToCsv, planExport } from '../../core/exportLayout';
import { gridRows } from '../../core/pixelate';
import type { AdjustParams, CropPreset, DitherMode, ExportOptions, Metric, CellMode } from '../../core/types';
import { defaultCrop } from '../../core/types';
import { activePalette, palettes, setActive, settings, updateStudio } from '../../storage/store';
import { Segmented, Slider, Spinner, downloadBlob, shareOrDownload, showToast } from '../common/controls';
import { IconCamera, IconImage, IconShare, IconWarn } from '../common/icons';
import {
  applyCrop, clearExport, disabledIds, exportState, exporting, grid, highlight, loadPhotoFile, photo, renderExport,
  resetAdjust, runAuto, workingPreview,
} from './controller';

const A = config.adjust;

// ---------- photo ----------

export function PhotoPanel() {
  const pick = useRef<HTMLInputElement>(null);
  const cam = useRef<HTMLInputElement>(null);
  const onFile = (e: Event) => {
    const input = e.target as HTMLInputElement;
    const f = input.files?.[0];
    input.value = '';
    if (f) void loadPhotoFile(f);
  };
  const p = photo.value;
  return (
    <div class="stack">
      <div class="row wrap">
        <button class="btn primary" onClick={() => pick.current?.click()}><IconImage /> Choose photo</button>
        <button class="btn" onClick={() => cam.current?.click()}><IconCamera /> Camera</button>
      </div>
      <input ref={pick} type="file" accept="image/*" hidden onChange={onFile} />
      <input ref={cam} type="file" accept="image/*" capture="environment" hidden onChange={onFile} />
      {p ? (
        <p class="muted">{p.name} · {p.width} × {p.height} px working size. Press and hold the image to see the original.</p>
      ) : (
        <p class="muted">Pick a photo from your library, files, or take one with the camera.</p>
      )}
    </div>
  );
}

// ---------- crop ----------

const PRESETS: { value: CropPreset; label: string }[] = [
  { value: 'original', label: 'Original' },
  { value: '1:1', label: '1:1' },
  { value: '4:5', label: '4:5' },
  { value: '3:4', label: '3:4' },
  { value: '2:3', label: '2:3' },
  { value: 'a', label: 'A-series' },
  { value: 'custom', label: 'Custom' },
];

export function CropPanel({ onDone }: { onDone: () => void }) {
  const crop = settings.value.studio.crop;
  const set = (patch: Partial<typeof crop>) => updateStudio({ crop: { ...crop, ...patch, cx: 0.5, cy: 0.5 } });
  const setKeepCentre = (patch: Partial<typeof crop>) => updateStudio({ crop: { ...crop, ...patch } });
  const fixed = crop.preset !== 'original' && crop.preset !== '1:1' && crop.preset !== 'custom';
  const syncPhysical = (w: number) => {
    if (settings.value.studio.physicalMode) updateStudio({ canvasWidthCm: w });
  };
  return (
    <div class="stack">
      <div class="row wrap">
        {PRESETS.map((o) => (
          <button key={o.value} class={`btn small ${crop.preset === o.value ? 'primary' : ''}`} onClick={() => set({ preset: o.value, zoom: 1 })}>{o.label}</button>
        ))}
      </div>
      {fixed && (
        <label class="check">
          <input type="checkbox" checked={crop.landscape} onChange={(e) => setKeepCentre({ landscape: (e.target as HTMLInputElement).checked })} />
          Landscape
        </label>
      )}
      {crop.preset === 'custom' && (
        <div class="row">
          <label class="field grow">Width (cm)
            <input type="number" inputMode="decimal" min="1" step="0.5" value={crop.customW}
              onInput={(e) => { const v = Number((e.target as HTMLInputElement).value); if (v > 0) { setKeepCentre({ customW: v }); syncPhysical(v); } }} />
          </label>
          <label class="field grow">Height (cm)
            <input type="number" inputMode="decimal" min="1" step="0.5" value={crop.customH}
              onInput={(e) => { const v = Number((e.target as HTMLInputElement).value); if (v > 0) setKeepCentre({ customH: v }); }} />
          </label>
        </div>
      )}
      <Slider label="Zoom" value={crop.zoom} min={1} max={4} step={0.05} reset={1} format={(v) => `${v.toFixed(2)}×`} onInput={(v) => setKeepCentre({ zoom: v })} />
      <div class="row">
        <button class="btn grow" onClick={() => { updateStudio({ crop: { ...defaultCrop(), customW: crop.customW, customH: crop.customH } }); }}>Reset</button>
        <button class="btn primary grow" onClick={async () => { await applyCrop(); onDone(); }}>Apply crop</button>
      </div>
    </div>
  );
}

// ---------- grid ----------

export function GridPanel() {
  const s = settings.value.studio;
  const prev = workingPreview.value;
  const cols = effectiveCols(s);
  const rows = prev ? gridRows(prev.width, prev.height, cols) : 0;
  return (
    <div class="stack">
      <Slider
        label="Columns"
        value={s.cols}
        min={config.grid.min}
        max={config.grid.max}
        reset={config.grid.default}
        format={(v) => String(v)}
        onInput={(v) => updateStudio({ cols: v, physicalMode: false })}
      />
      <div>{cols} × {rows} = {(cols * rows).toLocaleString()} cells</div>
      <label class="check">
        <input type="checkbox" checked={s.physicalMode} onChange={(e) => updateStudio({ physicalMode: (e.target as HTMLInputElement).checked })} />
        Physical size: set canvas width and cell size
      </label>
      {s.physicalMode && (
        <div class="stack">
          <div class="row">
            <label class="field grow">Canvas width (cm)
              <input type="number" inputMode="decimal" min="1" step="0.5" value={s.canvasWidthCm}
                onInput={(e) => { const v = Number((e.target as HTMLInputElement).value); if (v > 0) updateStudio({ canvasWidthCm: v }); }} />
            </label>
            <label class="field grow">Cell size (mm)
              <input type="number" inputMode="decimal" min="1" step="0.5" value={s.cellMm}
                onInput={(e) => { const v = Number((e.target as HTMLInputElement).value); if (v > 0) updateStudio({ cellMm: v }); }} />
            </label>
          </div>
          <div class="muted">
            {cols} columns at {s.cellMm} mm = {((cols * s.cellMm) / 10).toFixed(1)} cm wide
            {rows ? `, ${((rows * s.cellMm) / 10).toFixed(1)} cm tall` : ''}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- adjust ----------

export function AdjustPanel() {
  const s = settings.value.studio;
  const a = s.adjust;
  const set = (patch: Partial<AdjustParams>) => updateStudio((cur) => ({ adjust: { ...cur.adjust, ...patch }, autoAdjust: false }));
  const signed = (v: number) => (v > 0 ? `+${v}` : String(v));
  return (
    <div class="stack">
      <div class="row">
        <button class="btn primary grow" onClick={() => void runAuto()}>Auto: fit to palette</button>
        <button class="btn grow" onClick={resetAdjust}>Reset</button>
      </div>
      <p class="muted small" style={{ margin: 0 }}>
        {s.autoAdjust ? 'Showing the automatic fit. Move any slider to override it.' : 'Adjusted by hand. Reset returns to the automatic fit.'} Double-tap a slider's name to reset it.
      </p>
      <Slider label="Brightness" value={a.brightness} min={A.brightness.min} max={A.brightness.max} reset={0} format={signed} onInput={(v) => set({ brightness: v })} />
      <Slider label="Contrast" value={a.contrast} min={A.contrast.min} max={A.contrast.max} reset={0} format={signed} onInput={(v) => set({ contrast: v })} />
      <Slider label="Saturation" value={a.saturation} min={A.saturation.min} max={A.saturation.max} reset={0} format={signed} onInput={(v) => set({ saturation: v })} />
      <Slider label="Hue" value={a.hue} min={A.hue.min} max={A.hue.max} reset={0} format={(v) => `${signed(v)}°`} onInput={(v) => set({ hue: v })} />
      <Slider label="Warmth" value={a.warmth} min={A.warmth.min} max={A.warmth.max} reset={0} format={signed} onInput={(v) => set({ warmth: v })} />
      <details>
        <summary class="muted" style={{ minHeight: 44, display: 'flex', alignItems: 'center' }}>Advanced</summary>
        <Slider label="Black point" value={Math.round(a.blackPoint)} min={A.blackPoint.min} max={A.blackPoint.max} format={(v) => String(v)} onInput={(v) => set({ blackPoint: v })} />
        <Slider label="White point" value={Math.round(a.whitePoint)} min={A.whitePoint.min} max={A.whitePoint.max} format={(v) => String(v)} onInput={(v) => set({ whitePoint: v })} />
        <Slider label="Midtones" value={a.midtones} min={A.midtones.min} max={A.midtones.max} step={0.05} reset={1} format={(v) => v.toFixed(2)} onInput={(v) => set({ midtones: v })} />
        <Slider label="Detail" value={a.detail} min={A.detail.min} max={A.detail.max} reset={0} format={(v) => String(v)} onInput={(v) => set({ detail: v })} hint="Unsharp mask before pixelating; helps small features survive" />
      </details>
    </div>
  );
}

// ---------- colours ----------

export function ColoursPanel() {
  const pal = activePalette.value;
  const s = settings.value.studio;
  const g = grid.value;
  const off = disabledIds.value;
  const toggle = (id: string) => {
    const next = new Set(off);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    disabledIds.value = next;
  };
  const hasPaper = pal?.colors.some((c) => c.isPaper);
  const total = g ? g.cols * g.rows : 0;
  const order = g ? g.colors.map((_, i) => i).sort((a, b) => g.counts[b] - g.counts[a]) : [];
  return (
    <div class="stack">
      <label class="field">Palette
        <select value={pal?.id ?? ''} onChange={(e) => setActive((e.target as HTMLSelectElement).value || undefined)}>
          {palettes.value.length === 0 && <option value="">No palettes yet</option>}
          {palettes.value.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.colors.length})</option>)}
        </select>
      </label>
      {hasPaper && (
        <label class="check">
          <input type="checkbox" checked={s.includePaper} onChange={(e) => updateStudio({ includePaper: (e.target as HTMLInputElement).checked })} />
          Include paper (those cells are left unpainted)
        </label>
      )}
      {pal && (
        <div>
          <div class="muted small">Tap a colour to leave it out of this image. The palette itself is not changed.</div>
          <div class="row wrap">
            {pal.colors.filter((c) => c.enabled && (!c.isPaper || s.includePaper)).map((c) => (
              <button key={c.id} class="chipbtn" aria-pressed={!off.has(c.id)} onClick={() => toggle(c.id)} title={c.name}>
                <span class="chip" style={{ background: c.hex }} />
                <span class="code">{c.code}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      {g && (
        <div>
          <h3>Cells per colour</h3>
          {order.map((i) => {
            const c = g.colors[i];
            return (
              <button key={c.id} class="stat" aria-pressed={highlight.value === i} onClick={() => (highlight.value = highlight.value === i ? null : i)}>
                <span class="chip" style={{ background: c.hex, marginLeft: 4 }} />
                <b>{c.code}</b>
                <span>{c.name}</span>
                <span class="muted" style={{ paddingRight: 8 }}>{g.counts[i].toLocaleString()} · {((g.counts[i] / total) * 100).toFixed(1)}%</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------- tune ----------

export function TunePanel() {
  const s = settings.value.studio;
  return (
    <div class="stack">
      <h3>Dithering</h3>
      <Segmented<DitherMode> value={s.ditherMode} label="Dithering" onChange={(v) => updateStudio({ ditherMode: v })}
        options={[{ value: 'off', label: 'Off' }, { value: 'floyd', label: 'Floyd–Steinberg' }, { value: 'ordered', label: 'Ordered' }]} />
      {s.ditherMode !== 'off' && (
        <Slider label="Strength" value={s.ditherStrength} min={0} max={100} reset={config.dither.strength.default} format={(v) => `${v}%`} onInput={(v) => updateStudio({ ditherStrength: v })} />
      )}
      <h3>Cleanup</h3>
      <Slider label="Simplify passes" value={s.simplify} min={config.cleanup.simplify.min} max={config.cleanup.simplify.max} reset={0} onInput={(v) => updateStudio({ simplify: v })} hint="Removes cells that disagree with nearly all their neighbours" />
      <Slider label="Minimum patch size" value={s.minPatch} min={config.cleanup.minPatch.min} max={config.cleanup.minPatch.max} reset={1} format={(v) => `${v} cell${v === 1 ? '' : 's'}`} onInput={(v) => updateStudio({ minPatch: v })} />
      <h3>Matching</h3>
      <Slider label="Value priority" value={s.valuePriority} min={config.match.valuePriority.min} max={config.match.valuePriority.max} step={0.05} reset={1} format={(v) => v.toFixed(2)} onInput={(v) => updateStudio({ valuePriority: v })} hint="Higher keeps light and dark more faithful than hue" />
      <label class="field">Distance metric
        <select value={s.metric} onChange={(e) => updateStudio({ metric: (e.target as HTMLSelectElement).value as Metric })}>
          <option value="de2000">ΔE2000 (default)</option>
          <option value="de76">ΔE76 (plain Lab distance)</option>
        </select>
      </label>
      <label class="field">Cell sampling
        <select value={s.cellMode} onChange={(e) => updateStudio({ cellMode: (e.target as HTMLSelectElement).value as CellMode })}>
          <option value="average">Average (default)</option>
          <option value="median">Median: crisper edges</option>
          <option value="dominant">Dominant: most posterised</option>
        </select>
      </label>
    </div>
  );
}

// ---------- export ----------

export function ExportPanel() {
  const s = settings.value.studio;
  const o = s.export;
  const g = grid.value;
  const ex = exportState.value;
  const set = (patch: Partial<ExportOptions>) => { updateStudio({ export: { ...o, ...patch } }); clearExport(); };
  const plan = g ? planExport({ cols: g.cols, rows: g.rows, colorsUsed: g.counts.filter((n) => n > 0).length, options: o }) : null;
  const plain = o.layout === 'plain';
  return (
    <div class="stack">
      <Segmented<ExportOptions['layout']> value={o.layout} label="Layout" onChange={(v) => set({ layout: v })}
        options={[{ value: 'colour', label: 'Colour grid' }, { value: 'code', label: 'Paint-by-code' }, { value: 'plain', label: 'Plain' }]} />
      {!plain && (
        <>
          <label class="check"><input type="checkbox" checked={o.gridLines} onChange={(e) => set({ gridLines: (e.target as HTMLInputElement).checked })} /> Thin grid lines</label>
          <div class="row">
            <span class="grow">Heavy line every</span>
            <Segmented<number> value={o.heavyEvery} onChange={(v) => set({ heavyEvery: v as 0 | 5 | 10 })}
              options={[{ value: 0, label: 'Off' }, { value: 5, label: '5' }, { value: 10, label: '10' }]} />
          </div>
          <label class="check"><input type="checkbox" checked={o.numbers} onChange={(e) => set({ numbers: (e.target as HTMLInputElement).checked })} /> Row and column numbers</label>
          {o.layout === 'colour' && (
            <label class="check"><input type="checkbox" checked={o.codes} onChange={(e) => set({ codes: (e.target as HTMLInputElement).checked })} /> Print colour codes in cells</label>
          )}
          <label class="check"><input type="checkbox" checked={o.legend} onChange={(e) => set({ legend: (e.target as HTMLInputElement).checked })} /> Legend with colour counts</label>
        </>
      )}
      {plan && (
        <div class="muted small">
          {plan.width} × {plan.height} px, {plan.cell} px cells
          {plan.warnings.map((w) => <div key={w} class="warn"><IconWarn style={{ width: 14, height: 14, verticalAlign: -2 }} /> {w}</div>)}
        </div>
      )}
      <button class="btn primary" disabled={!g || exporting.value} onClick={() => void renderExport()}>
        {exporting.value ? <Spinner /> : null} Render PNG
      </button>
      {ex && (
        <div class="stack">
          <img src={ex.url} alt="Export preview" style={{ width: '100%', borderRadius: 8, border: '1px solid var(--line)' }} />
          <div class="row">
            <button class="btn primary grow" onClick={async () => {
              const r = await shareOrDownload(ex.blob, ex.filename);
              if (r === 'downloaded') showToast('Saved to your downloads');
            }}><IconShare /> Save / share</button>
            <button class="btn" onClick={() => downloadBlob(ex.blob, ex.filename)}>Download</button>
          </div>
          <p class="muted small" style={{ margin: 0 }}>On iPhone, choose "Save Image" in the share sheet to put it in Photos.</p>
        </div>
      )}
      {g && (
        <button class="btn" onClick={() => {
          const csv = gridToCsv(g.indices, g.cols, g.rows, g.colors.map((c) => c.code));
          downloadBlob(new Blob([csv], { type: 'text/csv' }), `pixelator-${g.cols}x${g.rows}.csv`);
        }}>Export grid as CSV</button>
      )}
    </div>
  );
}
