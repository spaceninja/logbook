import type { Item } from '../types/item';
import { deriveCreatorSort } from './creatorSort';
import { itemDisplayTitle } from './itemDisplay';
import { itemSeries } from './series';

/** Ignore a leading article so "The Hobbit" files under "h" (core design §4). */
function stripLeadingArticle(title: string): string {
  return title.replace(/^(the|a|an)\s+/i, '');
}

/** Which two-tier sort to apply. `completion_date` is History-only. */
export type SortKey =
  | 'rating'
  | 'title'
  | 'creator'
  | 'series'
  | 'length'
  | 'release_date'
  | 'completion_date';

/** Which rating "rating" sorts resolve to — provider vs the owner's. */
export type RatingField = 'community_rating' | 'my_rating';

interface SortContext {
  ratingField: RatingField;
  /** Scopes `completion_date` to the History year; omit for the latest overall. */
  year?: number;
}

/**
 * The most recent completion date, optionally restricted to one calendar year.
 * Returns `undefined` when the item has no completion in scope.
 */
export function latestCompletedDate(
  item: Item,
  year?: number,
): string | undefined {
  const dates =
    year === undefined
      ? item.completed_dates
      : item.completed_dates.filter(
          (d) => Number.parseInt(d.slice(0, 4), 10) === year,
        );
  if (dates.length === 0) return undefined;
  return [...dates].sort().at(-1);
}

type SortValue = string | number | undefined;
type Accessor = (item: Item, ctx: SortContext) => SortValue;

/** 1 = ascending, -1 = descending. */
type Direction = 1 | -1;
interface Tier {
  get: Accessor;
  dir: Direction;
}

const ratingValue: Accessor = (item, ctx) => item[ctx.ratingField];
const titleValue: Accessor = (item) =>
  stripLeadingArticle(itemDisplayTitle(item)).toLowerCase();
const creatorValue: Accessor = (item) =>
  (
    item.creator_sort ??
    deriveCreatorSort(item.creator, item.type) ??
    ''
  ).toLowerCase();
const seriesValue: Accessor = (item) => {
  const name = itemSeries(item).name;
  return name ? stripLeadingArticle(name).toLowerCase() : undefined;
};
const seriesNumberValue: Accessor = (item) => itemSeries(item).number;
const lengthValue: Accessor = (item) => item.length;
const releaseValue: Accessor = (item) => item.release_date;
const completionValue: Accessor = (item, ctx) =>
  latestCompletedDate(item, ctx.year);

const titleTier: Tier = { get: titleValue, dir: 1 };
const ratingTierDesc: Tier = { get: ratingValue, dir: -1 };

const SORTS: Record<SortKey, { primary: Tier; secondary: Tier }> = {
  rating: { primary: ratingTierDesc, secondary: titleTier },
  title: { primary: titleTier, secondary: ratingTierDesc },
  creator: {
    primary: { get: creatorValue, dir: 1 },
    secondary: ratingTierDesc,
  },
  series: {
    primary: { get: seriesValue, dir: 1 },
    secondary: { get: seriesNumberValue, dir: 1 },
  },
  length: { primary: { get: lengthValue, dir: 1 }, secondary: ratingTierDesc },
  release_date: {
    primary: { get: releaseValue, dir: 1 },
    secondary: ratingTierDesc,
  },
  completion_date: {
    primary: { get: completionValue, dir: -1 },
    secondary: titleTier,
  },
};

/** Compare two values; `undefined` always sorts last, regardless of direction. */
function cmp(a: SortValue, b: SortValue, dir: Direction): number {
  if (a === undefined && b === undefined) return 0;
  if (a === undefined) return 1;
  if (b === undefined) return -1;
  const base =
    typeof a === 'number' && typeof b === 'number'
      ? a - b
      : String(a).localeCompare(String(b));
  return base * dir;
}

/**
 * Builds a two-tier comparator. `reversed` flips only the primary key's
 * direction; the secondary key is unaffected. Undefined primary/secondary values
 * stay last in either direction (core design §4).
 */
export function makeItemComparator(
  key: SortKey,
  reversed: boolean,
  ctx: SortContext,
): (a: Item, b: Item) => number {
  const { primary, secondary } = SORTS[key];
  const primaryDir = (reversed ? -primary.dir : primary.dir) as Direction;
  return (a, b) => {
    const p = cmp(primary.get(a, ctx), primary.get(b, ctx), primaryDir);
    if (p !== 0) return p;
    return cmp(secondary.get(a, ctx), secondary.get(b, ctx), secondary.dir);
  };
}
