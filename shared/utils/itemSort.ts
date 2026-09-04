import type { Item } from '../types/item';
import { deriveCreatorSort } from './creatorSort';
import { itemDisplayTitle } from './itemDisplay';
import { itemSeries } from './series';

/** Leading quotes, brackets, ellipses — anything before the first letter or digit. */
const LEADING_PUNCTUATION = /^[^\p{L}\p{N}]+/u;

/**
 * The string a title actually files under: no leading article, so "The Hobbit"
 * files under "h" (core design §4), and no leading punctuation, so
 * `"Surely You're Joking, Mr. Feynman!"` files under "s" rather than sorting
 * ahead of the entire alphabet on its opening quote mark. Punctuation is
 * stripped on both sides of the article for titles like `The "Great" Gatsby`.
 */
function titleSortKey(title: string): string {
	return title
		.replace(LEADING_PUNCTUATION, '')
		.replace(/^(the|a|an)\s+/i, '')
		.replace(LEADING_PUNCTUATION, '');
}

/** Which two-tier sort to apply. `completion_date` is History-only. */
export type SortKey =
	| 'rating'
	| 'title'
	| 'creator'
	| 'series'
	| 'length'
	| 'release_date'
	| 'added_date'
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
	titleSortKey(itemDisplayTitle(item)).toLowerCase();
const creatorValue: Accessor = (item) =>
	(
		item.creator_sort ??
		deriveCreatorSort(item.creator, item.type) ??
		''
	).toLowerCase();
const seriesValue: Accessor = (item) => {
	const name = itemSeries(item).name;
	return name ? titleSortKey(name).toLowerCase() : undefined;
};
const seriesNumberValue: Accessor = (item) => itemSeries(item).number;
const lengthValue: Accessor = (item) => item.length;
const releaseValue: Accessor = (item) => item.release_date;
const addedValue: Accessor = (item) => item.added_date;
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
	// Newest first, like `completion_date` — the useful question is "what did I
	// add lately," not "what has sat here longest" (that's the reversed view).
	added_date: {
		primary: { get: addedValue, dir: -1 },
		secondary: titleTier,
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
