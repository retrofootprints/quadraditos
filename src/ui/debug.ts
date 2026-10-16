import { signal } from '@preact/signals';

/** Data shown by the hidden debug panel (tap the version number five times). */
export interface DebugData {
  render?: Record<string, number>;
  renderCells?: string;
  detect?: {
    width: number;
    height: number;
    fg: Uint8Array;
    core: Uint8Array;
    timings: Record<string, number>;
    blobs: number;
  };
  photo?: string;
}

export const debugOpen = signal(false);
export const debugData = signal<DebugData>({});

export function patchDebug(p: Partial<DebugData>) {
  debugData.value = { ...debugData.value, ...p };
}
