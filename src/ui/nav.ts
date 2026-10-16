import { signal } from '@preact/signals';

export type PalettesView =
  | { kind: 'list' }
  | { kind: 'edit'; id: string }
  | { kind: 'extract'; addTo?: string };

export interface Route {
  tab: 'palettes' | 'studio';
  view?: PalettesView;
}

export const route = signal<Route>({ tab: 'studio' });

export function navigate(r: Route) {
  route.value = r;
}
