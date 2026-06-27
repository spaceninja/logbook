import type { Item } from '../types/item';

/** Client-side filters available on the Backlog view (core design §4.1). */
export type FilterKey = 'purchased' | 'prioritized' | 'released';

/** Tri-state per filter: ignore, require true, or require false. */
export type FilterState = 'all' | 'yes' | 'no';

export type ItemFilters = Partial<Record<FilterKey, FilterState>>;

/** Released = has a release date that is today or earlier. */
function isReleased(item: Item): boolean {
  if (!item.release_date) return false;
  const today = new Date().toISOString().slice(0, 10);
  return item.release_date <= today;
}

function matches(item: Item, key: FilterKey): boolean {
  switch (key) {
    case 'purchased':
      return item.is_purchased;
    case 'prioritized':
      return item.is_prioritized;
    case 'released':
      return isReleased(item);
  }
}

/**
 * Applies the active tri-state filters: an `all` filter is a no-op; `yes` keeps
 * matching items, `no` keeps non-matching items.
 */
export function applyItemFilters(items: Item[], filters: ItemFilters): Item[] {
  const active = (Object.entries(filters) as [FilterKey, FilterState][]).filter(
    ([, state]) => state === 'yes' || state === 'no',
  );
  if (active.length === 0) return items;
  return items.filter((item) =>
    active.every(([key, state]) =>
      state === 'yes' ? matches(item, key) : !matches(item, key),
    ),
  );
}
