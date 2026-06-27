import { describe, expect, it } from 'vitest';
import type { Item, ItemStatus, MediaType } from '../types/item';
import { deriveCompletedYears } from '../utils/completedYears';
import { sampleSeed } from './sample';

const MEDIA_TYPES: MediaType[] = ['book', 'movie', 'show', 'game'];
const STATUSES: ItemStatus[] = ['backlog', 'in_progress', 'complete', 'dnf'];

describe('sampleSeed', () => {
  it('has unique ids', () => {
    const ids = sampleSeed.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(sampleSeed.map((item): [string, Item] => [item.id, item]))(
    'has a valid required-field shape: %s',
    (_id, item) => {
      expect(item.id).toBeTruthy();
      expect(MEDIA_TYPES).toContain(item.type);
      expect(item.title).toBeTruthy();
      expect(STATUSES).toContain(item.status);
      expect(typeof item.is_purchased).toBe('boolean');
      expect(typeof item.is_prioritized).toBe('boolean');
      expect(Array.isArray(item.completed_dates)).toBe(true);
      expect(Array.isArray(item.completed_years)).toBe(true);
      expect(Array.isArray(item.tags)).toBe(true);
      expect(item.metadata).toBeTypeOf('object');
    },
  );

  it.each(sampleSeed.map((item): [string, Item] => [item.id, item]))(
    'has completed_years consistent with completed_dates: %s',
    (_id, item) => {
      expect(item.completed_years).toStrictEqual(
        deriveCompletedYears(item.completed_dates),
      );
    },
  );

  // Coverage guarantees (formerly the dedicated edge fixture).
  it('covers all four media types', () => {
    expect(new Set(sampleSeed.map((i) => i.type))).toStrictEqual(
      new Set(MEDIA_TYPES),
    );
  });

  it('exercises every status', () => {
    expect(new Set(sampleSeed.map((i) => i.status))).toStrictEqual(
      new Set(STATUSES),
    );
  });

  it('has a dated DNF in every media type (shows in History)', () => {
    for (const type of MEDIA_TYPES) {
      const dnf = sampleSeed.find((i) => i.type === type && i.status === 'dnf');
      expect(dnf, `expected a dnf ${type}`).toBeDefined();
      expect(dnf!.completed_dates.length).toBeGreaterThan(0);
    }
  });

  it('has at least 10 backlog items per media type', () => {
    for (const type of MEDIA_TYPES) {
      const backlog = sampleSeed.filter(
        (i) =>
          i.type === type &&
          (i.status === 'backlog' || i.status === 'in_progress'),
      );
      expect(backlog.length).toBeGreaterThanOrEqual(10);
    }
  });

  it('has completed history spanning at least three years per media type', () => {
    for (const type of MEDIA_TYPES) {
      const years = new Set(
        sampleSeed
          .filter((i) => i.type === type)
          .flatMap((i) => i.completed_years),
      );
      expect(years.size).toBeGreaterThanOrEqual(3);
    }
  });

  it('includes repeats that appear in both Backlog and History', () => {
    const repeats = sampleSeed.filter(
      (i) =>
        i.completed_dates.length > 0 &&
        (i.status === 'backlog' || i.status === 'in_progress'),
    );
    expect(repeats.length).toBeGreaterThan(0);
  });

  it('carries real provider cover art', () => {
    for (const item of sampleSeed) {
      expect(item.cover, `${item.title} cover`).toMatch(/^https:\/\//);
    }
  });
});
