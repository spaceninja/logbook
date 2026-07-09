import type { Item, ItemStatus, MediaType } from '../types/item';

/**
 * Types for the bulk-import pipeline (issue #20). A service parser turns an
 * export file into `ImportRecord[]`; the pipeline resolves each record to an
 * item id, enriches new ids via a provider, and merges the record's
 * contribution into the existing/new item (see `merge.ts`).
 */

/** The four services we can import from. */
export type ImportSource =
	'goodreads' | 'letterboxd' | 'trakt' | 'infinite-backlog';

/**
 * Which half of an export a record came from. The importer ingests a whole
 * export in one pass; this drives the preview breakdown and the History/Backlog
 * toggles (the split lives here, not in separate buttons).
 */
export type ImportSection = 'history' | 'backlog';

/**
 * Whether a source may overwrite an existing `my_rating` or only fill it when
 * empty. Encodes cross-source precedence without tracking provenance: the
 * lower-precedence source for a given type uses `fill`, so it never clobbers the
 * canonical source's value (or a manual edit). Movies: Letterboxd `overwrite`,
 * Trakt `fill`. Everything else `overwrite`.
 */
export type RatingAuthority = 'overwrite' | 'fill';

/**
 * How to date a completed item the export left undated, chosen by the user on
 * the import screen (issue #20). `added`/`updated` use the export's date-added /
 * last-updated; `release` uses the item's (enriched) release date.
 */
export type DateFallback = 'added' | 'updated' | 'release';

/**
 * How to resolve a record's target item id and fetch its metadata. Every
 * variant but `tmdb-movie-search` yields a deterministic id with no network
 * call (see `resolveDirectId`); the search variant needs a TMDB title+year
 * lookup because Letterboxd exports carry no TMDB id.
 */
export type ResolveHint =
	| { kind: 'tmdb-movie'; tmdbId: string }
	| { kind: 'tmdb-season'; showTmdbId: string; season: number }
	| { kind: 'igdb'; igdbId: string }
	| { kind: 'goodreads-book'; bookId: string; isbn13?: string; isbn?: string }
	| { kind: 'tmdb-movie-search' };

/**
 * One normalized row from a service export, before id resolution / enrichment.
 * `title`/`year` are kept for the preview, fuzzy matching, and the review queue.
 */
export interface ImportRecord {
	source: ImportSource;
	section: ImportSection;
	type: MediaType;
	resolve: ResolveHint;
	/** Intent for this record: history rows carry `complete`/`dnf`, backlog rows `backlog`/`in_progress`. */
	status: ItemStatus;
	/** ISO dates/datetimes; normalized to day and unioned at merge time. */
	completedDates: string[];
	/**
	 * The export's date-added / last-updated for this row, used to date an undated
	 * completion per the user's chosen fallback. An empty completion on a history
	 * record marks a completed-but-undated item for the pipeline to fill.
	 */
	addedDate?: string;
	updatedDate?: string;
	/** Owner rating already normalized to the 0–10 scale, if the export had one. */
	myRating?: number;
	/** True when the export signals ownership (IB `Owned`, Goodreads `Owned Copies > 0`). */
	isPurchased?: boolean;
	ratingAuthority: RatingAuthority;
	title: string;
	year?: string;
	/**
	 * A base item built from the export's own fields, used as the enrichment base
	 * when a provider lookup can't supply one — Goodreads books that carry no ISBN
	 * (about a third of them) or whose ISBN has no Google Books match. Already
	 * carries the deterministic id/provider, so the merge treats it like any base.
	 */
	fallbackDraft?: Item;
}

/**
 * The subset of an `ImportRecord` the merge engine needs once the id is known.
 * (Metadata/enrichment is handled separately and only for brand-new ids.)
 */
export interface ImportContribution {
	status: ItemStatus;
	/** Real completion dates from the export; unioned into the item. */
	completedDates: string[];
	/**
	 * A date to backfill an undated completion, applied only if the item has no
	 * completion date left after merging. The chosen date fallback for a history
	 * record the export left undated.
	 */
	fallbackDate?: string;
	/**
	 * Days that were (or would be) import-generated fallbacks for this item — its
	 * date-added / last-updated / release day. Any existing completion date
	 * matching one is stripped before merging, so changing the date-fallback
	 * choice replaces the old placeholder instead of stacking a second date (#20).
	 */
	replaceableDays?: string[];
	myRating?: number;
	isPurchased?: boolean;
	ratingAuthority: RatingAuthority;
}

/**
 * An export's files as `basename → text`. Loose uploads and unzipped archive
 * entries both land here, so a parser finds the files it needs by name pattern
 * regardless of how the user supplied them.
 */
export type ImportFileMap = Map<string, string>;

/** What a service parser returns from a set of export files. */
export interface ParseResult {
	records: ImportRecord[];
	/** Rows we could not import, surfaced in the preview (e.g. missing provider id). */
	skipped: { title: string; reason: string }[];
}

/** A service's parser: pure `files → records`, unit-tested against fixtures. */
export interface ServiceParser {
	source: ImportSource;
	label: string;
	parse: (files: ImportFileMap) => ParseResult;
}
