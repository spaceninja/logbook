import type { Item } from '../types/item';
import { normalizeTags, round2 } from './helpers';

/**
 * Hardcover (hardcover.app) supplemental enrichment — pure mapping only, no
 * network (the fetch layer lives in `server/utils/hardcover.ts` for Nitro and
 * `scripts/lib/hardcover.ts` for the sync script, both of which use these
 * mappers). Hardcover is the source of Goodreads-quality community **genre tags**
 * that neither Goodreads' RSS/CSV nor Google Books expose, plus a community
 * rating used only to fill a gap (never to override Goodreads).
 *
 * Books are matched by ISBN → edition → `edition.book`. Tags/ratings are
 * work-level (identical across every edition of a work), and ISBN matching only
 * ever reaches the canonical, editions-bearing record, so the stored ISBN's
 * edition doesn't matter.
 */

/** One entry in a `cached_tags` category: the tag label and how many users applied it. */
export interface HardcoverTag {
	tag?: string;
	count?: number;
}

/** `books.cached_tags` — a JSON object keyed by category. We read `Genre`. */
export type HardcoverCachedTags = Partial<
	Record<'Genre' | 'Mood' | 'Content Warning' | 'Tag', HardcoverTag[]>
>;

/** The `book` fields the enrichment reads (canonical record, reached via ISBN). */
export interface HardcoverBookNode {
	id: number;
	/** Non-null only on a duplicate record, pointing at the canonical id. */
	canonical_id?: number | null;
	/** Community rating, 0–5 (null when unrated). */
	rating?: number | null;
	ratings_count?: number | null;
	cached_tags?: HardcoverCachedTags | null;
}

/** One `editions` row from an ISBN lookup, carrying its canonical book. */
export interface HardcoverEdition {
	isbn_13?: string | null;
	isbn_10?: string | null;
	book?: HardcoverBookNode | null;
}

/** The normalized enrichment applied onto an `Item`. */
export interface HardcoverEnrichment {
	/** Canonical Hardcover book id, stringified for `metadata.hardcover_id`. */
	hardcoverId: string;
	/** Community genre tags, filtered + normalized, most-applied first. */
	tags: string[];
	/** Community rating on the 0–10 scale, or undefined when unrated. */
	communityRating?: number;
	ratingsCount?: number;
}

/**
 * Hardcover shelf-style tags that are storage/format/status noise rather than
 * genres. Compared lowercased. Also drops purely-numeric tags (Hardcover carries
 * a few timestamp-named junk genres, e.g. `1735854369098`).
 */
const TAG_DENYLIST = new Set([
	'calibre import',
	'audible',
	'audiobook',
	'ebook',
	'kindle',
	'paperback',
	'hardcover',
	'owned',
	'library',
	'wishlist',
	'to-read',
	'currently-reading',
	'read',
	'favorites',
	'default',
	'book club',
	'arc',
	'netgalley',
	'dnf',
]);

function isJunkTag(name: string): boolean {
	const lower = name.trim().toLowerCase();
	if (!lower) return true;
	if (/^\d+$/.test(lower)) return true; // timestamp-named junk genres
	return TAG_DENYLIST.has(lower);
}

/**
 * `cached_tags.Genre` → a clean tag list: junk dropped, sorted by how many users
 * applied each (most-relevant first), then lowercased/de-duplicated. The direct
 * Goodreads-genre analog.
 */
export function hardcoverGenreTags(
	cached: HardcoverCachedTags | null | undefined,
): string[] {
	const genres = cached?.Genre ?? [];
	const ordered = [...genres]
		.sort((a, b) => (b.count ?? 0) - (a.count ?? 0))
		.map((g) => g.tag)
		.filter((tag): tag is string => !!tag && !isJunkTag(tag));
	return normalizeTags(ordered);
}

/** Hardcover ratings are 0–5 (null/0 = unrated); normalize to the 0–10 scale. */
export function hardcoverRating(
	rating: number | null | undefined,
): number | undefined {
	return typeof rating === 'number' && rating > 0
		? round2(rating * 2)
		: undefined;
}

/** A canonical book node → the normalized enrichment, or null when unusable. */
export function mapHardcoverBook(
	book: HardcoverBookNode | null | undefined,
): HardcoverEnrichment | undefined {
	if (!book?.id) return undefined;
	// A duplicate record points home via canonical_id; ISBN lookups never hit one,
	// but resolve it anyway so a title-search path can't store an orphan id.
	const hardcoverId = String(book.canonical_id ?? book.id);
	const enrichment: HardcoverEnrichment = {
		hardcoverId,
		tags: hardcoverGenreTags(book.cached_tags),
	};
	const rating = hardcoverRating(book.rating);
	if (rating !== undefined) {
		enrichment.communityRating = rating;
		if (typeof book.ratings_count === 'number')
			enrichment.ratingsCount = book.ratings_count;
	}
	return enrichment;
}

/**
 * Editions from a batched ISBN lookup → a map keyed by *every* ISBN (13 and 10)
 * the edition carried, so a caller can look up whichever ISBN it holds.
 */
export function enrichmentsByIsbn(
	editions: HardcoverEdition[],
): Map<string, HardcoverEnrichment> {
	const byIsbn = new Map<string, HardcoverEnrichment>();
	for (const edition of editions) {
		const enrichment = mapHardcoverBook(edition.book);
		if (!enrichment) continue;
		for (const isbn of [edition.isbn_13, edition.isbn_10]) {
			if (isbn && !byIsbn.has(isbn)) byIsbn.set(isbn, enrichment);
		}
	}
	return byIsbn;
}

/**
 * Layer a Hardcover enrichment onto a book item. Tags prefer Hardcover (kept only
 * when it actually has genres, so a match with none doesn't wipe Google's
 * categories); `hardcover_id` is always stamped once matched (so it won't be
 * re-queried); the community rating fills only a gap — an existing rating
 * (Goodreads on synced books) is never overridden.
 */
export function applyHardcoverEnrichment(
	item: Item,
	enrichment: HardcoverEnrichment,
): Item {
	const next: Item = {
		...item,
		metadata: { ...item.metadata, hardcover_id: enrichment.hardcoverId },
	};
	if (enrichment.tags.length > 0) next.tags = enrichment.tags;
	if (
		next.community_rating === undefined &&
		enrichment.communityRating !== undefined
	)
		next.community_rating = enrichment.communityRating;
	return next;
}

/** GraphQL: batched ISBN → canonical book lookup. `_ilike` is banned; `_in` is fine. */
export const HARDCOVER_ISBN_QUERY = `
	query BooksByIsbn($isbns: [String!]!) {
		editions(where: { _or: [{ isbn_13: { _in: $isbns } }, { isbn_10: { _in: $isbns } }] }) {
			isbn_13
			isbn_10
			book { id canonical_id rating ratings_count cached_tags }
		}
	}`;

/** GraphQL: Typesense-backed title search → best book id (manual/title fallback). */
export const HARDCOVER_SEARCH_QUERY = `
	query SearchBook($q: String!) {
		search(query: $q, query_type: "Book", per_page: 1) { results }
	}`;

/** GraphQL: fetch one book's enrichment fields by (canonical) id. */
export const HARDCOVER_BOOK_QUERY = `
	query BookById($id: Int!) {
		books_by_pk(id: $id) { id canonical_id rating ratings_count cached_tags }
	}`;
