import { applyContribution, toContribution } from '~~/shared/import/merge';
import { resolveDirectId } from '~~/shared/import/resolve';
import type {
	ImportRecord,
	ImportSection,
	ResolveHint,
} from '~~/shared/import/types';
import type { Item, MediaType } from '~~/shared/types/item';

/** Live progress for the importer's progress bar. `total` counts unique items. */
export interface ImportProgress {
	total: number;
	processed: number;
	created: number;
	updated: number;
}

export interface ImportSummary {
	created: number;
	updated: number;
	/** Items we couldn't resolve/enrich (search-only hints, or a failed lookup). */
	skipped: { title: string; reason: string }[];
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
			item = applyContribution(item, toContribution(record));
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
	): Promise<{ item: Item; isNew: boolean } | null> {
		for (let attempt = 1; ; attempt++) {
			try {
				return await buildItem(existing, group);
			} catch (error) {
				if (attempt >= ITEM_ATTEMPTS) throw error;
				await sleep(400 * attempt);
			}
		}
	}

	async function runImport(
		records: ImportRecord[],
		sections: ImportSection[],
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
		let processed = 0;
		let created = 0;
		let updated = 0;
		let cursor = 0;

		const report = () =>
			onProgress({ total: ids.length, processed, created, updated });
		report();

		// Prefetch every existing item in one batched pass so the worker loop does
		// no per-item Firestore reads (those stall under long-poll load). On a
		// re-import almost everything is already here, so no enrichment runs at all.
		const existingItems = await getItemsByIds(ids);

		async function worker(): Promise<void> {
			while (cursor < ids.length) {
				const id = ids[cursor++]!;
				const group = groups.get(id)!;
				try {
					const built = await buildItemResilient(existingItems.get(id), group);
					if (built) {
						toWrite.push(built.item);
						if (built.isNew) created++;
						else updated++;
					} else {
						skipped.push({
							title: group[0]!.title,
							reason: 'No by-id lookup for this source',
						});
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

		await saveItems(toWrite);
		return { created, updated, skipped };
	}

	return { runImport };
}
