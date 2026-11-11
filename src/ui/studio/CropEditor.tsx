import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { cropRect } from '../../core/crop';
import { settings, updateStudio } from '../../storage/store';
import { photo, sourcePreview } from './controller';
import { RgbaCanvas } from './canvases';

/** Shows the whole photo with the crop window; drag to move it. */
export function CropEditor() {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const drag = useRef<{ x: number; y: number } | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; zoom: number } | null>(null);
  const p = photo.value;
  const src = sourcePreview.value;
  const crop = settings.value.studio.crop;

  useLayoutEffect(() => {
    const el = box.current!;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  if (!p || !src) return null;
  const aspect = p.width / p.height;
  const availW = Math.max(1, size.w - 16);
  const availH = Math.max(1, size.h - 16);
  const dw = aspect > availW / availH ? availW : availH * aspect;
  const dh = aspect > availW / availH ? availW / aspect : availH;
  const rect = cropRect(crop, p.width, p.height) ?? { x: 0, y: 0, w: 1, h: 1 };

  const spread = () => {
    const [a, b] = [...pointers.current.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };

  const down = (e: PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      drag.current = null;
      pinch.current = { dist: Math.max(1, spread()), zoom: settings.value.studio.crop.zoom };
    } else if (pointers.current.size === 1) drag.current = { x: e.clientX, y: e.clientY };
  };

  const up = (e: PointerEvent) => {
    pointers.current.delete(e.pointerId);
    pinch.current = null;
    // lifting one finger of a pinch continues as a drag with the other
    const rest = [...pointers.current.values()][0];
    drag.current = rest ? { ...rest } : null;
  };

  const move = (e: PointerEvent) => {
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch.current && pointers.current.size >= 2) {
      // spreading the fingers zooms in, which makes the crop window smaller
      const zoom = Math.min(4, Math.max(1, pinch.current.zoom * (spread() / pinch.current.dist)));
      updateStudio({ crop: { ...settings.value.studio.crop, zoom } });
      return;
    }
    if (!drag.current) return;
    const dx = (e.clientX - drag.current.x) / dw;
    const dy = (e.clientY - drag.current.y) / dh;
    drag.current = { x: e.clientX, y: e.clientY };
    const cur = settings.value.studio.crop;
    const r = cropRect(cur, p.width, p.height);
    if (!r) return;
    const x = Math.min(1 - r.w, Math.max(0, r.x + dx));
    const y = Math.min(1 - r.h, Math.max(0, r.y + dy));
    updateStudio({ crop: { ...cur, cx: x + r.w / 2, cy: y + r.h / 2 } });
  };

  return (
    <div
      class="zoompan"
      ref={box}
      style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
    >
      <div style={{ position: 'relative', width: `${dw}px`, height: `${dh}px` }}>
        <div class="crop-image"><RgbaCanvas img={src} /></div>
        <div
          style={{
            position: 'absolute',
            left: `${rect.x * 100}%`,
            top: `${rect.y * 100}%`,
            width: `${rect.w * 100}%`,
            height: `${rect.h * 100}%`,
            boxShadow: '0 0 0 9999px rgba(0,0,0,0.55)',
            border: '2px solid #fff',
            outline: '1px solid rgba(0,0,0,0.6)',
            pointerEvents: 'none',
          }}
        />
      </div>
      <div class="floating-note">Drag to move · pinch to resize the crop</div>
    </div>
  );
}
