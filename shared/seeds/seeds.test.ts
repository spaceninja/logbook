import { describe, expect, it } from 'vitest';
import type { Item, ItemStatus, MediaType } from '../types/item';
import { deriveCompletedYears } from '../utils/completedYears';
import { edgeSeed } from './edge';
import { sampleSeed } from './sample';

const MEDIA_TYPES: MediaType[] = ['book', 'movie', 'show', 'game'];
const STATUSES: ItemStatus[] = ['backlog', 'in_progress', 'inactive'];

const datasets: [string, Item[]][] = [
  ['edgeSeed', edgeSeed],
  ['sampleSeed', sampleSeed],
];

describe.each(datasets)('%s', (_name, items) => {
  it('has unique ids', () => {
    const ids = items.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(items.map((item): [string, Item] => [item.id, item]))(
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

  it.each(items.map((item): [string, Item] => [item.id, item]))(
    'has completed_years consistent with completed_dates: %s',
    (_id, item) => {
      expect(item.completed_years).toStrictEqual(
        deriveCompletedYears(item.completed_dates),
      );
    },
  );
});

describe('edgeSeed', () => {
  it('covers all four media types', () => {
    expect(new Set(edgeSeed.map((item) => item.type))).toStrictEqual(
      new Set(MEDIA_TYPES),
    );
  });

  it('has 16 items (4 types × 4 variants)', () => {
    expect(edgeSeed).toHaveLength(16);
  });
});
