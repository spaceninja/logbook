import type { DateFallback } from './types';

/**
 * Coerce a partial date to a full ISO `YYYY-MM-DD` day. Provider release dates
 * are often year- or month-only (Google Books `publishedDate` is frequently just
 * `"2023"`), and the History view keys off whole days — so a bare year would
 * otherwise be dropped, leaving an imported completion undated (issue #20). A
 * missing month or day fills in `01`. Returns undefined for anything without a
 * leading 4-digit year.
 */
export function coerceIsoDay(value: string | undefined): string | undefined {
	const match = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?/.exec((value ?? '').trim());
	if (!match) return undefined;
	const [, year, month = '01', day = '01'] = match;
	return `${year}-${month}-${day}`;
}

/**
 * The date to give an undated completion, from the export's date-added /
 * last-updated / (enriched) release date, in the user's chosen preference order.
 * Takes the first that yields a usable day — so picking "Release date" for a book
 * whose release is absent still falls through to a real date rather than leaving
 * it undated. Undefined only when nothing usable exists at all.
 */
export function chooseFallbackDate(
	candidates: { added?: string; updated?: string; release?: string },
	choice: DateFallback,
): string | undefined {
	const { added, updated, release } = candidates;
	const order =
		choice === 'release'
			? [release, added, updated]
			: choice === 'updated'
				? [updated, added, release]
				: [added, updated, release];
	return order
		.map(coerceIsoDay)
		.find((day): day is string => day !== undefined);
}
