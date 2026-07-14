import { chooseFallbackDate, coerceIsoDay } from '~~/shared/import/dates';
import { pickMovieMatch, pickMovieVariantMatch } from '~~/shared/import/match';
import { applyContribution, toContribution } from '~~/shared/import/merge';
import { resolveDirectId } from '~~/shared/import/resolve';
import type {
	DateFallback,
	ImportContribution,
	ImportRecord,
	ImportSection,
	ResolveHint,
} from '~~/shared/import/types';
import { normalizeTitle } from '~~/shared/providers/helpers';
import type { BookMetadata, Item, MediaType } from '~~/shared/types/item';
import type { SearchResult } from '~~/shared/types/search';
import { makeMovieId } from '~~/shared/utils/itemId';

/**
 * Which stage the import is in, so the UI can show something during the phases
 * with no per-item progress: `matching` (title+year → TMDB id, Letterboxd only),
 * `reading` (batched existence prefetch) and `saving` (the bulk write) bracket
 * the per-item `importing` loop.
 */
export type ImportPhase = 'matching' | 'reading' | 'importing' | 'saving';

/** Live progress for the importer's progress bar. `total` counts unique items. */
export interface ImportProgress {
	phase: ImportPhase;
	total: number;
	processed: number;
	created: number;
	updated: number;
	unchanged: number;
}

export interface ImportSummary {
	created: number;
	updated: number;
	/** Existing items whose merged result was identical — not re-written. */
	unchanged: number;
	/** Items we couldn't resolve/enrich (no fallback to import from, or a failed lookup). */
	skipped: { title: string; reason: string }[];
	/**
	 * Items the metadata provider had no match for (a book Google Books doesn't
	 * carry, a film TMDB's movie index doesn't), imported from the export's own
	 * fields — so they carry no cover or description and are worth re-sourcing by
	 * hand.
	 */
	unmatched: { title: string }[];
}

/** Whether the merge changed any import-owned field vs the existing doc. */
function importChanged(existing: Item, merged: Item): boolean {
	return (
		existing.status !== merged.status ||
		existing.my_rating !== merged.my_rating ||
		existing.is_purchased !== merged.is_purchased ||
		!sameDates(existing.completed_dates, merged.completed_dates)
	);
}

/** Compare completion dates as sets — order is not significant. */
function sameDates(a: string[], b: string[]): boolean {
	if (a.length !== b.length) return false;
	const set = new Set(a);
	return b.every((date) => set.has(date));
}

/**
 * The contribution for a record, dating an undated completion with the user's
 * chosen fallback — the export's date-added / last-updated, or the item's
 * (enriched) release date — preferring the chosen source but taking whichever is
 * available. The merge engine day-normalizes the result.
 */
function effectiveContribution(
	record: ImportRecord,
	base: Item,
	dateFallback: DateFallback,
): ImportContribution {
	const contribution = toContribution(record);
	if (record.section !== 'history') return contribution; // backlog: no dates

	// This item's import-generated fallback candidates — an existing completion
	// date matching one is a stale placeholder the merge may replace. Coerced to
	// whole days so a prior year-only release fallback is recognized and replaced.
	const candidates = {
		added: record.addedDate,
		updated: record.updatedDate,
		release: base.release_date,
	};
	const replaceableDays = [
		candidates.added,
		candidates.updated,
		candidates.release,
	]
		.map(coerceIsoDay)
		.filter((day): day is string => day !== undefined);

	// A real completion date from the export: union it (stripping stale fallbacks).
	if (contribution.completedDates.length > 0) {
		return { ...contribution, replaceableDays };
	}

	// Undated completion: backfill the first usable date in the chosen preference
	// order, so a completion is essentially never left undated by an import.
	const fallbackDate = chooseFallbackDate(candidates, dateFallback);
	return { ...contribution, replaceableDays, fallbackDate };
}

/** The HTTP status of a failed `$fetch`, if it carried one. */
function statusOf(error: unknown): number | undefined {
	const e = error as { statusCode?: number; status?: number };
	return e?.statusCode ?? e?.status;
}

/** A diagnostic reason for a failed enrichment: the error message and any status code. */
function describeError(error: unknown): string {
	const e = error as { statusMessage?: string; message?: string };
	const code = statusOf(error);
	const message = e?.statusMessage || e?.message || 'Lookup failed';
	return code ? `${message} (${code})` : message;
}

/** How many item ids to enrich in parallel. Keeps provider APIs from being hammered. */
const CONCURRENCY = 4;

/**
 * How many TMDB title searches to run in parallel. Higher than the enrichment
 * pool: a first Letterboxd run has to match every film (~1,700 of them) before it
 * can even tell which are already imported, and TMDB's rate limit (~50 req/s) has
 * plenty of headroom for this.
 */
const MATCH_CONCURRENCY = 8;

/**
 * Where resolved title+year → TMDB id matches are remembered between runs. The
 * matching phase is by far the most expensive part of a Letterboxd import and its
 * answers don't change, so caching them makes a re-import (and the resumable
 * `limit` run below) cheap. Films TMDB has no match for are cached too, as `''`.
 */
const MATCH_CACHE_KEY = 'logbook:movie-matches';

type MatchCache = Map<string, string>;

function loadMatchCache(): MatchCache {
	try {
		const raw = localStorage.getItem(MATCH_CACHE_KEY);
		return new Map(Object.entries(raw ? JSON.parse(raw) : {}));
	} catch {
		return new Map(); // unparseable or unavailable: just match everything again
	}
}

function saveMatchCache(cache: MatchCache): void {
	try {
		localStorage.setItem(
			MATCH_CACHE_KEY,
			JSON.stringify(Object.fromEntries(cache)),
		);
	} catch {
		// Full or blocked storage only costs us the cache, not the import.
	}
}

/** The cache/grouping key for a film with no provider id: its normalized title and year. */
function movieKey(record: ImportRecord): string {
	return `${normalizeTitle(record.title)}|${record.year ?? ''}`;
}

/** How many not-yet-imported items a dev-only "fast import" run processes. */
export const FAST_IMPORT_LIMIT = 100;

/** Attempts per item before giving up — absorbs transient read/lookup blips. */
const ITEM_ATTEMPTS = 3;

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Turn a resolve hint into an `/api/draft` request (by-id enrichment). Returns
 * null for hints that don't enrich by id alone: Goodreads books go through
 * `enrichBook` (ISBN/title lookup), and a Letterboxd film only reaches here as
 * `tmdb-movie` once the matching phase has resolved its id — a `tmdb-movie-search`
 * hint still standing means TMDB had no match, and it imports from its fallback.
 */
function draftRequest(
	resolve: ResolveHint,
): { type: MediaType; params: Record<string, string | number> } | null {
	switch (resolve.kind) {
		case 'igdb':
			return { type: 'game', params: { id: resolve.igdbId } };
		case 'tmdb-movie':
			return { type: 'movie', params: { id: resolve.tmdbId } };
		case 'tmdb-season':
			return {
				type: 'show',
				params: { id: resolve.showTmdbId, season: resolve.season },
			};
		case 'goodreads-book':
		case 'tmdb-movie-search':
			return null;
	}
}

/** First author from a `creator`, for a Google Books title+author search. */
function firstAuthor(creator: Item['creator']): string | undefined {
	return Array.isArray(creator) ? creator[0] : creator;
}

/**
 * The client-orchestrated import pipeline (issue #20). Groups records by their
 * resolved item id, enriches only brand-new ids (existing docs are read and
 * merged onto, never re-fetched), applies each record's contribution via the
 * merge engine, then bulk-writes. Idempotent: re-running over a newer export
 * updates in place without duplicating.
 */
export function useImport() {
	const { getItemsByIds, saveItems } = useItems();

	/**
	 * A Google Books draft for a book by ISBN then title/author, or the export's
	 * own `fallbackDraft` when neither matches — stamped with the deterministic
	 * Goodreads id/provider so a re-import matches without re-doing the lookup. A
	 * 404 (no match) falls through; a transient failure rethrows so the caller
	 * retries it. `matched` is false when we fell back, so the caller can report
	 * the book as imported without a cover or description.
	 */
	async function enrichBook(
		record: ImportRecord,
	): Promise<{ item: Item; matched: boolean } | null> {
		const { resolve, fallbackDraft } = record;
		if (resolve.kind !== 'goodreads-book') return null;

		const isbn = resolve.isbn13 ?? resolve.isbn;
		const found =
			(isbn ? await tryBook({ isbn }) : null) ??
			(await tryBook({
				title: record.title,
				author: firstAuthor(fallbackDraft?.creator) ?? '',
			}));
		const draft = found ?? fallbackDraft ?? null;
		if (!draft) return null;

		// Google Books has no series data, so the series parsed from the Goodreads
		// title (carried on the fallback draft) is the only source — merge it onto
		// an enriched draft, whose metadata holds only the volume id and ISBN.
		const { series, series_number } = (fallbackDraft?.metadata ??
			{}) as BookMetadata;
		return {
			item: {
				...draft,
				id: resolveDirectId(resolve)!,
				provider: 'goodreads',
				metadata: {
					...draft.metadata,
					...(series ? { series } : {}),
					...(series_number !== undefined ? { series_number } : {}),
				},
			},
			matched: found !== null,
		};
	}

	/** `/api/book` lookup: the draft, null on a 404 (no match), rethrow otherwise. */
	async function tryBook(params: Record<string, string>): Promise<Item | null> {
		try {
			return await $fetch<Item>('/api/book', { params });
		} catch (error) {
			if (statusOf(error) === 404) return null;
			throw error;
		}
	}

	/**
	 * Merge one id's records onto its base item. `existing` is the current
	 * Firestore doc (from the batched prefetch) or undefined for a brand-new id,
	 * which is enriched via `/api/draft` (books via `enrichBook`). Returns null
	 * when a new id can't be enriched and the export offers no fallback to import
	 * from.
	 */
	async function buildItem(
		existing: Item | undefined,
		group: ImportRecord[],
		dateFallback: DateFallback,
	): Promise<{ item: Item; isNew: boolean; unmatched: boolean } | null> {
		const first = group[0]!;
		let base: Item;
		let isNew: boolean;
		let unmatched = false;

		if (existing) {
			base = existing;
			isNew = false;
		} else if (first.resolve.kind === 'goodreads-book') {
			const enriched = await enrichBook(first);
			if (!enriched) return null;
			base = enriched.item;
			unmatched = !enriched.matched;
			isNew = true;
		} else if (first.resolve.kind === 'tmdb-movie-search') {
			// The matching phase rewrites a matched film's hint to `tmdb-movie`, so a
			// search hint still standing here means TMDB had nothing: import the film
			// from Letterboxd's own fields rather than lose the watch history.
			if (!first.fallbackDraft) return null;
			base = first.fallbackDraft;
			unmatched = true;
			isNew = true;
		} else {
			const request = draftRequest(first.resolve);
			if (!request) return null; // not enrichable by id
			base = await $fetch<Item>('/api/draft', {
				params: { type: request.type, ...request.params },
			});
			isNew = true;
		}

		// The owner's own review, kept only on an item this import creates — `notes`
		// is a user-owned field, so a re-import must never overwrite what's there.
		const notes = group.find((record) => record.notes)?.notes;
		if (isNew && notes && !base.notes) base = { ...base, notes };

		let item = base;
		for (const record of group) {
			item = applyContribution(
				item,
				effectiveContribution(record, base, dateFallback),
			);
		}
		return { item, isNew, unmatched };
	}

	/**
	 * `buildItem` with a few retries and backoff. Enrichment (`/api/draft`) can
	 * blip transiently under bulk load; retrying recovers nearly all of those. A
	 * `null` return (no by-id lookup for this source) is deterministic, not an
	 * error, so it is passed through without retrying. Existing items no longer
	 * touch the network here — they were prefetched in one batch.
	 */
	async function buildItemResilient(
		existing: Item | undefined,
		group: ImportRecord[],
		dateFallback: DateFallback,
	): Promise<{ item: Item; isNew: boolean; unmatched: boolean } | null> {
		for (let attempt = 1; ; attempt++) {
			try {
				return await buildItem(existing, group, dateFallback);
			} catch (error) {
				if (attempt >= ITEM_ATTEMPTS) throw error;
				await sleep(400 * attempt);
			}
		}
	}

	/**
	 * The TMDB id for a film the export named but couldn't identify, via a title
	 * search scored against the export's title+year (see `pickMovieMatch`). Null
	 * when TMDB has no confident match — the film is then imported from the
	 * export's own fields. Answers are cached across runs.
	 */
	async function matchMovie(
		record: ImportRecord,
		cache: MatchCache,
	): Promise<string | null> {
		const key = movieKey(record);
		const cached = cache.get(key);
		if (cached !== undefined) return cached || null;

		const search = (year?: string) =>
			$fetch<SearchResult[]>('/api/search', {
				params: { type: 'movie', q: record.title, ...(year ? { year } : {}) },
			});

		// Scoped to the export's year first, which lifts the right film above the
		// popular ones sharing its title (the 2020 "Hamilton" doesn't otherwise make
		// TMDB's first page). Only a strict match is allowed against these results:
		// they're one year deep, so nothing in them can contradict a loose guess.
		const { title, year } = record;
		let tmdbId = pickMovieMatch(await search(year), title, year);

		// Nothing: search TMDB whole. The export's year can disagree with TMDB's by
		// one (a festival run against a release), which the scoped search can't see
		// past — and only against every same-titled film TMDB has is it safe to try
		// matching through an article or a subtitle.
		if (!tmdbId && year) {
			const wide = await search();
			tmdbId =
				pickMovieMatch(wide, title, year) ??
				pickMovieVariantMatch(wide, title, year);
		}

		cache.set(key, tmdbId ?? '');
		return tmdbId;
	}

	/** `matchMovie` with the same few retries as enrichment — searches blip too. */
	async function matchMovieResilient(
		record: ImportRecord,
		cache: MatchCache,
	): Promise<string | null> {
		for (let attempt = 1; ; attempt++) {
			try {
				return await matchMovie(record, cache);
			} catch (error) {
				if (attempt >= ITEM_ATTEMPTS) throw error;
				await sleep(400 * attempt);
			}
		}
	}

	/**
	 * `limit` caps the run at that many ids that don't exist in Firestore yet, so
	 * re-running picks up where the last one stopped. Existing items are then left
	 * untouched — a limited run can't update them the way a full run would.
	 */
	async function runImport(
		records: ImportRecord[],
		sections: ImportSection[],
		dateFallback: DateFallback,
		onProgress: (progress: ImportProgress) => void,
		limit?: number,
	): Promise<ImportSummary> {
		const skipped: ImportSummary['skipped'] = [];
		const unmatched: ImportSummary['unmatched'] = [];

		/** Records that share a target item id, and so merge into one item. */
		const groups = new Map<string, ImportRecord[]>();
		const addTo = (
			map: Map<string, ImportRecord[]>,
			key: string,
			r: ImportRecord,
		) => {
			const group = map.get(key);
			if (group) group.push(r);
			else map.set(key, [r]);
		};

		// Records whose id is known up front group by it now. The rest (Letterboxd
		// films, which no export file gives a TMDB id for) group by title+year until
		// the matching phase can turn that into an id.
		const toMatch = new Map<string, ImportRecord[]>();
		for (const record of records) {
			if (!sections.includes(record.section)) continue;
			const id = resolveDirectId(record.resolve);
			if (id) addTo(groups, id, record);
			else addTo(toMatch, movieKey(record), record);
		}

		let ids: string[] = [];
		const toWrite: Item[] = [];
		let phase: ImportPhase = toMatch.size > 0 ? 'matching' : 'reading';
		let total = toMatch.size;
		let processed = 0;
		let created = 0;
		let updated = 0;
		let unchanged = 0;
		let cursor = 0;

		const report = () =>
			onProgress({ phase, total, processed, created, updated, unchanged });
		report();

		// --- Matching: title+year → TMDB id, so every record has a target item id.
		if (toMatch.size > 0) {
			const cache = loadMatchCache();
			const pending = [...toMatch.values()];

			async function matcher(): Promise<void> {
				while (cursor < pending.length) {
					const group = pending[cursor++]!;
					try {
						const tmdbId = await matchMovieResilient(group[0]!, cache);
						if (tmdbId) {
							// Now identified: rewrite the hint so the rest of the pipeline
							// treats these exactly like records that shipped with an id.
							const resolve: ResolveHint = { kind: 'tmdb-movie', tmdbId };
							for (const record of group) {
								addTo(groups, makeMovieId('tmdb', tmdbId), {
									...record,
									resolve,
								});
							}
						} else {
							// No match: `buildItem` imports these from the export's own
							// fields, under the id their fallback draft already carries.
							const id = group[0]!.fallbackDraft?.id;
							if (id) for (const record of group) addTo(groups, id, record);
							else
								skipped.push({
									title: group[0]!.title,
									reason: 'No TMDB match',
								});
						}
					} catch (error) {
						skipped.push({
							title: group[0]!.title,
							reason: describeError(error),
						});
					}
					processed++;
					report();
				}
			}

			await Promise.all(
				Array.from(
					{ length: Math.min(MATCH_CONCURRENCY, pending.length) },
					matcher,
				),
			);
			saveMatchCache(cache);
			cursor = 0;
		}

		ids = [...groups.keys()];
		phase = 'reading';
		total = ids.length;
		processed = 0;
		report();

		// Prefetch every existing item in one batched pass so the worker loop does
		// no per-item Firestore reads (those stall under long-poll load). On a
		// re-import almost everything is already here, so no enrichment runs at all.
		const existingItems = await getItemsByIds(ids);

		// The prefetch is what makes a limited run resumable: ids already in
		// Firestore were imported by an earlier run, so dropping them and taking the
		// next `limit` advances through the export. Group order follows the export's
		// row order, so the slice is stable across runs. (Matching can't be limited
		// the same way — an id has to exist before we can ask whether it's imported —
		// but its answers are cached, so only the first run pays for it.)
		if (limit !== undefined) {
			ids = ids.filter((id) => !existingItems.has(id)).slice(0, limit);
		}

		phase = 'importing';
		total = ids.length;
		report();

		async function worker(): Promise<void> {
			while (cursor < ids.length) {
				const id = ids[cursor++]!;
				const group = groups.get(id)!;
				const existing = existingItems.get(id);
				try {
					const built = await buildItemResilient(existing, group, dateFallback);
					if (!built) {
						skipped.push({
							title: group[0]!.title,
							reason: 'No metadata match and nothing to fall back to',
						});
					} else if (built.isNew) {
						toWrite.push(built.item);
						created++;
						if (built.unmatched) unmatched.push({ title: built.item.title });
					} else if (existing && importChanged(existing, built.item)) {
						// Only re-write existing docs whose merged result actually differs.
						toWrite.push(built.item);
						updated++;
					} else {
						unchanged++;
					}
				} catch (error) {
					// A single failed lookup shouldn't abort the whole import.
					skipped.push({
						title: group[0]!.title,
						reason: describeError(error),
					});
				}
				processed++;
				report();
			}
		}

		await Promise.all(
			Array.from({ length: Math.min(CONCURRENCY, ids.length) }, worker),
		);

		phase = 'saving';
		report();
		await saveItems(toWrite);
		return { created, updated, unchanged, skipped, unmatched };
	}

	return { runImport };
}
