import { hexToLab, normaliseHex } from '../core/color';
import { uuid } from '../core/palette';
import type { Palette, PaletteColor } from '../core/types';

export const BACKUP_FORMAT = 'swatch-pixelator';

export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  version: 1;
  exportedAt: number;
  palettes: Palette[];
  /** sheetImageId -> data URL (optional; omitted to keep files small). */
  images?: Record<string, string>;
}

export function buildBackup(palettes: Palette[], images?: Record<string, string>): BackupFile {
  const file: BackupFile = { format: BACKUP_FORMAT, version: 1, exportedAt: Date.now(), palettes };
  if (images && Object.keys(images).length) file.images = images;
  return file;
}

function cleanColor(c: unknown): PaletteColor | null {
  if (!c || typeof c !== 'object') return null;
  const o = c as Record<string, unknown>;
  const hex = typeof o.hex === 'string' ? normaliseHex(o.hex) : null;
  if (!hex) return null;
  const lab = hexToLab(hex)!;
  return {
    id: typeof o.id === 'string' ? o.id : uuid(),
    name: typeof o.name === 'string' ? o.name : 'Colour',
    code: typeof o.code === 'string' ? o.code : '?',
    hex,
    lab: Array.isArray(o.lab) && o.lab.length === 3 && o.lab.every((n) => typeof n === 'number') ? (o.lab as [number, number, number]) : lab,
    enabled: o.enabled !== false,
    ...(o.isPaper ? { isPaper: true } : {}),
    ...(o.sample && typeof o.sample === 'object' ? { sample: o.sample as PaletteColor['sample'] } : {}),
  };
}

function cleanPalette(p: unknown): Palette | null {
  if (!p || typeof p !== 'object') return null;
  const o = p as Record<string, unknown>;
  if (typeof o.id !== 'string' || typeof o.name !== 'string' || !Array.isArray(o.colors)) return null;
  const now = Date.now();
  return {
    id: o.id,
    name: o.name,
    substrate: typeof o.substrate === 'string' ? o.substrate : undefined,
    notes: typeof o.notes === 'string' ? o.notes : undefined,
    colors: o.colors.map(cleanColor).filter((c): c is PaletteColor => c !== null),
    sheetImageId: typeof o.sheetImageId === 'string' ? o.sheetImageId : undefined,
    createdAt: typeof o.createdAt === 'number' ? o.createdAt : now,
    updatedAt: typeof o.updatedAt === 'number' ? o.updatedAt : now,
  };
}

/** Parse and validate a backup. Throws a readable error for anything that is not one. */
export function parseBackup(text: string): BackupFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('That file is not valid JSON.');
  }
  const o = raw as Record<string, unknown> | null;
  if (!o || o.format !== BACKUP_FORMAT || !Array.isArray(o.palettes)) {
    throw new Error('That file is not a Swatch Pixelator export.');
  }
  const palettes = o.palettes.map(cleanPalette).filter((p): p is Palette => p !== null);
  if (palettes.length === 0) throw new Error('The file contains no palettes.');
  const images: Record<string, string> = {};
  if (o.images && typeof o.images === 'object') {
    for (const [k, v] of Object.entries(o.images)) if (typeof v === 'string' && v.startsWith('data:')) images[k] = v;
  }
  return { format: BACKUP_FORMAT, version: 1, exportedAt: typeof o.exportedAt === 'number' ? o.exportedAt : Date.now(), palettes, images };
}

export interface ImportPlan {
  added: Palette[];
  /** Palettes whose id already exists: need the user's say-so before overwriting. */
  conflicts: { incoming: Palette; existing: Palette }[];
}

/** Merge by id. */
export function planImport(existing: Palette[], incoming: Palette[]): ImportPlan {
  const byId = new Map(existing.map((p) => [p.id, p]));
  const plan: ImportPlan = { added: [], conflicts: [] };
  for (const p of incoming) {
    const ex = byId.get(p.id);
    if (ex) plan.conflicts.push({ incoming: p, existing: ex });
    else plan.added.push(p);
  }
  return plan;
}

export function dataUrlToBlob(url: string): Blob {
  const [head, body] = url.split(',');
  const mime = /data:([^;]+)/.exec(head)?.[1] ?? 'application/octet-stream';
  const bin = atob(body);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}
