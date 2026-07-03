import type { Item, ItemStatus } from '../types/item';
import { deriveCompletedYears } from '../utils/completedYears';
import type {
	ImportContribution,
	ImportRecord,
	ImportSource,
	RatingAuthority,
} from './types';

/**
 * The merge policy that makes re-import idempotent (issue #20). A record's
 * contribution is applied onto a "current" item — either a freshly enriched base
 * (new id) or the existing Firestore doc (known id) — by the same rules:
 *
 * - `completed_dates` is additive: unioned across sources/runs, deduped by day,
 *   never removed. Nothing that was watched/read/played is ever lost.
 * - `my_rating` is import-owned but respects source precedence via
 *   `ratingAuthority` (overwrite vs fill-only-when-empty).
 * - `status` follows completion state: a history record (with dates) is
 *   authoritative; a backlog record never demotes an item that already has
 *   completions.
 * - `is_purchased` is sticky: once true it stays true.
 * - User-owned fields (`notes`, `tags`, `recommended_by`, `is_prioritized`) and
 *   enrichment fields are left exactly as they are on `current`.
 */

/** Whether a source may overwrite an existing rating for a given media type. */
export function ratingAuthorityFor(
	source: ImportSource,
	type: Item['type'],
): RatingAuthority {
	// Movies are canonical from Letterboxd, so Trakt may only fill an empty
	// rating — never overwrite Letterboxd's (or a manual edit). Everything else
	// has a single authoritative source.
	if (type === 'movie' && source === 'trakt') return 'fill';
	return 'overwrite';
}

/** The merge-relevant subset of a record, once its id is resolved. */
export function toContribution(record: ImportRecord): ImportContribution {
	return {
		status: record.status,
		completedDates: record.completedDates,
		myRating: record.myRating,
		isPurchased: record.isPurchased,
		ratingAuthority: record.ratingAuthority,
	};
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Normalize an ISO date/datetime to a `YYYY-MM-DD` day, or undefined if invalid. */
function toDay(value: string): string | undefined {
	const day = value.slice(0, 10);
	return DAY.test(day) ? day : undefined;
}

/** Union of ISO dates, normalized to `YYYY-MM-DD`, deduped, sorted ascending. */
function unionDates(existing: string[], incoming: string[]): string[] {
	const days = new Set<string>();
	for (const value of [...existing, ...incoming]) {
		const day = toDay(value);
		if (day) days.add(day);
	}
	return [...days].sort();
}

/**
 * The merged completion dates. Existing dates that match an import-generated
 * fallback (`replaceableDays`) are dropped first, so switching the date fallback
 * replaces the old placeholder rather than stacking. Real dates are then unioned
 * in; if nothing remains, the chosen `fallbackDate` backfills a single date.
 */
function mergeDates(current: Item, contribution: ImportContribution): string[] {
	const replaceable = new Set(
		(contribution.replaceableDays ?? [])
			.map(toDay)
			.filter((day): day is string => day !== undefined),
	);
	const kept = current.completed_dates.filter((date) => {
		const day = toDay(date);
		return day === undefined || !replaceable.has(day);
	});

	const dates = unionDates(kept, contribution.completedDates);
	if (dates.length === 0 && contribution.fallbackDate) {
		const day = toDay(contribution.fallbackDate);
		if (day) return [day];
	}
	return dates;
}

function mergeRating(
	current: Item,
	contribution: ImportContribution,
): number | undefined {
	if (contribution.myRating == null) return current.my_rating;
	if (contribution.ratingAuthority === 'overwrite')
		return contribution.myRating;
	// fill-only: keep an existing rating, otherwise take the incoming one.
	return current.my_rating ?? contribution.myRating;
}

function mergeStatus(
	current: Item,
	contribution: ImportContribution,
	mergedDates: string[],
): ItemStatus {
	// A completion is authoritative — a history record's status always wins
	// (keyed on the status itself, since a fallback record carries no real dates).
	if (contribution.status === 'complete' || contribution.status === 'dnf') {
		return contribution.status;
	}
	// A backlog record must not demote an item that already has completions.
	if (mergedDates.length > 0) return current.status;
	return contribution.status;
}

/**
 * Apply a record's contribution to `current` and return the merged item.
 * Works for both a brand-new enriched base and an existing doc: on a new base
 * (empty dates, no rating) the rules reduce to simply setting the values.
 */
export function applyContribution(
	current: Item,
	contribution: ImportContribution,
): Item {
	const completed_dates = mergeDates(current, contribution);
	const my_rating = mergeRating(current, contribution);

	const merged: Item = {
		...current,
		completed_dates,
		completed_years: deriveCompletedYears(completed_dates),
		status: mergeStatus(current, contribution, completed_dates),
		is_purchased: current.is_purchased || Boolean(contribution.isPurchased),
	};

	if (my_rating == null) delete merged.my_rating;
	else merged.my_rating = my_rating;

	return merged;
}
