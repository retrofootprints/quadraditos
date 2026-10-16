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

  const move = (e: PointerEvent) => {
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
      onPointerDown={(e) => {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        drag.current = { x: e.clientX, y: e.clientY };
      }}
      onPointerMove={move}
      onPointerUp={() => (drag.current = null)}
      onPointerCancel={() => (drag.current = null)}
    >
      <div style={{ position: 'relative', width: `${dw}px`, height: `${dh}px` }}>
        <RgbaCanvas img={src} />
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
      <div class="floating-note">Drag to move the crop window</div>
    </div>
  );
}
