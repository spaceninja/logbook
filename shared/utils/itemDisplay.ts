import type { Item, ShowMetadata } from '../types/item';
import { itemSeries } from './series';

/**
 * Display title. Shows are stored per-season with the show name in `title`, so
 * the season is composed at render time as "<title> — Season <n>" (core design
 * §3.4). A season's own name (`season_title`, e.g. "Book One: Water") is shown
 * separately, not folded into this title. All other types use `title` verbatim.
 */
export function itemDisplayTitle(item: Item): string {
  if (item.type === 'show') {
    const { season_number } = item.metadata as ShowMetadata;
    return `${item.title} — Season ${season_number}`;
  }
  return item.title;
}

/** Joins multi-value creators into a single readable string. */
export function formatCreator(creator: Item['creator']): string {
  if (Array.isArray(creator)) return creator.join(', ');
  return creator ?? '';
}

/**
 * "Series Name #N" for an item in a series (or just the name when unnumbered).
 * Empty when there is no series. Shows are skipped — their season is already in
 * the display title.
 */
export function formatSeries(item: Item): string {
  if (item.type === 'show') return '';
  const { name, number } = itemSeries(item);
  if (!name) return '';
  return number !== undefined ? `${name} #${number}` : name;
}
