import type { Item } from '../types/item';

/**
 * Cover-URL cleanup carried over from the original app: force https and strip
 * Google Books' `&edge=curl` (which overlays a page-curl on the image).
 */
export function cleanCoverUrl(url: string | undefined): string | undefined {
	if (!url) return undefined;
	return url.replace(/^http:/, 'https:').replace(/&edge=curl/, '');
}

/** Round a rating to two decimal places (keeps stored ratings tidy). */
export function round2(n: number): number {
	return Math.round(n * 100) / 100;
}

/** Lowercase, trim, drop empties, de-duplicate — for mapping genres → tags. */
export function normalizeTags(names: (string | undefined | null)[]): string[] {
	const seen = new Set<string>();
	for (const name of names) {
		const tag = name?.trim().toLowerCase();
		if (tag) seen.add(tag);
	}
	return [...seen];
}

/** Collapse a list of names into the `creator` shape (string | string[] | undefined). */
export function toCreator(
	names: (string | undefined | null)[],
): string | string[] | undefined {
	const clean = names.map((n) => n?.trim()).filter((n): n is string => !!n);
	if (clean.length === 0) return undefined;
	if (clean.length === 1) return clean[0];
	return clean;
}

/** Unix seconds → ISO `YYYY-MM-DD` (IGDB dates). */
export function unixSecondsToIsoDate(
	seconds: number | undefined,
): string | undefined {
	if (typeof seconds !== 'number') return undefined;
	return new Date(seconds * 1000).toISOString().slice(0, 10);
}

/** First four chars of an ISO/partial date, when present. */
export function yearOf(date: string | undefined): string | undefined {
	const year = date?.slice(0, 4);
	return year && /^\d{4}$/.test(year) ? year : undefined;
}

/**
 * How closely a title matches the query (lower = closer): exact, prefix,
 * substring, then everything else. Keeps literal matches ahead of incidental
 * ones so specific searches (e.g. "Hades II") aren't displaced by a more popular
 * sibling.
 */
export function titleTier(title: string, query: string): number {
	const n = title.toLowerCase();
	const q = query.trim().toLowerCase();
	if (n === q) return 0;
	if (n.startsWith(q)) return 1;
	if (n.includes(q)) return 2;
	return 3;
}

/** Casefold, strip diacritics and punctuation, collapse whitespace. */
function normalizeTitle(title: string): string {
	return title
		.toLowerCase()
		.normalize('NFKD')
		.replace(/[̀-ͯ]/g, '') // combining marks, so "novéna" → "novena"
		.replace(/[^a-z0-9]+/g, ' ')
		.trim();
}

/**
 * Whether a candidate title plausibly names the same book as `wanted`. Prefix
 * matching either way tolerates a subtitle on one side ("Dune (Movie Tie-In)" vs
 * "Dune") while rejecting a different book by the same author ("De leugens van
 * Locke Lamora" vs "Locke Lamora and the Bottled Serpent").
 */
export function titlesMatch(candidate: string, wanted: string): boolean {
	const a = normalizeTitle(candidate);
	const b = normalizeTitle(wanted);
	return a === b || a.startsWith(b) || b.startsWith(a);
}

/**
 * The user-owned and structural fields every provider draft starts with. Provider
 * mappers spread provider-sourced fields on top of these. Keeping these concrete
 * (not undefined) matches the milestone-1 convention.
 */
export function draftDefaults(): Pick<
	Item,
	| 'status'
	| 'is_purchased'
	| 'is_prioritized'
	| 'completed_dates'
	| 'completed_years'
	| 'tags'
> {
	return {
		status: 'backlog',
		is_purchased: false,
		is_prioritized: false,
		completed_dates: [],
		completed_years: [],
		tags: [],
	};
}
