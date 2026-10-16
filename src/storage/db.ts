import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Palette, Settings } from '../core/types';

interface PixelatorDB extends DBSchema {
  palettes: { key: string; value: Palette };
  images: { key: string; value: { id: string; blob: Blob } };
  settings: { key: string; value: Settings };
}

let dbp: Promise<IDBPDatabase<PixelatorDB>> | null = null;

function db() {
  dbp ??= openDB<PixelatorDB>('swatch-pixelator', 1, {
    upgrade(d) {
      d.createObjectStore('palettes', { keyPath: 'id' });
      d.createObjectStore('images', { keyPath: 'id' });
      d.createObjectStore('settings');
    },
  });
  return dbp;
}

export const getAllPalettes = async (): Promise<Palette[]> => (await db()).getAll('palettes');
export const putPalette = async (p: Palette) => void (await (await db()).put('palettes', p));
export const deletePalette = async (id: string) => void (await (await db()).delete('palettes', id));

export const getSettings = async (): Promise<Settings | undefined> => (await db()).get('settings', 'main');
export const putSettings = async (s: Settings) => void (await (await db()).put('settings', s, 'main'));

export const putImage = async (id: string, blob: Blob) => void (await (await db()).put('images', { id, blob }));
export const getImage = async (id: string): Promise<Blob | undefined> => (await (await db()).get('images', id))?.blob;
export const deleteImage = async (id: string) => void (await (await db()).delete('images', id));
