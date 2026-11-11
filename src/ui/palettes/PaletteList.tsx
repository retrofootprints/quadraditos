import { useRef, useState } from 'preact/hooks';
import type { Palette } from '../../core/types';
import { newPalette } from '../../core/palette';
import { paletteFromPreset, presets, type Preset } from '../../core/presets';
import {
  applyImport, duplicatePalette, exportPalettesJson, palettes, prepareImport, removePalette, savePalette, setActive, settings,
} from '../../storage/store';
import { Sheet, showToast, shareOrDownload } from '../common/controls';
import { IconMore, IconPlus } from '../common/icons';
import { navigate } from '../nav';

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'palette';

async function exportJson(ids: string[], name: string) {
  const includeImages = palettes.value.some((p) => ids.includes(p.id) && p.sheetImageId)
    ? confirm('Include the swatch-sheet image(s) in the export? This makes the file larger, but lets you re-sample later.')
    : false;
  const text = await exportPalettesJson(ids, includeImages);
  const r = await shareOrDownload(new Blob([text], { type: 'application/json' }), `${slug(name)}.swatches.json`);
  if (r === 'downloaded') showToast('Saved to your downloads');
}

export function PaletteList() {
  const list = palettes.value;
  const active = settings.value.activePaletteId;
  const [menu, setMenu] = useState<Palette | null>(null);
  const [creating, setCreating] = useState(false);
  const importRef = useRef<HTMLInputElement>(null);

  const doImport = async (e: Event) => {
    const input = e.target as HTMLInputElement;
    const f = input.files?.[0];
    input.value = '';
    if (!f) return;
    try {
      const session = prepareImport(await f.text());
      const overwrite: string[] = [];
      for (const c of session.plan.conflicts) {
        if (confirm(`“${c.existing.name}” already exists on this device. Replace it with the imported version?`)) overwrite.push(c.incoming.id);
      }
      const n = await applyImport(session, overwrite);
      showToast(n === 0 ? 'Nothing was imported.' : `Imported ${n} palette${n === 1 ? '' : 's'}.`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), 5000);
    }
  };

  const createEmpty = async () => {
    const name = prompt('Name the new palette', 'My palette');
    if (!name?.trim()) return;
    const p = await savePalette(newPalette(name.trim()));
    setCreating(false);
    navigate({ tab: 'palettes', view: { kind: 'edit', id: p.id } });
  };

  const addPreset = async (preset: Preset) => {
    const p = await savePalette(paletteFromPreset(preset));
    setCreating(false);
    showToast(`Added “${p.name}” (${p.colors.length} colours)`);
  };

  return (
    <>
      <div class="topbar">
        <h1>Palettes</h1>
        <button class="btn small" onClick={() => importRef.current?.click()}>Import</button>
        {list.length > 1 && <button class="btn small" onClick={() => void exportJson(list.map((p) => p.id), 'all-palettes')}>Export all</button>}
        <button class="btn primary small" onClick={() => setCreating(true)}><IconPlus /> New</button>
        <input ref={importRef} type="file" accept=".json,application/json" hidden onChange={doImport} />
      </div>
      <div class="scroll">
        {list.length === 0 ? (
          <div class="empty">
            <div><b>No palettes yet</b><div class="muted">A palette is the set of paints, inks or pencils you own. Photograph a sheet of swatches to create one.</div></div>
            <button class="btn primary" onClick={() => setCreating(true)}><IconPlus /> New palette</button>
          </div>
        ) : (
          <div class="stack">
            {list.map((p) => (
              <div key={p.id} class={`card palette-row ${p.id === active ? 'active' : ''}`}>
                <div class="row">
                  <button class="grow btn ghost" style={{ justifyContent: 'flex-start', padding: 0, minHeight: 44, textAlign: 'left' }} onClick={() => navigate({ tab: 'palettes', view: { kind: 'edit', id: p.id } })}>
                    <b style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</b>
                  </button>
                  {p.id === active && <span class="badge">Active</span>}
                  <button class="btn ghost" aria-label={`Actions for ${p.name}`} onClick={() => setMenu(p)}><IconMore /></button>
                </div>
                <div class="chips" onClick={() => navigate({ tab: 'palettes', view: { kind: 'edit', id: p.id } })}>
                  {p.colors.slice(0, 40).map((c) => <span key={c.id} class="chip" style={{ background: c.hex, opacity: c.enabled ? 1 : 0.35 }} title={c.name} />)}
                  {p.colors.length === 0 && <span class="muted small">Empty</span>}
                </div>
                <div class="muted small">
                  {p.colors.length} colour{p.colors.length === 1 ? '' : 's'}{p.substrate ? ` · ${p.substrate}` : ''} · updated {new Date(p.updatedAt).toLocaleDateString()}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {creating && (
        <Sheet title="New palette" onClose={() => setCreating(false)}>
          <div class="actions">
            <button class="btn primary" onClick={() => navigate({ tab: 'palettes', view: { kind: 'extract' } })}>From swatch sheet</button>
            <button class="btn" onClick={() => void createEmpty()}>Empty (add colours by hand)</button>
          </div>
          <div class="muted small" style={{ margin: '12px 0 6px' }}>Built-in presets</div>
          <div class="actions">
            {presets.map((pr) => (
              <button key={pr.key} class="btn" onClick={() => void addPreset(pr)}>
                <span class="chips" style={{ marginRight: 8 }}>
                  {pr.colors.slice(0, 6).map((c) => <span key={c.hex} class="chip" style={{ background: c.hex }} />)}
                </span>
                {pr.name} ({pr.colors.length})
              </button>
            ))}
          </div>
        </Sheet>
      )}

      {menu && (
        <Sheet title={menu.name} onClose={() => setMenu(null)}>
          <div class="actions">
            <button class="btn" onClick={() => { navigate({ tab: 'palettes', view: { kind: 'edit', id: menu.id } }); setMenu(null); }}>Open</button>
            <button class="btn" disabled={menu.id === active} onClick={() => { setActive(menu.id); setMenu(null); }}>Set as active</button>
            <button class="btn" onClick={async () => { await duplicatePalette(menu.id); setMenu(null); }}>Duplicate</button>
            <button class="btn" onClick={async () => {
              const name = prompt('Rename palette', menu.name);
              if (name?.trim()) await savePalette({ ...menu, name: name.trim() });
              setMenu(null);
            }}>Rename</button>
            <button class="btn" onClick={async () => { const m = menu; setMenu(null); await exportJson([m.id], m.name); }}>Export JSON</button>
            <button class="btn danger" onClick={async () => {
              if (confirm(`Delete “${menu.name}”? This cannot be undone.`)) await removePalette(menu.id);
              setMenu(null);
            }}>Delete</button>
          </div>
        </Sheet>
      )}
    </>
  );
}
