import { useEffect, useRef } from 'preact/hooks';
import { config } from '../config';
import { init, markInstallHintSeen, palettes, ready, settings, storageError } from '../storage/store';
import { Toast, isStandalone } from './common/controls';
import { IconPalette, IconStudio } from './common/icons';
import { DebugPanel } from './DebugPanel';
import { debugOpen } from './debug';
import { navigate, route } from './nav';
import { Extractor } from './palettes/Extractor';
import { PaletteEditor } from './palettes/PaletteEditor';
import { PaletteList } from './palettes/PaletteList';
import { startRenderLoop } from './studio/controller';
import { StudioTab } from './studio/StudioTab';

export function App() {
  const taps = useRef({ n: 0, t: 0 });

  useEffect(() => {
    void init();
    return startRenderLoop();
  }, []);

  const onVersionTap = () => {
    const now = Date.now();
    taps.current = { n: now - taps.current.t < 1500 ? taps.current.n + 1 : 1, t: now };
    if (taps.current.n >= 5) {
      taps.current.n = 0;
      debugOpen.value = true;
    }
  };

  if (!ready.value) return <div class="app"><div class="empty">Loading…</div></div>;

  const r = route.value;
  const view = r.view ?? { kind: 'list' as const };
  const showHint = r.tab === 'palettes' && view.kind === 'list' && !settings.value.installHintSeen && !isStandalone() && palettes.value.length > 0;

  return (
    <div class="app">
      {storageError.value && <div class="banner error">{storageError.value}</div>}
      {showHint && (
        <div class="banner">
          <div class="grow">
            <b>Add to Home Screen:</b> tap Share, then “Add to Home Screen”. Installed apps keep your palettes (Safari may clear ordinary web pages’ data after about 7 days) and work offline.
            </div>
          <button class="btn small" onClick={markInstallHintSeen}>Got it</button>
        </div>
      )}
      <div class="main">
        {/* The Studio stays mounted so its state survives a trip to the Palettes tab. */}
        <div style={{ display: r.tab === 'studio' ? 'flex' : 'none', flexDirection: 'column', flex: 1, minHeight: 0 }}>
          <StudioTab />
        </div>
        {r.tab === 'palettes' && (
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
            {view.kind === 'list' && <PaletteList />}
            {view.kind === 'edit' && <PaletteEditor key={view.id} id={view.id} />}
            {view.kind === 'extract' && <Extractor key={view.addTo ?? 'new'} addTo={view.addTo} />}
          </div>
        )}
      </div>
      <nav class="tabbar" role="tablist">
        <button role="tab" aria-selected={r.tab === 'palettes'} onClick={() => navigate({ tab: 'palettes', view: r.tab === 'palettes' ? { kind: 'list' } : r.view ?? { kind: 'list' } })}>
          <IconPalette /> Palettes
        </button>
        <button role="tab" aria-selected={r.tab === 'studio'} onClick={() => navigate({ tab: 'studio' })}>
          <IconStudio /> Studio
        </button>
        <button class="version" style={{ flex: 'none', minWidth: 56, minHeight: 'var(--tabbar-h)' }} onClick={onVersionTap} aria-label="Version">v{config.version}</button>
      </nav>
      <Toast />
      {debugOpen.value && <DebugPanel />}
    </div>
  );
}
