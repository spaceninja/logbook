import { applyContribution, toContribution } from '~~/shared/import/merge';
import { resolveDirectId } from '~~/shared/import/resolve';
import type {
	DateFallback,
	ImportContribution,
	ImportRecord,
	ImportSection,
	ResolveHint,
} from '~~/shared/import/types';
import type { Item, MediaType } from '~~/shared/types/item';

/**
 * Which stage the import is in, so the UI can show something during the phases
 * with no per-item progress: `reading` (batched existence prefetch) and `saving`
 * (the bulk write) bracket the per-item `importing` loop.
 */
export type ImportPhase = 'reading' | 'importing' | 'saving';

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
	/** Items we couldn't resolve/enrich (search-only hints, or a failed lookup). */
	skipped: { title: string; reason: string }[];
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
	// date matching one is a stale placeholder the merge may replace.
	const added = record.addedDate;
	const updated = record.updatedDate;
	const release = base.release_date;
	const replaceableDays = [added, updated, release].filter(
		(day): day is string => Boolean(day),
	);

	// A real completion date from the export: union it (stripping stale fallbacks).
	if (contribution.completedDates.length > 0) {
		return { ...contribution, replaceableDays };
	}

	// Undated completion: backfill the chosen fallback, preferring the user's pick
	// but taking whichever date is available.
	const order =
		dateFallback === 'release'
			? [release, added, updated]
			: dateFallback === 'updated'
				? [updated, added, release]
				: [added, updated, release];
	const fallbackDate = order.find(Boolean);
	return { ...contribution, replaceableDays, fallbackDate };
}

/** A diagnostic reason for a failed enrichment: the error message and any status code. */
function describeError(error: unknown): string {
	const e = error as {
		statusCode?: number;
		status?: number;
		statusMessage?: string;
		message?: string;
	};
	const code = e?.statusCode ?? e?.status;
	const message = e?.statusMessage || e?.message || 'Lookup failed';
	return code ? `${message} (${code})` : message;
}

/** How many item ids to enrich in parallel. Keeps provider APIs from being hammered. */
const CONCURRENCY = 4;

/** Attempts per item before giving up — absorbs transient read/lookup blips. */
const ITEM_ATTEMPTS = 3;

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Turn a resolve hint into an `/api/draft` request (by-id enrichment). Returns
 * null when the id can't be enriched by id alone — Goodreads (ISBN lookup, round
 * 3) and Letterboxd search (round 4) are added later.
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
	 * Merge one id's records onto its base item. `existing` is the current
	 * Firestore doc (from the batched prefetch) or undefined for a brand-new id,
	 * which is enriched via `/api/draft`. Returns null when a new id can't be
	 * enriched by id alone (Goodreads/search — added in later rounds).
	 */
	async function buildItem(
		existing: Item | undefined,
		group: ImportRecord[],
		dateFallback: DateFallback,
	): Promise<{ item: Item; isNew: boolean } | null> {
		let base: Item;
		let isNew: boolean;

		if (existing) {
			base = existing;
			isNew = false;
		} else {
			const request = draftRequest(group[0]!.resolve);
			if (!request) return null; // not yet enrichable by id
			base = await $fetch<Item>('/api/draft', {
				params: { type: request.type, ...request.params },
			});
			isNew = true;
		}

		let item = base;
		for (const record of group) {
			item = applyContribution(
				item,
				effectiveContribution(record, base, dateFallback),
			);
		}
		return { item, isNew };
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
	): Promise<{ item: Item; isNew: boolean } | null> {
		for (let attempt = 1; ; attempt++) {
			try {
				return await buildItem(existing, group, dateFallback);
			} catch (error) {
				if (attempt >= ITEM_ATTEMPTS) throw error;
				await sleep(400 * attempt);
			}
		}
	}

	async function runImport(
		records: ImportRecord[],
		sections: ImportSection[],
		dateFallback: DateFallback,
		onProgress: (progress: ImportProgress) => void,
	): Promise<ImportSummary> {
		// Group the enabled records by their target item id; bucket records that
		// need a search (no direct id) as skipped for now.
		const groups = new Map<string, ImportRecord[]>();
		const skipped: ImportSummary['skipped'] = [];
		for (const record of records) {
			if (!sections.includes(record.section)) continue;
			const id = resolveDirectId(record.resolve);
			if (!id) {
				skipped.push({ title: record.title, reason: 'Needs manual matching' });
				continue;
			}
			const existing = groups.get(id);
			if (existing) existing.push(record);
			else groups.set(id, [record]);
		}

		const ids = [...groups.keys()];
		const toWrite: Item[] = [];
		let phase: ImportPhase = 'reading';
		let processed = 0;
		let created = 0;
		let updated = 0;
		let unchanged = 0;
		let cursor = 0;

		const report = () =>
			onProgress({
				phase,
				total: ids.length,
				processed,
				created,
				updated,
				unchanged,
			});
		report();

		// Prefetch every existing item in one batched pass so the worker loop does
		// no per-item Firestore reads (those stall under long-poll load). On a
		// re-import almost everything is already here, so no enrichment runs at all.
		const existingItems = await getItemsByIds(ids);

		phase = 'importing';
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
							reason: 'No by-id lookup for this source',
						});
					} else if (built.isNew) {
						toWrite.push(built.item);
						created++;
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
		return { created, updated, unchanged, skipped };
	}

	return { runImport };
}
