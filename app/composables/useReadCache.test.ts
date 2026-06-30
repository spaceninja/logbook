import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { describe, expect, it, vi } from 'vitest';
import { clearReadCache, readCacheOptions } from './useReadCache';

// vi.hoisted so the mock fn exists before mockNuxtImport's hoisted factory runs.
const { clearNuxtData } = vi.hoisted(() => ({ clearNuxtData: vi.fn() }));
mockNuxtImport('clearNuxtData', () => clearNuxtData);

// Minimal NuxtApp stand-in: getCachedData only reads `payload.data` /
// `static.data`. Cast through unknown so we don't have to stub the whole app.
function fakeNuxtApp(data: Record<string, unknown>) {
  return { payload: { data }, static: { data: {} } } as never;
}

describe('readCacheOptions', () => {
  it('returns the cached payload for a key when present', () => {
    const { getCachedData } = readCacheOptions();
    const items = [{ id: 'a' }];
    const cached = getCachedData(
      'backlog:book',
      fakeNuxtApp({ 'backlog:book': items }),
      { cause: 'watch' },
    );
    expect(cached).toBe(items);
  });

  it('returns undefined when the key is not cached', () => {
    const { getCachedData } = readCacheOptions();
    const cached = getCachedData('backlog:movie', fakeNuxtApp({}), {
      cause: 'watch',
    });
    expect(cached).toBeUndefined();
  });

  it('bypasses the cache on a manual refresh', () => {
    const { getCachedData } = readCacheOptions();
    const cached = getCachedData(
      'backlog:book',
      fakeNuxtApp({ 'backlog:book': [{ id: 'a' }] }),
      { cause: 'refresh:manual' },
    );
    expect(cached).toBeUndefined();
  });
});

describe('clearReadCache', () => {
  it('clears only cache-owned keys via clearNuxtData', () => {
    clearNuxtData.mockClear();
    clearReadCache();

    expect(clearNuxtData).toHaveBeenCalledTimes(1);
    const predicate = clearNuxtData.mock.calls[0]![0];
    expect(predicate('backlog:book')).toBe(true);
    expect(predicate('history:2024:movie')).toBe(true);
    expect(predicate('completionYears')).toBe(true);
    expect(predicate('item:abc')).toBe(false);
  });
});
