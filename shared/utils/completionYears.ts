import type { Item, MediaType } from '../types/item';
import { deriveCompletedYears } from './completedYears';

/** Years with at least one completion, grouped by media type. */
export type CompletionYearsByType = Partial<Record<MediaType, number[]>>;

/**
 * Derives the set of years in which items were completed, grouped by media type:
 * for each type, the de-duplicated, ascending union of its items'
 * `completed_dates`. Powers the History view's year switcher, which is always
 * filtered to one type and can't scan the collection at read time (Firestore has
 * no DISTINCT) — so this is stored in a maintained aggregate doc
 * (`meta/completionYears`) and rebuilt by the seed loader (core design §15).
 * Types with no completions are omitted.
 */
export function deriveCompletionYearsByType(
	items: Item[],
): CompletionYearsByType {
	const sets: Partial<Record<MediaType, Set<number>>> = {};

	for (const item of items) {
		const years = deriveCompletedYears(item.completed_dates);
		if (years.length === 0) continue;
		const set = (sets[item.type] ??= new Set<number>());
		for (const year of years) set.add(year);
	}

	const result: CompletionYearsByType = {};
	for (const type of Object.keys(sets) as MediaType[]) {
		result[type] = [...sets[type]!].sort((a, b) => a - b);
	}
	return result;
}
