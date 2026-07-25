import type { Item } from '../types/item';
import { makeItemComparator } from './itemSort';

/**
 * What the History view is showing. `year` scopes the list to one calendar year
 * (the default); the rest span every year and so read the whole media type
 * rather than a single year's completions (#33).
 */
export type HistoryScope = 'year' | 'undated' | 'unrated' | 'top100';

/** Every scope, for the URL codec and the History switcher. */
export const HISTORY_SCOPES: HistoryScope[] = [
	'year',
	'undated',
	'unrated',
	'top100',
];

/** How many items the Top 100 scope keeps. */
export const TOP_LIMIT = 100;

/** A rating of 0 counts as unrated, matching how ItemCard decides to show one. */
function hasRating(item: Item): boolean {
	return (item.my_rating ?? 0) > 0;
}

/**
 * Finished it at some point: explicitly complete, or carrying a completion date
 * (a re-read can be dated *and* back in the backlog). Undated completions count,
 * which matters for `unratedItems` — those are the likeliest to lack a rating.
 */
function isCompleted(item: Item): boolean {
	return item.status === 'complete' || item.completed_dates.length > 0;
}

/**
 * Completions still awaiting a rating, across every year. DNF is excluded (#33):
 * abandoning something is its own verdict, so those aren't waiting on a rating.
 */
export function unratedItems(items: Item[]): Item[] {
	return items.filter(
		(item) => isCompleted(item) && item.status !== 'dnf' && !hasRating(item),
	);
}

/**
 * The highest-rated completions across every year, capped at `TOP_LIMIT`. Ranked
 * with the shared `rating` comparator (rating desc, then title), so the cut-off
 * is deterministic when several items share the boundary rating. Membership is
 * always this ranking; the caller is free to re-sort the result for display.
 */
export function topRatedItems(items: Item[], limit = TOP_LIMIT): Item[] {
	const comparator = makeItemComparator('rating', false, {
		ratingField: 'my_rating',
	});
	return items
		.filter((item) => isCompleted(item) && hasRating(item))
		.sort(comparator)
		.slice(0, limit);
}
