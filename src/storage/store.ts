import { signal, computed, batch } from '@preact/signals';
import { defaultSettings, defaultStudio, type Palette, type Settings, type StudioSettings } from '../core/types';
import { uuid } from '../core/palette';
import {
  buildBackup, blobToDataUrl, dataUrlToBlob, parseBackup, planImport, type ImportPlan,
} from './backup';
import * as db from './db';

export const palettes = signal<Palette[]>([]);
export const settings = signal<Settings>(defaultSettings());
export const ready = signal(false);
export const storageError = signal<string | null>(null);

export const activePalette = computed(() => palettes.value.find((p) => p.id === settings.value.activePaletteId));

let persistRequested = false;
async function requestPersistence() {
  if (persistRequested) return;
  persistRequested = true;
  try {
    await navigator.storage?.persist?.();
  } catch {
    /* not available: fine */
  }
}

export async function init() {
  try {
    const [ps, s] = await Promise.all([db.getAllPalettes(), db.getSettings()]);
    batch(() => {
      palettes.value = ps.sort((a, b) => b.updatedAt - a.updatedAt);
      if (s) {
        // merge so settings added in later versions get their defaults
        const base = defaultStudio();
        settings.value = {
          ...s,
          studio: {
            ...base,
            ...s.studio,
            adjust: { ...base.adjust, ...s.studio?.adjust },
            crop: { ...base.crop, ...s.studio?.crop },
            export: { ...base.export, ...s.studio?.export },
          },
        };
      }
      const active = settings.value.activePaletteId;
      if (active && !ps.some((p) => p.id === active)) settings.value = { ...settings.value, activePaletteId: undefined };
    });
  } catch (e) {
    storageError.value = `Storage is unavailable: ${e instanceof Error ? e.message : String(e)}. Palettes will not be saved.`;
  } finally {
    ready.value = true;
  }
}

export async function savePalette(p: Palette, touch = true) {
  const next = touch ? { ...p, updatedAt: Date.now() } : p;
  const list = palettes.value.slice();
  const i = list.findIndex((x) => x.id === next.id);
  if (i >= 0) list[i] = next;
  else list.unshift(next);
  palettes.value = list;
  if (!settings.value.activePaletteId) setActive(next.id);
  try {
    await db.putPalette(next);
    void requestPersistence();
  } catch (e) {
    storageError.value = `Could not save: ${e instanceof Error ? e.message : String(e)}`;
  }
  return next;
}

export async function removePalette(id: string) {
  const p = palettes.value.find((x) => x.id === id);
  palettes.value = palettes.value.filter((x) => x.id !== id);
  if (settings.value.activePaletteId === id) setActive(palettes.value[0]?.id);
  try {
    await db.deletePalette(id);
    if (p?.sheetImageId && !palettes.value.some((x) => x.sheetImageId === p.sheetImageId)) await db.deleteImage(p.sheetImageId);
  } catch (e) {
    storageError.value = `Could not delete: ${e instanceof Error ? e.message : String(e)}`;
  }
}

export async function duplicatePalette(id: string) {
  const p = palettes.value.find((x) => x.id === id);
  if (!p) return;
  const now = Date.now();
  const copy: Palette = {
    ...p,
    id: uuid(),
    name: `${p.name} copy`,
    colors: p.colors.map((c) => ({ ...c, id: uuid() })),
    createdAt: now,
    updatedAt: now,
  };
  // keep the stored sheet image under its own id so deleting one copy cannot orphan the other
  if (p.sheetImageId) {
    const blob = await db.getImage(p.sheetImageId);
    if (blob) {
      copy.sheetImageId = uuid();
      await db.putImage(copy.sheetImageId, blob);
    } else copy.sheetImageId = undefined;
  }
  await savePalette(copy, false);
}

let settingsTimer: ReturnType<typeof setTimeout> | undefined;
function persistSettingsSoon() {
  clearTimeout(settingsTimer);
  settingsTimer = setTimeout(() => {
    db.putSettings(settings.value).catch(() => {});
  }, 400);
}

export function setActive(id: string | undefined) {
  settings.value = { ...settings.value, activePaletteId: id };
  persistSettingsSoon();
}

export function updateStudio(patch: Partial<StudioSettings> | ((s: StudioSettings) => Partial<StudioSettings>)) {
  const cur = settings.value.studio;
  const p = typeof patch === 'function' ? patch(cur) : patch;
  settings.value = { ...settings.value, studio: { ...cur, ...p } };
  persistSettingsSoon();
}

export function markInstallHintSeen() {
  settings.value = { ...settings.value, installHintSeen: true };
  persistSettingsSoon();
}

// ---------- sheet images ----------

export const saveSheetImage = async (blob: Blob): Promise<string> => {
  const id = uuid();
  await db.putImage(id, blob);
  return id;
};
export const loadSheetImage = (id: string) => db.getImage(id);

// ---------- export / import ----------

export async function exportPalettesJson(ids: string[], includeImages: boolean): Promise<string> {
  const chosen = palettes.value.filter((p) => ids.includes(p.id));
  const images: Record<string, string> = {};
  if (includeImages) {
    for (const p of chosen) {
      if (!p.sheetImageId) continue;
      const blob = await db.getImage(p.sheetImageId);
      if (blob) images[p.sheetImageId] = await blobToDataUrl(blob);
    }
  }
  return JSON.stringify(buildBackup(chosen, images), null, 2);
}

export interface ImportSession {
  plan: ImportPlan;
  images: Record<string, string>;
}

export function prepareImport(text: string): ImportSession {
  const file = parseBackup(text);
  return { plan: planImport(palettes.value, file.palettes), images: file.images ?? {} };
}

/** Apply an import. `overwriteIds` are the conflicting palette ids the user agreed to replace. */
export async function applyImport(s: ImportSession, overwriteIds: string[]) {
  const take = [...s.plan.added, ...s.plan.conflicts.filter((c) => overwriteIds.includes(c.incoming.id)).map((c) => c.incoming)];
  for (const p of take) {
    const img = p.sheetImageId ? s.images[p.sheetImageId] : undefined;
    if (p.sheetImageId && img) await db.putImage(p.sheetImageId, dataUrlToBlob(img));
    else if (p.sheetImageId) p.sheetImageId = undefined;
    await savePalette(p, false);
  }
  return take.length;
}
