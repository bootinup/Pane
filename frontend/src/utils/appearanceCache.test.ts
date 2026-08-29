import { describe, expect, it } from 'vitest';
import { DEFAULT_APPEARANCE } from '../../../shared/types/appearance';
import { readAppearanceCache, readLegacyThemeAsFixed, writeAppearanceCache, type StorageLike } from './appearanceCache';

function memoryStorage(initial: Record<string, string> = {}): StorageLike {
  const values = new Map(Object.entries(initial));
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}

describe('appearance cache', () => {
  it('round-trips version one', () => {
    const storage = memoryStorage();
    writeAppearanceCache(DEFAULT_APPEARANCE, storage);
    expect(readAppearanceCache(storage)).toEqual(DEFAULT_APPEARANCE);
  });

  it('ignores garbage and interprets a valid legacy theme as fixed', () => {
    expect(readAppearanceCache(memoryStorage({ 'pane.appearance.v1': '{' }))).toBeUndefined();
    expect(readLegacyThemeAsFixed(memoryStorage({ theme: 'walnut' }))).toMatchObject({ appearanceMode: 'fixed', theme: 'walnut' });
    expect(readLegacyThemeAsFixed(memoryStorage({ theme: 'invalid' }))).toBeUndefined();
  });
});
