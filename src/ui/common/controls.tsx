import { useEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { signal } from '@preact/signals';

// ---------- toast ----------

export const toast = signal<string | null>(null);
let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function showToast(msg: string, ms = 2600) {
  toast.value = msg;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toast.value = null), ms);
}

export function Toast() {
  return toast.value ? <div class="toast" role="status">{toast.value}</div> : null;
}

// ---------- slider ----------

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  /** Double-tap resets to this value. */
  reset?: number;
  format?: (v: number) => string;
  onInput: (v: number) => void;
  onChange?: (v: number) => void;
  hint?: string;
}

export function Slider({ label, value, min, max, step = 1, reset, format, onInput, onChange, hint }: SliderProps) {
  const lastTap = useRef(0);
  const doubleTapReset = () => {
    if (reset === undefined) return;
    const now = Date.now();
    if (now - lastTap.current < 320) {
      onInput(reset);
      onChange?.(reset);
    }
    lastTap.current = now;
  };
  return (
    <div class="slider" title={hint}>
      <span class="name" onClick={doubleTapReset}>{label}</span>
      <span class="val" onClick={doubleTapReset}>{format ? format(value) : value}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        onInput={(e) => onInput(Number((e.target as HTMLInputElement).value))}
        onChange={(e) => onChange?.(Number((e.target as HTMLInputElement).value))}
        onPointerUp={doubleTapReset}
        onDblClick={() => reset !== undefined && onInput(reset)}
      />
    </div>
  );
}

// ---------- segmented ----------

export function Segmented<T extends string | number>({ value, options, onChange, label }: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label?: string;
}) {
  return (
    <div class="segmented" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={String(o.value)} aria-pressed={o.value === value} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

// ---------- modal sheet ----------

export function Sheet({ title, onClose, children }: { title?: string; onClose: () => void; children: ComponentChildren }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div class="overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div class="sheet" role="dialog" aria-label={title}>
        {title && <h2>{title}</h2>}
        {children}
      </div>
    </div>
  );
}

// ---------- confirm ----------

export function useBusy() {
  const [busy, setBusy] = useState(false);
  return [busy, async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true);
    try {
      return await fn();
    } finally {
      setBusy(false);
    }
  }] as const;
}

export function Spinner() {
  return <span class="spinner" role="progressbar" aria-label="Working" />;
}

// ---------- download / share ----------

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Share through the system sheet (iOS offers "Save Image"); fall back to a download. */
export async function shareOrDownload(blob: Blob, filename: string): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const file = new File([blob], filename, { type: blob.type });
  try {
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: filename });
      return 'shared';
    }
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return 'cancelled';
    // any other failure: fall through to the download link
  }
  downloadBlob(blob, filename);
  return 'downloaded';
}

export function isStandalone(): boolean {
  return window.matchMedia?.('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
}
