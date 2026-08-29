import {
  isTheme,
  normalizeAppearance,
  type AppearanceConfig,
} from '../../../shared/types/appearance';

const APPEARANCE_CACHE_KEY = 'pane.appearance.v1';

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function readAppearanceCache(storage: StorageLike = localStorage): AppearanceConfig | undefined {
  try {
    const raw: unknown = JSON.parse(storage.getItem(APPEARANCE_CACHE_KEY) ?? 'null');
    // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Establishes the JSON object representation before version and field normalization.
    if (typeof raw !== 'object' || raw === null || !('v' in raw) || raw.v !== 1) return undefined;
    return normalizeAppearance(raw).appearance;
  } catch {
    return undefined;
  }
}

export function writeAppearanceCache(appearance: AppearanceConfig, storage: StorageLike = localStorage): void {
  storage.setItem(APPEARANCE_CACHE_KEY, JSON.stringify({ v: 1, ...appearance }));
}

export function readLegacyThemeAsFixed(storage: StorageLike = localStorage): AppearanceConfig | undefined {
  const theme = storage.getItem('theme');
  return isTheme(theme) ? normalizeAppearance({ theme }).appearance : undefined;
}
