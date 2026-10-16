import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { config } from '../../config';
import { contrastInk } from '../../core/exportRender';
import { labToHex } from '../../core/color';
import { defaultDetectParams, readingOrder, type Blob as SwatchBlob } from '../../core/detect';
import { makeColorFromLab, newPalette } from '../../core/palette';
import type { Lab, Palette, PaletteColor, SampleMode } from '../../core/types';
import { palettes, savePalette, saveSheetImage } from '../../storage/store';
import { call, callStrict } from '../../worker/client';
import type { PixelImage } from '../../worker/protocol';
import { Segmented, Sheet, Slider, Spinner, showToast } from '../common/controls';
import { IconBack, IconRedo, IconTrash, IconUndo, IconWarn } from '../common/icons';
import { ZoomPan } from '../common/ZoomPan';
import { patchDebug } from '../debug';
import { navigate } from '../nav';

export interface UiBlob extends SwatchBlob {
  uid: number;
  name?: string;
}

interface SheetState {
  preview: PixelImage;
  fullWidth: number;
  fullHeight: number;
  jpeg: Blob;
}

let uidCounter = 1;
const withUid = (b: SwatchBlob, prev?: UiBlob): UiBlob => ({ ...b, uid: prev?.uid ?? uidCounter++, name: prev?.name });

const D = config.detect;

export function Extractor({ addTo }: { addTo?: string }) {
  const [stage, setStage] = useState<'pick' | 'loading' | 'edit'>('pick');
  const [sheet, setSheet] = useState<SheetState | null>(null);
  const [blobs, setBlobs] = useState<UiBlob[]>([]);
  const [undo, setUndo] = useState<UiBlob[][]>([]);
  const [redo, setRedo] = useState<UiBlob[][]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [fgThreshold, setFgThreshold] = useState<number>(D.fgThreshold.default);
  const [growTol, setGrowTol] = useState<number>(D.growTolerance.default);
  const [wb, setWb] = useState<boolean>(D.whiteBalance);
  const [paper, setPaper] = useState<Lab | null>(null);
  const [tapPaper, setTapPaper] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [saving, setSaving] = useState(false);
  const live = useRef<UiBlob[] | null>(null);
  const detectTimer = useRef<ReturnType<typeof setTimeout>>();
  const baseRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const pickRef = useRef<HTMLInputElement>(null);
  const camRef = useRef<HTMLInputElement>(null);

  // ---------- history ----------
  const commit = (next: UiBlob[], before = blobs) => {
    setUndo((u) => [...u.slice(-49), before]);
    setRedo([]);
    setBlobs(next);
  };
  const doUndo = () => {
    const prev = undo[undo.length - 1];
    if (!prev) return;
    setUndo(undo.slice(0, -1));
    setRedo([...redo, blobs]);
    setBlobs(prev);
    setSelected(null);
  };
  const doRedo = () => {
    const next = redo[redo.length - 1];
    if (!next) return;
    setRedo(redo.slice(0, -1));
    setUndo([...undo, blobs]);
    setBlobs(next);
    setSelected(null);
  };

  // ---------- worker calls ----------
  const prepare = async (paperAt?: [number, number], wbOverride?: boolean) => {
    const r = await callStrict('sheetPrepare', { whiteBalance: wbOverride ?? wb, paperAt });
    setPaper(r.paperLab);
  };

  const detect = async (thr = fgThreshold, keep: UiBlob[] = blobs) => {
    setBusy(true);
    try {
      const res = await call('sheetDetect', { params: { ...defaultDetectParams(), fgThreshold: thr } });
      if (!res) return;
      const manual = keep.filter((b) => b.manual);
      const auto = res.blobs.map((b) => withUid(b));
      const next = readingOrder([...auto, ...manual]);
      commit(next, keep);
      setSelected(null);
      patchDebug({ detect: { width: res.width, height: res.height, fg: res.fg, core: res.core, timings: res.timings, blobs: res.blobs.length } });
      setNotice(res.blobs.length === 0 ? 'No swatches found. Lower the sensitivity threshold, or tap a swatch to add it.' : null);
    } catch (e) {
      showToast(`Detection failed: ${e instanceof Error ? e.message : String(e)}`, 5000);
    } finally {
      setBusy(false);
    }
  };

  const load = async (file: File) => {
    setStage('loading');
    try {
      const info = await callStrict('loadSheet', { blob: file });
      setSheet({ preview: info.preview, fullWidth: info.fullWidth, fullHeight: info.fullHeight, jpeg: info.jpeg });
      await prepare(undefined);
      setStage('edit');
      setBlobs([]);
      await detect(fgThreshold, []);
    } catch (e) {
      showToast(`Could not open that image: ${e instanceof Error ? e.message : String(e)}`, 5000);
      setStage('pick');
    }
  };

  const onFile = (e: Event) => {
    const input = e.target as HTMLInputElement;
    const f = input.files?.[0];
    input.value = '';
    if (f) void load(f);
  };

  // ---------- drawing ----------
  const labels = useMemo(() => {
    if (!sheet) return null;
    const map = new Int16Array(sheet.preview.width * sheet.preview.height);
    blobs.forEach((b, i) => {
      for (let k = 0; k < b.pixels.length; k++) map[b.pixels[k]] = i + 1;
    });
    return map;
  }, [blobs, sheet]);

  useEffect(() => {
    if (!sheet || !baseRef.current) return;
    const c = baseRef.current;
    c.width = sheet.preview.width;
    c.height = sheet.preview.height;
    c.getContext('2d')!.putImageData(new ImageData(sheet.preview.data as Uint8ClampedArray<ArrayBuffer>, c.width, c.height), 0, 0);
  }, [sheet]);

  useEffect(() => {
    const c = overlayRef.current;
    if (!sheet || !c || !labels) return;
    const W = sheet.preview.width, H = sheet.preview.height;
    c.width = W;
    c.height = H;
    const g = c.getContext('2d')!;
    const img = g.createImageData(W, H);
    const d = img.data;
    const selIdx = selected === null ? -1 : blobs.findIndex((b) => b.uid === selected) + 1;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        const l = labels[i];
        const nl = x > 0 ? labels[i - 1] : 0, nr = x < W - 1 ? labels[i + 1] : 0;
        const nu = y > 0 ? labels[i - W] : 0, nd = y < H - 1 ? labels[i + W] : 0;
        if (l) {
          const edge = nl !== l || nr !== l || nu !== l || nd !== l;
          if (edge) {
            const sel = l === selIdx;
            d[i * 4] = sel ? 255 : 20; d[i * 4 + 1] = sel ? 45 : 20; d[i * 4 + 2] = sel ? 149 : 24; d[i * 4 + 3] = 255;
          } else if (l === selIdx) {
            d[i * 4] = 255; d[i * 4 + 1] = 45; d[i * 4 + 2] = 149; d[i * 4 + 3] = 40;
          }
        } else if (nl || nr || nu || nd) {
          d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = 255;
          d[i * 4 + 3] = 230;
        }
      }
    }
    g.putImageData(img, 0, 0);
    const r = Math.max(11, W / 46);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `700 ${Math.round(r * 1.05)}px system-ui, sans-serif`;
    blobs.forEach((b, i) => {
      const hex = labToHex(b.lab);
      g.beginPath();
      g.arc(b.cx, b.cy, r, 0, Math.PI * 2);
      g.fillStyle = hex;
      g.fill();
      g.lineWidth = 3;
      g.strokeStyle = '#fff';
      g.stroke();
      g.lineWidth = 1;
      g.strokeStyle = '#111';
      g.stroke();
      g.fillStyle = contrastInk(hex);
      g.fillText(String(i + 1), b.cx, b.cy + 1);
    });
  }, [labels, blobs, selected, sheet]);

  // ---------- interactions ----------
  const onTap = async (u: number, v: number) => {
    if (!sheet || busy) return;
    const W = sheet.preview.width, H = sheet.preview.height;
    const x = Math.min(W - 1, Math.max(0, Math.floor(u * W)));
    const y = Math.min(H - 1, Math.max(0, Math.floor(v * H)));
    if (tapPaper) {
      setTapPaper(false);
      setBusy(true);
      try {
        await prepare([x, y]);
        await detect(fgThreshold, blobs);
      } finally {
        setBusy(false);
      }
      return;
    }
    const hit = labels?.[y * W + x] ?? 0;
    if (hit > 0) {
      setSelected(blobs[hit - 1].uid);
      return;
    }
    setBusy(true);
    try {
      const r = await call('sheetGrow', { x, y, tolerance: growTol, mode: 'median', fgThreshold, coreRadius: D.coreRadius });
      if (!r) return;
      const nb = withUid(r.blob);
      commit(readingOrder([...blobs, nb]));
      setSelected(nb.uid);
      setNotice(r.capped ? 'That region grew to a quarter of the image and was stopped. Lower the tolerance.' : null);
    } catch (e) {
      showToast(String(e));
    } finally {
      setBusy(false);
    }
  };

  const sel = blobs.find((b) => b.uid === selected) ?? null;
  const replace = (uid: number, nb: UiBlob, history: boolean) => {
    const next = blobs.map((b) => (b.uid === uid ? nb : b));
    if (history) commit(next);
    else setBlobs(next);
  };

  const setMode = async (mode: SampleMode) => {
    if (!sel) return;
    const r = await callStrict('sheetSample', { pixels: sel.pixels, mode, coreRadius: D.coreRadius });
    replace(sel.uid, { ...withUid(r.blob, sel), seed: sel.seed, manual: sel.manual }, true);
  };

  const regrow = async (tolerance: number) => {
    if (!sel) return;
    live.current ??= blobs;
    const r = await call('sheetGrow', { x: sel.seed[0], y: sel.seed[1], tolerance, mode: sel.mode, fgThreshold, coreRadius: D.coreRadius });
    if (!r) return;
    setBlobs((cur) => cur.map((b) => (b.uid === sel.uid ? { ...withUid(r.blob, b), manual: true, seed: sel.seed } : b)));
    setNotice(r.capped ? 'Stopped at a quarter of the image. Lower the tolerance.' : null);
  };
  const regrowDone = () => {
    if (live.current) {
      setUndo((u) => [...u.slice(-49), live.current!]);
      setRedo([]);
      live.current = null;
    }
  };

  const split = async () => {
    if (!sel) return;
    const r = await callStrict('sheetSplit', { pixels: sel.pixels, coreRadius: D.coreRadius });
    if (!r.blobs) {
      showToast('No clear split: this swatch looks like one colour.');
      return;
    }
    const parts = r.blobs.map((b, i) => (i === 0 ? { ...withUid(b, sel), manual: true } : { ...withUid(b), manual: true }));
    commit(readingOrder([...blobs.filter((b) => b.uid !== sel.uid), ...parts]));
    setSelected(null);
  };

  const merge = async (otherUid: number) => {
    const other = blobs.find((b) => b.uid === otherUid);
    if (!sel || !other) return;
    const px = Array.from(new Set([...sel.pixels, ...other.pixels]));
    const r = await callStrict('sheetSample', { pixels: Int32Array.from(px), mode: sel.mode, coreRadius: D.coreRadius });
    const merged = { ...withUid(r.blob, sel), manual: true, seed: sel.seed };
    commit(readingOrder([...blobs.filter((b) => b.uid !== sel.uid && b.uid !== other.uid), merged]));
    setSelected(merged.uid);
  };

  const remove = () => {
    if (!sel) return;
    commit(blobs.filter((b) => b.uid !== sel.uid));
    setSelected(null);
  };

  const scheduleDetect = (thr: number) => {
    clearTimeout(detectTimer.current);
    detectTimer.current = setTimeout(() => void detect(thr, blobs), 160);
  };

  // ---------- render ----------
  if (stage !== 'edit' || !sheet) {
    return (
      <>
        <div class="topbar">
          <button class="btn ghost" aria-label="Back" onClick={() => navigate({ tab: 'palettes', view: addTo ? { kind: 'edit', id: addTo } : { kind: 'list' } })}><IconBack /></button>
          <h1>New palette from a swatch sheet</h1>
        </div>
        <div class="scroll">
          <div class="stack">
            <p>Photograph or scan one sheet with a blob of each ink, paint, marker or pencil on the paper you will paint on. Handwritten labels beside the blobs are fine.</p>
            <p class="muted">Tip: a flatbed scan is best. Otherwise use even daylight, no flash, and shoot straight on.</p>
            <div class="row wrap">
              <button class="btn primary" disabled={stage === 'loading'} onClick={() => pickRef.current?.click()}>Choose image</button>
              <button class="btn" disabled={stage === 'loading'} onClick={() => camRef.current?.click()}>Camera</button>
              {stage === 'loading' && <Spinner />}
            </div>
            <input ref={pickRef} type="file" accept="image/*" hidden onChange={onFile} />
            <input ref={camRef} type="file" accept="image/*" capture="environment" hidden onChange={onFile} />
          </div>
        </div>
      </>
    );
  }

  const aspect = sheet.preview.width / sheet.preview.height;
  const paperHex = paper ? labToHex(paper) : '#ffffff';

  return (
    <>
      <div class="topbar">
        <button class="btn ghost" aria-label="Back" onClick={() => navigate({ tab: 'palettes', view: addTo ? { kind: 'edit', id: addTo } : { kind: 'list' } })}><IconBack /></button>
        <h1>{blobs.length} swatch{blobs.length === 1 ? '' : 'es'}</h1>
        {busy && <Spinner />}
        <button class="btn primary small" disabled={blobs.length === 0 && !paper} onClick={() => setSaving(true)}>Save</button>
      </div>

      <div style={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <ZoomPan aspect={aspect} onTap={(u, v) => void onTap(u, v)} resetKey={sheet}>
          <canvas ref={baseRef} />
          <canvas ref={overlayRef} />
        </ZoomPan>
        {tapPaper && <div class="floating-note">Tap a patch of bare paper</div>}
        {notice && !tapPaper && <div class="floating-note">{notice}</div>}
      </div>

      <div class="drawer">
        <div class="drawer-tabs">
          <button aria-label="Undo" disabled={undo.length === 0} onClick={doUndo}><IconUndo style={{ width: 18, height: 18, verticalAlign: -4 }} /></button>
          <button aria-label="Redo" disabled={redo.length === 0} onClick={doRedo}><IconRedo style={{ width: 18, height: 18, verticalAlign: -4 }} /></button>
          <button onClick={() => void detect()}>Re-detect</button>
          <button aria-selected={tapPaper} onClick={() => { setTapPaper(!tapPaper); setSelected(null); }}>
            Tap paper <span class="chip" style={{ background: paperHex, display: 'inline-block', verticalAlign: -4 }} />
          </button>
          <button aria-selected={showSettings} onClick={() => setShowSettings(!showSettings)}>Settings</button>
        </div>
        <div class="drawer-body">
          <div class="row wrap" style={{ marginBottom: 8 }}>
            {blobs.map((b, i) => (
              <button key={b.uid} class="chipbtn" aria-pressed={true} style={{ borderColor: b.uid === selected ? 'var(--accent)' : 'transparent', opacity: 1 }} onClick={() => setSelected(b.uid)}>
                <span class="chip" style={{ background: labToHex(b.lab) }} />
                <span class="code">{i + 1}</span>
                {b.spread > D.spreadWarning && <IconWarn class="warn" style={{ width: 14, height: 14 }} />}
              </button>
            ))}
            {blobs.length === 0 && <span class="muted">Nothing detected yet. Tap a swatch on the image to add it.</span>}
          </div>

          {showSettings && (
            <div class="stack" style={{ marginBottom: 8 }}>
              <Slider label="Detection sensitivity (ΔE from paper)" value={fgThreshold} min={D.fgThreshold.min} max={D.fgThreshold.max} reset={D.fgThreshold.default}
                onInput={(v) => { setFgThreshold(v); scheduleDetect(v); }} hint="Lower finds paler swatches" />
              <Slider label="Tap tolerance" value={growTol} min={D.growTolerance.min} max={D.growTolerance.max} reset={D.growTolerance.default} onInput={setGrowTol} hint="How far a tapped region may spread" />
              <label class="check">
                <input type="checkbox" checked={wb} onChange={async (e) => {
                  const v = (e.target as HTMLInputElement).checked;
                  setWb(v);
                  setBusy(true);
                  try { await prepare(undefined, v); await detect(fgThreshold, blobs); } finally { setBusy(false); }
                }} />
                <span>White balance to the paper<br /><span class="muted small">For white paper under warm or cool light. Leave off for scans and coloured paper.</span></span>
              </label>
              <p class="muted small" style={{ margin: 0 }}>Tip: a flatbed scan is best. Otherwise use even daylight, no flash, and shoot straight on.</p>
            </div>
          )}

          {sel && (
            <div class="card" style={{ padding: 12 }}>
              <div class="stack">
                <div class="row">
                  <span class="chip lg" style={{ background: labToHex(sel.lab) }} />
                  <div class="grow">
                    <b>{labToHex(sel.lab)}</b>
                    {sel.spread > D.spreadWarning && <div class="warn small"><IconWarn style={{ width: 14, height: 14, verticalAlign: -2 }} /> Uneven colour (spread {sel.spread.toFixed(1)}): granulating or a graded wash.</div>}
                  </div>
                  <button class="btn small danger" aria-label="Delete swatch" onClick={remove}><IconTrash /></button>
                </div>
                <input type="text" placeholder={`Swatch ${blobs.findIndex((b) => b.uid === sel.uid) + 1}`} value={sel.name ?? ''} aria-label="Name"
                  onInput={(e) => replace(sel.uid, { ...sel, name: (e.target as HTMLInputElement).value }, false)} />
                <Segmented<SampleMode> value={sel.mode} label="Sampling" onChange={(m) => void setMode(m)}
                  options={[{ value: 'median', label: 'Median' }, { value: 'masstone', label: 'Masstone' }, { value: 'tint', label: 'Tint' }]} />
                <Slider label="Region tolerance" value={growTol} min={D.growTolerance.min} max={D.growTolerance.max}
                  onInput={(v) => { setGrowTol(v); void regrow(v); }} onChange={regrowDone} />
                <div class="row">
                  <button class="btn grow" onClick={() => void split()}>Split</button>
                  <select class="grow" value="" aria-label="Merge with" onChange={(e) => { const v = Number((e.target as HTMLSelectElement).value); (e.target as HTMLSelectElement).value = ''; if (v) void merge(v); }}>
                    <option value="">Merge with…</option>
                    {blobs.filter((b) => b.uid !== sel.uid).map((b) => <option key={b.uid} value={b.uid}>Swatch {blobs.indexOf(b) + 1}</option>)}
                  </select>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {saving && (
        <SaveSheet
          blobs={blobs}
          paper={paper}
          sheet={sheet}
          wb={wb}
          addTo={addTo}
          onClose={() => setSaving(false)}
        />
      )}
    </>
  );
}

function SaveSheet({ blobs, paper, sheet, wb, addTo, onClose }: {
  blobs: UiBlob[];
  paper: Lab | null;
  sheet: SheetState;
  wb: boolean;
  addTo?: string;
  onClose: () => void;
}) {
  const [target, setTarget] = useState<'new' | 'existing'>(addTo ? 'existing' : 'new');
  const [name, setName] = useState('My palette');
  const [substrate, setSubstrate] = useState('');
  const [existingId, setExistingId] = useState<string>(addTo ?? palettes.value[0]?.id ?? '');
  const [includePaper, setIncludePaper] = useState(true);
  const [working, setWorking] = useState(false);

  const save = async () => {
    setWorking(true);
    try {
      const scale = sheet.fullWidth / sheet.preview.width;
      const existing: Palette | undefined = target === 'existing' ? palettes.value.find((p) => p.id === existingId) : undefined;
      if (target === 'existing' && !existing) {
        showToast('Choose a palette to add to.');
        return;
      }
      const base: Palette = existing ?? newPalette(name.trim() || 'My palette', substrate.trim() || undefined);
      // a palette keeps a single sheet image; samples from a different sheet would point at the wrong place
      const keepSamples = !existing || !existing.sheetImageId;
      const colors: PaletteColor[] = base.colors.slice();
      const ordered = readingOrder(blobs);
      ordered.forEach((b, i) => {
        colors.push(
          makeColorFromLab(b.lab, colors, {
            name: b.name?.trim() || `Swatch ${i + 1}`,
            ...(keepSamples ? { sample: { cx: b.cx * scale, cy: b.cy * scale, areaPx: b.areaPx * scale * scale, spread: b.spread, mode: b.mode, wb } } : {}),
          }),
        );
      });
      if (includePaper && paper && !colors.some((c) => c.isPaper)) {
        colors.push(makeColorFromLab(paper, colors, { name: 'Paper', isPaper: true }));
      }
      const next: Palette = { ...base, colors };
      if (!next.sheetImageId) next.sheetImageId = await saveSheetImage(sheet.jpeg);
      const saved = await savePalette(next);
      showToast(`Saved ${ordered.length} colour${ordered.length === 1 ? '' : 's'} to “${saved.name}”`);
      navigate({ tab: 'palettes', view: { kind: 'edit', id: saved.id } });
    } catch (e) {
      showToast(`Could not save: ${e instanceof Error ? e.message : String(e)}`, 5000);
    } finally {
      setWorking(false);
    }
  };

  return (
    <Sheet title="Save palette" onClose={onClose}>
      <div class="stack">
        <Segmented<'new' | 'existing'> value={target} onChange={setTarget}
          options={[{ value: 'new', label: 'New palette' }, { value: 'existing', label: 'Add to existing' }]} />
        {target === 'new' ? (
          <>
            <label class="field">Name<input type="text" value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} /></label>
            <label class="field">Paper or medium (optional)<input type="text" placeholder="Kraft card, gouache" value={substrate} onInput={(e) => setSubstrate((e.target as HTMLInputElement).value)} /></label>
          </>
        ) : palettes.value.length === 0 ? (
          <p class="muted">You have no palettes yet. Save as a new one.</p>
        ) : (
          <label class="field">Palette
            <select value={existingId} onChange={(e) => setExistingId((e.target as HTMLSelectElement).value)}>
              {palettes.value.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.colors.length})</option>)}
            </select>
          </label>
        )}
        <label class="check">
          <input type="checkbox" checked={includePaper} onChange={(e) => setIncludePaper((e.target as HTMLInputElement).checked)} disabled={!paper} />
          <span>Include paper as a colour{paper && <span class="chip" style={{ background: labToHex(paper), display: 'inline-block', marginLeft: 8, verticalAlign: -4 }} />}</span>
        </label>
        <p class="muted small" style={{ margin: 0 }}>Colours are named “Swatch 1 … n” in reading order. Rename them in the palette editor.</p>
        <div class="row">
          <button class="btn grow" onClick={onClose}>Cancel</button>
          <button class="btn primary grow" disabled={working || (target === 'existing' && !existingId)} onClick={() => void save()}>{working ? <Spinner /> : 'Save'}</button>
        </div>
      </div>
    </Sheet>
  );
}
