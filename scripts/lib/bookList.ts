import { normalizeTitle, titlesMatch } from '../../shared/providers/helpers';
import type { Item } from '../../shared/types/item';

/**
 * Matching and field-recovery logic for the one-time Book List migration
 * (`scripts/migrate-book-list.ts`). Book List was the predecessor app — a Vue +
 * Realtime Database reading list at `spaceninja-book-list` — and it holds four
 * hand-curated fields Logbook never received: whether a book was bought, whether
 * it was prioritized, who recommended it, and a personal note.
 *
 * Its books are keyed by ISBN and carry no Goodreads id, so they have to be
 * matched to Logbook items by ISBN first and title+author second. A wrong match
 * writes someone else's note onto a book, so the title path is guarded: the
 * authors must agree and exactly one candidate may survive. Anything ambiguous is
 * reported rather than guessed at.
 */

/** One record from `books/<uid>/<isbn>` in the Book List database. */
export interface BookListEntry {
	/** The record key — an ISBN-10/13, or an Amazon ASIN for ebook-only titles. */
	isbn: string;
	title: string;
	author_fname?: string;
	author_lname?: string;
	is_purchased?: boolean;
	is_prioritized?: boolean;
	/** Who recommended it — rendered as "Recommended by {{ source }}" in the old UI. */
	source?: string | null;
	note?: string | null;
	// Display fields, used only to draft a book Google Books can't resolve.
	blurb?: string | null;
	thumbnail?: string | null;
	release_date?: string | null;
	/** Page count, stored as a string by the old app. */
	length?: string | null;
}

/** The four fields this migration recovers. */
export type RecoveredField =
	'is_purchased' | 'is_prioritized' | 'recommended_by' | 'notes';

/**
 * Book List keys a book couldn't reach its Logbook item from, mapped to that
 * item's id. Each is a real match no rule can make, confirmed by hand:
 *
 * - `0316308595` — Book List misspells the author as "K.B. Wagners"; Logbook has
 *   the correct "K. B. Wagers", so no surname token is shared.
 * - `B07DW2PMS6`, `B07L9KLYPK` — Book List credits Sam Hughes, the author's legal
 *   name; Logbook credits qntm, the pen name he publishes under. Both are ASINs,
 *   so the ISBN path can't reach them either.
 */
export const MANUAL_MATCHES: Record<string, string> = {
	'0316308595': 'book-goodreads-28118539', // Behind the Throne
	B07DW2PMS6: 'book-goodreads-16066335', // Fine Structure
	B07L9KLYPK: 'book-goodreads-22635765', // Ra
};

/**
 * A bare ISBN-13, or `undefined` when the value isn't an ISBN at all (Book List
 * keys ebook-only titles by ASIN). Logbook stores both ISBN-10 and ISBN-13 —
 * 137 and 559 of prod's books respectively — so both sides normalize to the
 * 13-digit form before they're compared.
 */
export function isbn13(raw: string | undefined): string | undefined {
	// Strip separators only, never letters: Book List let you invent an id for an
	// unannounced book ("0000000000SOIAF"), and discarding the trailing letters
	// would leave ten digits that convert to a perfectly well-formed ISBN-13.
	const value = (raw ?? '').replace(/[\s-]/g, '');
	if (/^\d{13}$/.test(value)) return value;
	if (!/^\d{9}[\dXx]$/.test(value)) return undefined;
	const core = `978${value.slice(0, 9)}`;
	const sum = [...core].reduce(
		(total, digit, index) => total + (index % 2 === 0 ? 1 : 3) * Number(digit),
		0,
	);
	return `${core}${(10 - (sum % 10)) % 10}`;
}

/** Surname-length tokens of a name, for comparing two spellings of one author. */
function nameTokens(name: string): Set<string> {
	// Three characters filters out initials and particles ("J.", "de", "van"),
	// which are exactly the parts that differ between two renderings of a name.
	return new Set(
		normalizeTitle(name)
			.split(' ')
			.filter((token) => token.length >= 3),
	);
}

/** A Book List author as one string ("David" + "Pedreira" → "David Pedreira"). */
export function entryAuthor(entry: BookListEntry): string {
	return [entry.author_fname, entry.author_lname].filter(Boolean).join(' ');
}

/**
 * Whether two author strings plausibly name the same person. Book List and
 * Logbook disagree constantly on punctuation and middle names ("N.K. Jemisin" vs
 * "N. K. Jemisin", "Allen M. Steele" vs "Allen Steele", "Laura Lam" vs "L.R.
 * Lam"), so this asks only for one shared surname-length token. That's loose on
 * its own — it's only ever consulted alongside a title match on a single
 * candidate, where the title has already done the discriminating work.
 */
export function authorsAgree(
	entryName: string,
	creator: Item['creator'],
): boolean {
	const theirs = nameTokens(
		Array.isArray(creator) ? creator.join(' ') : (creator ?? ''),
	);
	if (theirs.size === 0) return false;
	return [...nameTokens(entryName)].some((token) => theirs.has(token));
}

/** How a Book List entry reached its Logbook item, or why it didn't. */
export type MatchKind = 'isbn' | 'title' | 'override' | 'ambiguous' | 'none';

export interface BookListMatch {
	entry: BookListEntry;
	item?: Item;
	kind: MatchKind;
	/** The competing candidates, when `kind` is `ambiguous`. */
	candidates?: Item[];
}

/**
 * Pair every Book List entry with its Logbook book. ISBN is tried first (an
 * exact-edition identity), then title+author, then the hand-confirmed overrides.
 * A title hit that draws more than one candidate is `ambiguous` and left alone —
 * Logbook holds several same-titled books ("Normal: Book 1" through "Book 4",
 * two editions of "I Am Legend"), and picking among them by guess is how the
 * wrong note gets written.
 */
export function matchEntries(
	entries: BookListEntry[],
	books: Item[],
): BookListMatch[] {
	const byIsbn = new Map<string, Item>();
	for (const book of books) {
		const isbn = isbn13((book.metadata as { isbn?: string }).isbn);
		// First writer wins: duplicate editions of one book are interchangeable
		// for the purpose of hanging a note on it.
		if (isbn && !byIsbn.has(isbn)) byIsbn.set(isbn, book);
	}
	const byId = new Map(books.map((book) => [book.id, book]));

	return entries.map((entry): BookListMatch => {
		const override = MANUAL_MATCHES[entry.isbn];
		if (override) {
			const item = byId.get(override);
			// A missing override target means the item was renamed or deleted —
			// surface it as unmatched rather than silently dropping the entry.
			if (item) return { entry, item, kind: 'override' };
		}

		const isbn = isbn13(entry.isbn);
		const byExactIsbn = isbn ? byIsbn.get(isbn) : undefined;
		if (byExactIsbn) return { entry, item: byExactIsbn, kind: 'isbn' };

		const author = entryAuthor(entry);
		const candidates = books.filter(
			(book) =>
				titlesMatch(book.title, entry.title) &&
				authorsAgree(author, book.creator),
		);
		if (candidates.length === 1) {
			return { entry, item: candidates[0], kind: 'title' };
		}
		if (candidates.length > 1) return { entry, kind: 'ambiguous', candidates };
		return { entry, kind: 'none' };
	});
}

/**
 * The item with any Book List field it's missing filled in, plus the names of the
 * fields that changed. Existing values are never overwritten and booleans only
 * flip false → true: Logbook is the system of record now, and Book List has been
 * read-only for years, so on any disagreement Logbook wins.
 */
export function applyRecovered(
	item: Item,
	entry: BookListEntry,
): { item: Item; changed: RecoveredField[] } {
	const next = { ...item };
	const changed: RecoveredField[] = [];

	if (entry.is_purchased && !next.is_purchased) {
		next.is_purchased = true;
		changed.push('is_purchased');
	}
	if (entry.is_prioritized && !next.is_prioritized) {
		next.is_prioritized = true;
		changed.push('is_prioritized');
	}
	const source = entry.source?.trim();
	if (source && !next.recommended_by) {
		next.recommended_by = source;
		changed.push('recommended_by');
	}
	const note = entry.note?.trim();
	if (note && !next.notes) {
		next.notes = note;
		changed.push('notes');
	}

	return { item: next, changed };
}
