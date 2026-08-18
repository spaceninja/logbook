import { authorsMatch, normalizeTitle } from '../providers/helpers';
import type { BookMetadata, Item } from '../types/item';
import { unionDates } from './merge';

/**
 * Finding and absorbing an *app-created twin* — the second document a book ends
 * up with when it is added through the app's search and also shelved on Goodreads
 * (issue #105).
 *
 * The two paths mint different ids: the app keys a book by its Google Books volume
 * (`book-google-books-<volumeId>`), the daily sync by its Goodreads book id
 * (`book-goodreads-<bookId>`). The id spaces never collide, so the same book can
 * hold two independent documents, and the sync — which only ever reads the ids it
 * derives from the feed — can't see the app-created one to refresh it.
 *
 * Matching has to be by title and author, not ISBN. ISBN identifies an *edition*,
 * and the edition the owner picked in the app is almost never the edition they
 * shelved on Goodreads: across the five real duplicates in prod, zero pairs shared
 * an ISBN (e.g. "The Dracula Tape" — 9780671578398 on the shelf, 9780812525816 in
 * the app). ISBN is still tried first as an exact-identity fast path for the rare
 * case where the editions do agree.
 */

/**
 * Abbreviations that differ purely by how a service renders a collected volume.
 * Goodreads writes "Saga, Volume 3" where Google Books writes "Saga Vol. 3" — the
 * same book, but neither title is a prefix of the other, so `titlesMatch` alone
 * misses it. Expansion is one-directional (short → long) so both sides converge.
 *
 * Deliberately excludes `#`: in comics "Saga #1" is a single issue and "Saga, Vol.
 * 1" is the collection that reprints it. Those are different records and must not
 * be folded together — prod holds both.
 */
const ABBREVIATIONS: Record<string, string> = {
	vol: 'volume',
	vols: 'volume',
	pt: 'part',
	bk: 'book',
};

/**
 * A title reduced to the form two providers can agree on: `normalizeTitle`'s
 * casefold/strip, plus the volume-word expansions above.
 */
export function bookTitleKey(title: string): string {
	return normalizeTitle(title)
		.split(' ')
		.map((word) => ABBREVIATIONS[word] ?? word)
		.join(' ')
		.trim();
}

/**
 * Whether two titles name the same book: equal once normalized and expanded.
 *
 * Deliberately stricter than `providers/helpers.titlesMatch`, which also accepts
 * a prefix either way to tolerate a subtitle one side drops. That rule is wrong
 * here — it makes "Dune Messiah" match "Dune", and absorbing the wrong twin moves
 * notes and purchase state onto an unrelated book with no way back. All five real
 * duplicates in prod match exactly once the abbreviations above are expanded, so
 * prefix tolerance would buy nothing and only widen the blast radius. Loosening
 * this should be a deliberate choice backed by a case that needs it.
 */
export function bookTitlesMatch(candidate: string, wanted: string): boolean {
	return bookTitleKey(candidate) === bookTitleKey(wanted);
}

/** The 10- or 13-digit ISBN a book records, normalized to digits. */
function isbnOf(item: Item): string | undefined {
	const raw = (item.metadata as BookMetadata | undefined)?.isbn;
	const digits = (raw ?? '').replace(/[^0-9Xx]/g, '').toUpperCase();
	return digits.length === 10 || digits.length === 13 ? digits : undefined;
}

/** What a book the sync is about to create was matched against, if anything. */
export type TwinMatch =
	| { kind: 'none' }
	| { kind: 'isbn' | 'title'; twin: Item }
	| { kind: 'ambiguous'; candidates: Item[] };

/**
 * The app-created document naming the same book as `target`, among `candidates`.
 *
 * A title hit that draws more than one candidate is `ambiguous` and left alone:
 * absorbing the wrong twin moves someone's notes and purchase state onto an
 * unrelated book, and that is not recoverable from the feed. Callers are expected
 * to report ambiguity rather than guess.
 */
export function findBookTwin(candidates: Item[], target: Item): TwinMatch {
	const wantedIsbn = isbnOf(target);
	if (wantedIsbn) {
		const exact = candidates.filter((c) => isbnOf(c) === wantedIsbn);
		if (exact.length === 1) return { kind: 'isbn', twin: exact[0]! };
	}

	const matches = candidates.filter(
		(c) =>
			bookTitlesMatch(c.title, target.title) &&
			authorsMatch(c.creator, target.creator),
	);
	if (matches.length === 1) return { kind: 'title', twin: matches[0]! };
	if (matches.length > 1) return { kind: 'ambiguous', candidates: matches };
	return { kind: 'none' };
}

/** A user-owned field the twin carried across, for logging. */
export interface CarriedField {
	field: string;
	value: unknown;
}

/**
 * Fold the twin's user-owned fields onto the Goodreads document. The Goodreads
 * side wins any field it already holds — it is the document the sync keeps
 * current — except the booleans, where either side saying "yes" is the answer,
 * and `completed_dates`, which unions.
 *
 * Tags are deliberately *not* carried: an app-created book's tags come from Google
 * Books' `categories`, which are auto-derived rather than chosen ("bilingual
 * materials", "astronauts"), while the Goodreads document's come from Hardcover.
 */
export function absorbTwin(
	keeper: Item,
	twin: Item,
): { item: Item; carried: CarriedField[] } {
	const item: Item = { ...keeper };
	const carried: CarriedField[] = [];

	if (twin.notes && !item.notes) {
		item.notes = twin.notes;
		carried.push({ field: 'notes', value: twin.notes });
	}
	if (twin.recommended_by && !item.recommended_by) {
		item.recommended_by = twin.recommended_by;
		carried.push({ field: 'recommended_by', value: twin.recommended_by });
	}
	if (twin.my_rating !== undefined && item.my_rating === undefined) {
		item.my_rating = twin.my_rating;
		carried.push({ field: 'my_rating', value: twin.my_rating });
	}
	if (twin.is_purchased && !item.is_purchased) {
		item.is_purchased = true;
		carried.push({ field: 'is_purchased', value: true });
	}
	if (twin.is_prioritized && !item.is_prioritized) {
		item.is_prioritized = true;
		carried.push({ field: 'is_prioritized', value: true });
	}

	const dates = unionDates(
		item.completed_dates ?? [],
		twin.completed_dates ?? [],
	);
	if (dates.length > (item.completed_dates ?? []).length) {
		item.completed_dates = dates;
		carried.push({ field: 'completed_dates', value: dates });
	}

	return { item, carried };
}
