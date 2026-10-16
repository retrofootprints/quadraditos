import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';

interface Props {
  /** Content width / height. The content is laid out to fit the container at zoom 1. */
  aspect: number;
  children: ComponentChildren;
  /** Tap position in content coordinates, 0..1. */
  onTap?: (u: number, v: number) => void;
  /** Press and hold (without moving) toggles this: used for "show the original". */
  onHold?: (holding: boolean) => void;
  maxZoom?: number;
  /** Changing this resets the view. */
  resetKey?: unknown;
}

interface Pt { x: number; y: number }

/** Pinch-zoom and pan container with tap and press-and-hold callbacks. */
export function ZoomPan({ aspect, children, onTap, onHold, maxZoom = 12, resetKey }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [view, setView] = useState({ s: 1, tx: 0, ty: 0 });
  const viewRef = useRef(view);
  viewRef.current = view;
  const pointers = useRef(new Map<number, Pt>());
  const gesture = useRef<{ startDist: number; startScale: number; startView: typeof view; centre: Pt } | null>(null);
  const tapInfo = useRef<{ x: number; y: number; t: number; moved: boolean; id: number } | null>(null);
  const holdTimer = useRef<ReturnType<typeof setTimeout>>();
  const holding = useRef(false);

  useLayoutEffect(() => {
    const el = box.current!;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // base size: contain the content in the box with a little margin
  const margin = 8;
  const availW = Math.max(1, size.w - margin * 2);
  const availH = Math.max(1, size.h - margin * 2);
  const cw = aspect > availW / availH ? availW : availH * aspect;
  const ch = aspect > availW / availH ? availW / aspect : availH;

  const fit = () => setView({ s: 1, tx: (size.w - cw) / 2, ty: (size.h - ch) / 2 });
  useEffect(fit, [size.w, size.h, cw, ch, resetKey]);

  const clampView = (v: typeof view) => {
    const s = Math.min(maxZoom, Math.max(1, v.s));
    const w = cw * s, h = ch * s;
    // keep the content from drifting out of reach
    const tx = w <= size.w ? (size.w - w) / 2 : Math.min(0, Math.max(size.w - w, v.tx));
    const ty = h <= size.h ? (size.h - h) / 2 : Math.min(0, Math.max(size.h - h, v.ty));
    return { s, tx, ty };
  };

  const local = (e: { clientX: number; clientY: number }): Pt => {
    const r = box.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const endHold = () => {
    clearTimeout(holdTimer.current);
    if (holding.current) {
      holding.current = false;
      onHold?.(false);
    }
  };

  const onPointerDown = (e: PointerEvent) => {
    box.current!.setPointerCapture(e.pointerId);
    const p = local(e);
    pointers.current.set(e.pointerId, p);
    if (pointers.current.size === 1) {
      tapInfo.current = { x: p.x, y: p.y, t: Date.now(), moved: false, id: e.pointerId };
      if (onHold) {
        clearTimeout(holdTimer.current);
        holdTimer.current = setTimeout(() => {
          if (tapInfo.current && !tapInfo.current.moved && pointers.current.size === 1) {
            holding.current = true;
            onHold(true);
          }
        }, 380);
      }
    } else if (pointers.current.size === 2) {
      endHold();
      if (tapInfo.current) tapInfo.current.moved = true;
      const [a, b] = [...pointers.current.values()];
      gesture.current = {
        startDist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
        startScale: viewRef.current.s,
        startView: viewRef.current,
        centre: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      };
    }
  };

  const onPointerMove = (e: PointerEvent) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    const p = local(e);
    pointers.current.set(e.pointerId, p);
    const g = gesture.current;
    if (pointers.current.size >= 2 && g) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const centre = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const s = Math.min(maxZoom, Math.max(1, g.startScale * (dist / g.startDist)));
      const k = s / g.startView.s;
      // keep the content point under the initial pinch centre under the current centre
      const tx = centre.x - (g.centre.x - g.startView.tx) * k;
      const ty = centre.y - (g.centre.y - g.startView.ty) * k;
      setView(clampView({ s, tx, ty }));
    } else if (pointers.current.size === 1) {
      const t = tapInfo.current;
      if (t && !t.moved && Math.hypot(p.x - t.x, p.y - t.y) > 8) {
        t.moved = true;
        endHold();
      }
      if (t?.moved) {
        setView((v) => clampView({ ...v, tx: v.tx + (p.x - prev.x), ty: v.ty + (p.y - prev.y) }));
      }
    }
  };

  const onPointerUp = (e: PointerEvent) => {
    const p = local(e);
    const t = tapInfo.current;
    const wasHolding = holding.current;
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) gesture.current = null;
    if (pointers.current.size === 0) {
      endHold();
      tapInfo.current = null;
      if (t && !t.moved && !wasHolding && Date.now() - t.t < 450 && e.type === 'pointerup' && onTap) {
        const v = viewRef.current;
        const u = (p.x - v.tx) / (cw * v.s);
        const w = (p.y - v.ty) / (ch * v.s);
        if (u >= 0 && u <= 1 && w >= 0 && w <= 1) onTap(u, w);
      }
    }
  };

  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const p = local(e);
    const v = viewRef.current;
    const s = Math.min(maxZoom, Math.max(1, v.s * Math.exp(-e.deltaY * 0.0015)));
    const k = s / v.s;
    setView(clampView({ s, tx: p.x - (p.x - v.tx) * k, ty: p.y - (p.y - v.ty) * k }));
  };

  useEffect(() => {
    const el = box.current!;
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  });

  return (
    <div
      class="zoompan"
      ref={box}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onContextMenu={(e) => e.preventDefault()}
      onDblClick={(e) => {
        const v = viewRef.current;
        if (v.s > 1.01) return fit();
        const p = local(e);
        const k = 2.5 / v.s;
        setView(clampView({ s: 2.5, tx: p.x - (p.x - v.tx) * k, ty: p.y - (p.y - v.ty) * k }));
      }}
    >
      <div
        class="zoompan-content"
        style={{ width: `${cw}px`, height: `${ch}px`, transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.s})` }}
      >
        {children}
      </div>
    </div>
  );
}
