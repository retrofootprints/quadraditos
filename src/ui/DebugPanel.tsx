import { useEffect, useRef, useState } from 'preact/hooks';
import { config } from '../config';
import { Sheet } from './common/controls';
import { debugData, debugOpen } from './debug';

/** Hidden panel (tap the version number five times): detection masks, timings and the config in force. */
export function DebugPanel() {
  const d = debugData.value;
  const mask = useRef<HTMLCanvasElement>(null);
  const [persisted, setPersisted] = useState<string>('unknown');

  useEffect(() => {
    navigator.storage?.persisted?.().then((p) => setPersisted(p ? 'yes' : 'no')).catch(() => {});
  }, []);

  useEffect(() => {
    const c = mask.current;
    const det = d.detect;
    if (!c || !det) return;
    c.width = det.width;
    c.height = det.height;
    const g = c.getContext('2d')!;
    const img = g.createImageData(det.width, det.height);
    for (let i = 0; i < det.fg.length; i++) {
      const v = det.core[i] ? [60, 220, 120] : det.fg[i] ? [230, 230, 230] : [20, 20, 24];
      img.data[i * 4] = v[0];
      img.data[i * 4 + 1] = v[1];
      img.data[i * 4 + 2] = v[2];
      img.data[i * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  }, [d.detect]);

  return (
    <Sheet title="Debug" onClose={() => (debugOpen.value = false)}>
      <div class="stack">
        <div class="muted small">Version {config.version} · persistent storage: {persisted}</div>
        <h3>Last render</h3>
        <pre class="debug">{JSON.stringify({ grid: d.renderCells, ms: d.render }, null, 1)}</pre>
        <h3>Last detection</h3>
        {d.detect ? (
          <>
            <div class="muted small">{d.detect.blobs} blobs · {JSON.stringify(d.detect.timings)} ms · grey = foreground, green = eroded core</div>
            <canvas ref={mask} class="debug" />
          </>
        ) : <div class="muted">No detection run yet.</div>}
        <h3>Config</h3>
        <pre class="debug">{JSON.stringify(config, null, 1)}</pre>
      </div>
    </Sheet>
  );
}
