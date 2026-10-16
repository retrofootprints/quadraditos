import { useRef, useState } from 'preact/hooks';
import type { ViewMode } from '../../core/types';
import { activePalette, settings, updateStudio } from '../../storage/store';
import { Segmented, Spinner } from '../common/controls';
import { IconCamera, IconImage } from '../common/icons';
import { ZoomPan } from '../common/ZoomPan';
import { MatchedCanvas, RgbaCanvas } from './canvases';
import { CropEditor } from './CropEditor';
import {
  AdjustPanel, ColoursPanel, CropPanel, ExportPanel, GridPanel, PhotoPanel, TunePanel,
} from './panels';
import {
  grid, holdOriginal, loadPhotoFile, loading, photo, photoVersion, renderError, rendering, workingPreview,
} from './controller';
import { navigate } from '../nav';

type DrawerTab = 'photo' | 'crop' | 'grid' | 'adjust' | 'colours' | 'tune' | 'export';
const TABS: { id: DrawerTab; label: string }[] = [
  { id: 'photo', label: 'Photo' },
  { id: 'crop', label: 'Crop' },
  { id: 'grid', label: 'Grid' },
  { id: 'adjust', label: 'Adjust' },
  { id: 'colours', label: 'Colours' },
  { id: 'tune', label: 'Tune' },
  { id: 'export', label: 'Export' },
];

const VIEWS: { value: ViewMode; label: string }[] = [
  { value: 'original', label: 'Original' },
  { value: 'adjusted', label: 'Adjusted' },
  { value: 'pixelated', label: 'Pixelated' },
  { value: 'matched', label: 'Matched' },
];

function ImageArea({ cropping }: { cropping: boolean }) {
  const s = settings.value.studio;
  const prev = workingPreview.value;
  const g = grid.value;
  const view: ViewMode = holdOriginal.value ? 'original' : s.view;
  if (cropping) return <CropEditor />;
  if (!prev) return null;

  let aspect = prev.width / prev.height;
  let content;
  if (view === 'original') {
    content = <RgbaCanvas img={prev} />;
  } else if (view === 'adjusted') {
    content = <RgbaCanvas img={g?.adjusted ?? prev} />;
  } else if (view === 'pixelated') {
    content = g?.pixelated ? <RgbaCanvas img={g.pixelated} pixelated /> : <RgbaCanvas img={prev} />;
    if (g?.pixelated) aspect = g.cols / g.rows;
  } else {
    content = g ? <MatchedCanvas /> : <RgbaCanvas img={prev} />;
    if (g) aspect = g.cols / g.rows;
  }
  return (
    <ZoomPan aspect={aspect} resetKey={`${photoVersion.value}|${view}`} onHold={(h) => (holdOriginal.value = h)}>
      {content}
    </ZoomPan>
  );
}

export function StudioTab() {
  const [tab, setTab] = useState<DrawerTab>('photo');
  const [collapsed, setCollapsed] = useState(false);
  const pick = useRef<HTMLInputElement>(null);
  const cam = useRef<HTMLInputElement>(null);
  const s = settings.value.studio;
  const p = photo.value;
  const pal = activePalette.value;
  const onFile = (e: Event) => {
    const input = e.target as HTMLInputElement;
    const f = input.files?.[0];
    input.value = '';
    if (f) void loadPhotoFile(f);
  };

  return (
    <>
      <div class="topbar">
        <h1>Studio{pal ? ` · ${pal.name}` : ''}</h1>
        {(loading.value || rendering.value) && <Spinner />}
      </div>

      {!p ? (
        <div class="scroll">
          <div class="empty">
            <IconImage style={{ width: 48, height: 48 }} />
            <div>
              <b>Pick a photo to pixelate</b>
              <div class="muted">It is matched to the colours in your active palette. Nothing leaves your device.</div>
            </div>
            {!pal && (
              <div class="card" style={{ padding: 12 }}>
                <div class="warn">You have no palette yet.</div>
                <button class="btn primary" style={{ marginTop: 8 }} onClick={() => navigate({ tab: 'palettes', view: { kind: 'list' } })}>Go to Palettes</button>
              </div>
            )}
            <div class="row wrap" style={{ justifyContent: 'center' }}>
              <button class="btn primary" onClick={() => pick.current?.click()}><IconImage /> Choose photo</button>
              <button class="btn" onClick={() => cam.current?.click()}><IconCamera /> Camera</button>
            </div>
            <input ref={pick} type="file" accept="image/*" hidden onChange={onFile} />
            <input ref={cam} type="file" accept="image/*" capture="environment" hidden onChange={onFile} />
          </div>
        </div>
      ) : (
        <>
          <div style={{ padding: '8px 12px 0' }}>
            <Segmented<ViewMode> value={s.view} label="View" options={VIEWS} onChange={(v) => updateStudio({ view: v })} />
          </div>
          <div style={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            <ImageArea cropping={tab === 'crop'} />
            {renderError.value && <div class="floating-note">{renderError.value}</div>}
            {holdOriginal.value && <div class="floating-note">Original</div>}
          </div>
        </>
      )}

      {p && (
        <div class={`drawer ${collapsed ? 'collapsed' : ''}`}>
          <div class="drawer-tabs" role="tablist">
            {TABS.map((t) => (
              <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => { setTab(t.id); setCollapsed(false); }}>{t.label}</button>
            ))}
            <button aria-label={collapsed ? 'Show controls' : 'Hide controls'} onClick={() => setCollapsed(!collapsed)}>{collapsed ? '▲' : '▼'}</button>
          </div>
          <div class="drawer-body">
            {tab === 'photo' && <PhotoPanel />}
            {tab === 'crop' && <CropPanel onDone={() => setTab('grid')} />}
            {tab === 'grid' && <GridPanel />}
            {tab === 'adjust' && <AdjustPanel />}
            {tab === 'colours' && <ColoursPanel />}
            {tab === 'tune' && <TunePanel />}
            {tab === 'export' && <ExportPanel />}
          </div>
        </div>
      )}
    </>
  );
}
