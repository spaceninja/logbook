import type { Item } from '../types/item';
import { formatCreator } from './itemDisplay';
import { itemSeries } from './series';

/**
 * The text a query is matched against: title, creator(s), and series name.
 * Shows keep the show name in `title` (the season lives in `metadata`), so
 * searching "severance" matches every season without the "— Season 2" suffix
 * getting in the way.
 */
function searchHaystack(item: Item): string {
	const series = itemSeries(item).name ?? '';
	return `${item.title} ${formatCreator(item.creator)} ${series}`.toLowerCase();
}

/** Splits a query into lowercased terms; a blank query yields none. */
export function searchTerms(query: string): string[] {
	return query.toLowerCase().split(/\s+/).filter(Boolean);
}

/**
 * Keeps items matching *every* term in `query` (AND, not OR) somewhere in their
 * title, creator, or series.
 *
 * Matching is substring rather than prefix — Firestore could only do the latter,
 * and prefix search would miss "Children of Dune" for the query "dune". It's
 * tokenized so "dune part" still finds "Dune: Part Two", which a plain substring
 * test would reject over the intervening punctuation.
 *
 * A blank query returns the input untouched (same array, not a copy), so callers
 * can bind this straight to an input without special-casing the empty state.
 */
export function applyItemSearch(items: Item[], query: string): Item[] {
	const terms = searchTerms(query);
	if (terms.length === 0) return items;
	return items.filter((item) => {
		const haystack = searchHaystack(item);
		return terms.every((term) => haystack.includes(term));
	});
}
