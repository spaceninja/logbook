import type { Item, ShowMetadata } from '../types/item';

/**
 * Display title. Shows are stored per-season with the show name in `title`, so
 * the season is composed at render time as "<title> — Season <n>" (core design
 * §3.4). All other types use `title` verbatim.
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
