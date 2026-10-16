import { useRef, useState } from 'preact/hooks';
import { config } from '../../config';
import { hexToLab, normaliseHex } from '../../core/color';
import { isCodeTaken, makeColor, nearDuplicates, nextFreeCode, reassignCodes } from '../../core/palette';
import type { Palette, PaletteColor } from '../../core/types';
import { palettes, savePalette, setActive, settings } from '../../storage/store';
import { showToast } from '../common/controls';
import { IconBack, IconPlus, IconTrash, IconWarn } from '../common/icons';
import { navigate } from '../nav';
import { Resampler } from './Resampler';

export function PaletteEditor({ id }: { id: string }) {
  const palette = palettes.value.find((p) => p.id === id);
  const [order, setOrder] = useState<PaletteColor[] | null>(null); // live order while dragging
  const [dragId, setDragId] = useState<string | null>(null);
  const [resample, setResample] = useState<PaletteColor | null>(null);
  const [newHex, setNewHex] = useState('#808080');
  const rows = useRef(new Map<string, HTMLElement>());

  if (!palette) {
    return (
      <>
        <div className="topbar">
          <button class="btn ghost" aria-label="Back" onClick={() => navigate({ tab: 'palettes', view: { kind: 'list' } })}><IconBack /></button>
          <h1>Palette not found</h1>
        </div>
      </>
    );
  }

  const colors = order ?? palette.colors;
  const dups = nearDuplicates(palette.colors);
  const save = (patch: Partial<Palette>) => savePalette({ ...palette, ...patch });
  const setColor = (cid: string, patch: Partial<PaletteColor>) =>
    save({ colors: palette.colors.map((c) => (c.id === cid ? { ...c, ...patch } : c)) });

  const addColor = () => {
    const c = makeColor(newHex, palette.colors);
    if (!c) {
      showToast('That is not a valid hex colour, e.g. #3a4b7c');
      return;
    }
    void save({ colors: [...palette.colors, c] });
  };

  const setHex = (c: PaletteColor, hex: string) => {
    const norm = normaliseHex(hex);
    const lab = norm ? hexToLab(norm) : null;
    if (!norm || !lab) {
      showToast('That is not a valid hex colour.');
      return false;
    }
    void setColor(c.id, { hex: norm, lab });
    return true;
  };

  const setCode = (c: PaletteColor, code: string): boolean => {
    const v = code.trim();
    if (!v) return false;
    if (isCodeTaken(palette.colors, v, c.id)) {
      showToast(`Code “${v}” is already used by another colour.`);
      return false;
    }
    void setColor(c.id, { code: v });
    return true;
  };

  const setPaper = (c: PaletteColor, on: boolean) => {
    const next = palette.colors.map((x) => {
      if (x.id === c.id) {
        const others = palette.colors.filter((y) => y.id !== x.id);
        return on
          ? { ...x, isPaper: true, code: config.palette.defaultPaperCode }
          : { ...x, isPaper: undefined, code: nextFreeCode(others) };
      }
      if (on && x.isPaper) return { ...x, isPaper: undefined, code: nextFreeCode(palette.colors.filter((y) => y.id !== x.id && y.id !== c.id)) };
      return x;
    });
    void save({ colors: next });
  };

  // ----- drag to reorder -----
  const onHandleDown = (e: PointerEvent, c: PaletteColor) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDragId(c.id);
    setOrder(palette.colors);
  };
  const onHandleMove = (e: PointerEvent) => {
    if (!dragId || !order) return;
    let target = order.findIndex((c) => {
      const el = rows.current.get(c.id);
      if (!el) return false;
      const r = el.getBoundingClientRect();
      return e.clientY >= r.top && e.clientY <= r.bottom;
    });
    if (target < 0) return;
    const from = order.findIndex((c) => c.id === dragId);
    if (from === target) return;
    const next = order.slice();
    const [m] = next.splice(from, 1);
    next.splice(target, 0, m);
    setOrder(next);
  };
  const onHandleUp = () => {
    if (order && dragId) void save({ colors: order });
    setDragId(null);
    setOrder(null);
  };

  const isActive = settings.value.activePaletteId === palette.id;

  return (
    <>
      <div class="topbar">
        <button class="btn ghost" aria-label="Back" onClick={() => navigate({ tab: 'palettes', view: { kind: 'list' } })}><IconBack /></button>
        <h1>{palette.name}</h1>
        {isActive ? <span class="badge">Active</span> : <button class="btn small" onClick={() => setActive(palette.id)}>Use</button>}
      </div>
      <div class="scroll">
        <div class="stack">
          <label class="field">Name
            <input key={palette.updatedAt + 'n'} type="text" defaultValue={palette.name} onChange={(e) => { const v = (e.target as HTMLInputElement).value.trim(); if (v) void save({ name: v }); }} />
          </label>
          <label class="field">Paper or medium
            <input type="text" placeholder="Kraft card, gouache…" defaultValue={palette.substrate ?? ''} onChange={(e) => void save({ substrate: (e.target as HTMLInputElement).value.trim() || undefined })} />
          </label>
          <label class="field">Notes
            <textarea defaultValue={palette.notes ?? ''} onChange={(e) => void save({ notes: (e.target as HTMLTextAreaElement).value || undefined })} />
          </label>

          <div class="row">
            <h3 class="grow" style={{ margin: 0 }}>{palette.colors.length} colours</h3>
            <button class="btn small" onClick={() => navigate({ tab: 'palettes', view: { kind: 'extract', addTo: palette.id } })}>Add from sheet</button>
            <button class="btn small" onClick={() => void save({ colors: reassignCodes(palette.colors) })} title="Re-letter A, B, C… in list order">Re-letter</button>
          </div>

          <div class="stack" style={{ gap: 8 }}>
            {colors.map((c) => (
              <div key={c.id} ref={(el) => { if (el) rows.current.set(c.id, el); else rows.current.delete(c.id); }}
                class={`card color-row ${dragId === c.id ? 'dragging' : ''}`}>
                <div class="handle" role="button" aria-label="Drag to reorder"
                  onPointerDown={(e) => onHandleDown(e, c)} onPointerMove={onHandleMove} onPointerUp={onHandleUp} onPointerCancel={onHandleUp}>≡</div>
                <input type="color" value={c.hex} aria-label={`Colour of ${c.name}`} onChange={(e) => setHex(c, (e.target as HTMLInputElement).value)} />
                <input key={c.name} type="text" defaultValue={c.name} aria-label="Name" onChange={(e) => { const v = (e.target as HTMLInputElement).value.trim(); if (v) void setColor(c.id, { name: v }); }} />
                <input key={c.code} class="code-input" type="text" defaultValue={c.code} aria-label="Code" maxLength={4}
                  onChange={(e) => { const t = e.target as HTMLInputElement; if (!setCode(c, t.value)) t.value = c.code; }} />
                <div class="sub">
                  <input key={c.hex} type="text" style={{ width: 104 }} defaultValue={c.hex} aria-label="Hex" autocapitalize="off" spellcheck={false}
                    onChange={(e) => { const t = e.target as HTMLInputElement; if (!setHex(c, t.value)) t.value = c.hex; }} />
                  <label class="check" style={{ minHeight: 36 }}><input type="checkbox" checked={c.enabled} onChange={(e) => void setColor(c.id, { enabled: (e.target as HTMLInputElement).checked })} /> On</label>
                  <label class="check" style={{ minHeight: 36 }}><input type="checkbox" checked={!!c.isPaper} onChange={(e) => setPaper(c, (e.target as HTMLInputElement).checked)} /> Paper</label>
                  {palette.sheetImageId && c.sample && <button class="btn small" onClick={() => setResample(c)}>Re-sample</button>}
                  <button class="btn small danger" aria-label={`Delete ${c.name}`} onClick={() => { if (confirm(`Delete “${c.name}”?`)) void save({ colors: palette.colors.filter((x) => x.id !== c.id) }); }}><IconTrash /></button>
                  {dups.has(c.id) && (
                    <span class="warn small" style={{ flexBasis: '100%' }}>
                      <IconWarn style={{ width: 14, height: 14, verticalAlign: -2 }} /> Very close to “{dups.get(c.id)}” (ΔE under {config.palette.nearDuplicateDeltaE}): the matcher will treat them as near-duplicates.
                    </span>
                  )}
                </div>
              </div>
            ))}
            {palette.colors.length === 0 && <p class="muted">No colours yet. Add one below, or use “Add from sheet”.</p>}
          </div>

          <div class="card" style={{ padding: 12 }}>
            <div class="row">
              <input type="color" value={normaliseHex(newHex) ?? '#808080'} aria-label="Pick a colour" onChange={(e) => setNewHex((e.target as HTMLInputElement).value)} />
              <input type="text" value={newHex} aria-label="Hex" autocapitalize="off" spellcheck={false} onInput={(e) => setNewHex((e.target as HTMLInputElement).value)} />
              <button class="btn primary" onClick={addColor}><IconPlus /> Add</button>
            </div>
          </div>
        </div>
      </div>
      {resample && (
        <Resampler
          palette={palette}
          color={resample}
          onClose={() => setResample(null)}
          onApply={(nc) => { void setColor(nc.id, { hex: nc.hex, lab: nc.lab, sample: nc.sample }); setResample(null); }}
        />
      )}
    </>
  );
}
