import { useEffect, useRef, useState } from 'preact/hooks';
import { config } from '../../config';
import { deltaE2000, labToHex } from '../../core/color';
import type { Blob as SwatchBlob } from '../../core/detect';
import type { Palette, PaletteColor, SampleMode } from '../../core/types';
import { loadSheetImage } from '../../storage/store';
import { call, callStrict } from '../../worker/client';
import type { PixelImage } from '../../worker/protocol';
import { Segmented, Slider, Spinner, showToast } from '../common/controls';
import { IconBack } from '../common/icons';
import { ZoomPan } from '../common/ZoomPan';

const D = config.detect;

/** Re-sample one colour from the palette's stored swatch-sheet image. */
export function Resampler({ palette, color, onApply, onClose }: {
  palette: Palette;
  color: PaletteColor;
  onApply: (c: PaletteColor) => void;
  onClose: () => void;
}) {
  const [sheet, setSheet] = useState<{ preview: PixelImage; fullWidth: number } | null>(null);
  const [blob, setBlob] = useState<SwatchBlob | null>(null);
  const [mode, setMode] = useState<SampleMode>(color.sample?.mode ?? 'median');
  const [tol, setTol] = useState<number>(D.growTolerance.default);
  const [busy, setBusy] = useState(true);
  const [marker, setMarker] = useState<[number, number] | null>(null);
  const base = useRef<HTMLCanvasElement>(null);
  const over = useRef<HTMLCanvasElement>(null);
  const lastTap = useRef<[number, number] | null>(null);

  useEffect(() => {
    (async () => {
      try {
        if (!palette.sheetImageId) throw new Error('This palette has no stored swatch sheet.');
        const img = await loadSheetImage(palette.sheetImageId);
        if (!img) throw new Error('The stored swatch sheet was not found.');
        const info = await callStrict('loadSheet', { blob: img });
        await callStrict('sheetPrepare', { whiteBalance: color.sample?.wb ?? false });
        setSheet({ preview: info.preview, fullWidth: info.fullWidth });
        if (color.sample) {
          const s = info.preview.width / info.fullWidth;
          setMarker([color.sample.cx * s, color.sample.cy * s]);
        }
      } catch (e) {
        showToast(e instanceof Error ? e.message : String(e), 5000);
        onClose();
      } finally {
        setBusy(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (!sheet || !base.current) return;
    const c = base.current;
    c.width = sheet.preview.width;
    c.height = sheet.preview.height;
    c.getContext('2d')!.putImageData(new ImageData(sheet.preview.data as Uint8ClampedArray<ArrayBuffer>, c.width, c.height), 0, 0);
  }, [sheet]);

  useEffect(() => {
    const c = over.current;
    if (!sheet || !c) return;
    c.width = sheet.preview.width;
    c.height = sheet.preview.height;
    const g = c.getContext('2d')!;
    if (blob) {
      const img = g.createImageData(c.width, c.height);
      for (let k = 0; k < blob.pixels.length; k++) {
        const i = blob.pixels[k] * 4;
        img.data[i] = 255; img.data[i + 1] = 45; img.data[i + 2] = 149; img.data[i + 3] = 110;
      }
      g.putImageData(img, 0, 0);
    }
    if (marker) {
      const r = Math.max(10, c.width / 50);
      g.lineWidth = 4;
      g.strokeStyle = '#fff';
      g.beginPath(); g.arc(marker[0], marker[1], r, 0, Math.PI * 2); g.stroke();
      g.lineWidth = 2;
      g.strokeStyle = '#111';
      g.beginPath(); g.arc(marker[0], marker[1], r, 0, Math.PI * 2); g.stroke();
    }
  }, [blob, marker, sheet]);

  const grow = async (x: number, y: number, tolerance: number, m: SampleMode) => {
    lastTap.current = [x, y];
    setBusy(true);
    try {
      const r = await call('sheetGrow', { x, y, tolerance, mode: m, fgThreshold: D.fgThreshold.default, coreRadius: D.coreRadius });
      if (r) setBlob(r.blob);
    } finally {
      setBusy(false);
    }
  };

  const apply = () => {
    if (!blob || !sheet) return;
    const scale = sheet.fullWidth / sheet.preview.width;
    onApply({
      ...color,
      lab: blob.lab,
      hex: labToHex(blob.lab),
      sample: { cx: blob.cx * scale, cy: blob.cy * scale, areaPx: blob.areaPx * scale * scale, spread: blob.spread, mode, wb: color.sample?.wb },
    });
  };

  const delta = blob ? deltaE2000(blob.lab[0], blob.lab[1], blob.lab[2], color.lab[0], color.lab[1], color.lab[2]) : 0;

  return (
    <div class="fullscreen">
      <div class="topbar">
        <button class="btn ghost" aria-label="Close" onClick={onClose}><IconBack /></button>
        <h1>Re-sample “{color.name}”</h1>
        {busy && <Spinner />}
      </div>
      <div style={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {sheet && (
          <ZoomPan aspect={sheet.preview.width / sheet.preview.height} resetKey={sheet}
            onTap={(u, v) => void grow(Math.floor(u * sheet.preview.width), Math.floor(v * sheet.preview.height), tol, mode)}>
            <canvas ref={base} />
            <canvas ref={over} />
          </ZoomPan>
        )}
        <div class="floating-note">{blob ? 'Tap elsewhere to try another spot' : 'Tap the swatch to sample it'}</div>
      </div>
      <div class="drawer">
        <div class="drawer-body" style={{ maxHeight: '45dvh' }}>
          <div class="stack">
            <div class="row">
              <span class="chip lg" style={{ background: color.hex }} title="Current" />
              <span>→</span>
              <span class="chip lg" style={{ background: blob ? labToHex(blob.lab) : 'transparent' }} title="New" />
              <div class="grow muted">{blob ? `${labToHex(blob.lab)} · ΔE ${delta.toFixed(1)} from current` : 'No sample yet'}</div>
            </div>
            <Segmented<SampleMode> value={mode} label="Sampling" options={[{ value: 'median', label: 'Median' }, { value: 'masstone', label: 'Masstone' }, { value: 'tint', label: 'Tint' }]}
              onChange={(m) => { setMode(m); if (lastTap.current) void grow(lastTap.current[0], lastTap.current[1], tol, m); }} />
            <Slider label="Tolerance" value={tol} min={D.growTolerance.min} max={D.growTolerance.max} reset={D.growTolerance.default}
              onInput={(v) => { setTol(v); if (lastTap.current) void grow(lastTap.current[0], lastTap.current[1], v, mode); }} />
            <div class="row">
              <button class="btn grow" onClick={onClose}>Cancel</button>
              <button class="btn primary grow" disabled={!blob} onClick={apply}>Use this colour</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
