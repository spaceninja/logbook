import type { Item, ShowMetadata } from '../types/item';

/**
 * The series name/number for an item, used by the series sort (core design §4).
 * Books, movies, and games carry an explicit `series`/`series_number`. A show is
 * its own series — the show name is the series name and the season is its number
 * — so seasons group under the show and order numerically.
 */
export function itemSeries(item: Pick<Item, 'type' | 'metadata' | 'title'>): {
  name?: string;
  number?: number;
} {
  if (item.type === 'show') {
    return {
      name: item.title,
      number: (item.metadata as ShowMetadata).season_number,
    };
  }
  const m = item.metadata as { series?: string; series_number?: number };
  return { name: m.series, number: m.series_number };
}
