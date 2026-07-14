import { normalizeTitle } from '../providers/helpers';
import type { SearchResult } from '../types/search';

/**
 * Title+year matching for imports whose export carries no provider id
 * (Letterboxd movies — issue #20). Measured against a real 1,755-film export:
 * 93% of films match a TMDB result on title and year exactly, 3% are off by a
 * year, and the rest are titles TMDB's movie index simply doesn't hold
 * (miniseries Letterboxd files as films, e.g. "Frank Herbert's Dune").
 *
 * The cost of a wrong match is high — a silently imported wrong movie, carrying
 * a real watch history — so the bar is deliberately strict: the titles must be
 * *equal* once normalized. Substring/prefix matching is not enough here the way
 * it is for books, because a prefix match would happily bind "Dune" to "Dune:
 * Part Two". Films with no confident match are reported to the caller, not
 * guessed at.
 */

/** Widest gap between the export's year and TMDB's that still counts as the same film. */
const YEAR_SLOP = 1;

function yearNumber(year: string | undefined): number | undefined {
	const n = Number.parseInt((year ?? '').trim(), 10);
	return Number.isFinite(n) ? n : undefined;
}

/** Drop a leading article, so "School of Rock" reaches TMDB's "The School of Rock". */
function stripArticle(title: string): string {
	return title.replace(/^(?:the|a|an) /, '');
}

/**
 * Whether two titles name the same film allowing for the ways a service can
 * shorten one: a leading article, or a subtitle that one side carries and the
 * other drops ("Glass Onion" vs "Glass Onion: A Knives Out Mystery", "2010: The
 * Year We Make Contact" vs "2010"). The extra text must begin at a word boundary,
 * so "Drunken Master II" still can't reach "Drunken Master III".
 *
 * This is deliberately loose, and is only ever consulted under the guards in
 * `pickMovieMatch`: the years must be identical and the candidate must be the
 * only one that fits.
 */
function titlesNameSameFilm(candidate: string, wanted: string): boolean {
	const a = stripArticle(normalizeTitle(candidate));
	const b = stripArticle(normalizeTitle(wanted));
	return a === b || a.startsWith(`${b} `) || b.startsWith(`${a} `);
}

/**
 * The TMDB provider id for `title` (+ `year`) among `results`, or null when
 * nothing matches confidently.
 *
 * Only results whose normalized title is identical are considered. Among those:
 * the closest year within a year of the export's wins; failing that, a lone
 * candidate is accepted whatever its year (Letterboxd sometimes dates a film by
 * its festival run and TMDB by its release — and a remake, the case a year
 * guards against, would put a second same-titled candidate in the list). With no
 * year to go on, the first candidate wins, TMDB having ranked them by popularity.
 */
export function pickMovieMatch(
	results: SearchResult[],
	title: string,
	year?: string,
): string | null {
	const wanted = normalizeTitle(title);
	const candidates = results.filter((r) => normalizeTitle(r.title) === wanted);
	if (candidates.length === 0) return null;

	const target = yearNumber(year);
	if (target === undefined) return candidates[0]!.providerId;

	const dated = candidates
		.map((r) => ({ result: r, year: yearNumber(r.year) }))
		.filter((c): c is { result: SearchResult; year: number } => c.year != null)
		.sort((a, b) => Math.abs(a.year - target) - Math.abs(b.year - target));

	const closest = dated[0];
	if (closest && Math.abs(closest.year - target) <= YEAR_SLOP) {
		return closest.result.providerId;
	}
	// No candidate lands near the export's year: trust a lone same-titled film
	// (an undated TMDB entry, or one dated years off), but never pick between
	// several — that's the remake case, where the year is the only discriminator.
	return candidates.length === 1 ? candidates[0]!.providerId : null;
}

/**
 * The looser second pass, for a film no result names outright: the one film
 * released in the *exact* same year whose title is the same but for an article or
 * a subtitle. It recovers real films a strict match can't reach — TMDB files
 * "Glass Onion" under "Glass Onion: A Knives Out Mystery" and "School of Rock"
 * under "The School of Rock".
 *
 * Three guards keep it honest, and all three are load-bearing:
 * - it is only consulted when `pickMovieMatch` found nothing;
 * - the years must be *identical* (no slop);
 * - exactly one candidate may survive, so it never chooses among the near-titles
 *   a franchise throws off ("Afro Samurai Pilot" and "Afro Samurai the Movie").
 *
 * Crucially, it must be run against an *unfiltered* search — never one already
 * narrowed to a year. Given every same-titled film TMDB has, an exact title match
 * from another year vetoes the loose pass (that's `pickMovieMatch` returning
 * non-null, or the caller seeing candidates it won't choose between). Narrow the
 * results to one year first and that veto disappears: searching 2024 for "Dune"
 * returns only "Dune: Part Two", and nothing is left to say it's the wrong film.
 */
export function pickMovieVariantMatch(
	results: SearchResult[],
	title: string,
	year?: string,
): string | null {
	const target = yearNumber(year);
	if (target === undefined) return null;

	const wanted = normalizeTitle(title);
	// A film TMDB does carry under this exact title, in some other year, means the
	// title is real and this simply isn't that film. Don't reach for a variant.
	if (results.some((r) => normalizeTitle(r.title) === wanted)) return null;

	const candidates = results.filter(
		(r) => yearNumber(r.year) === target && titlesNameSameFilm(r.title, title),
	);
	return candidates.length === 1 ? candidates[0]!.providerId : null;
}
