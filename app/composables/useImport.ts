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
	/** Records we couldn't resolve/enrich (search-only hints, or a failed lookup). */
	skipped: number;
}

/** How many item ids to enrich in parallel. Keeps provider APIs from being hammered. */
const CONCURRENCY = 4;

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
	const { getItem, saveItems } = useItems();

	/** Resolve, enrich, and merge one id's records into a single item to write. */
	async function buildItem(
		id: string,
		group: ImportRecord[],
	): Promise<{ item: Item; isNew: boolean } | null> {
		const existing = await getItem(id);
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

	async function runImport(
		records: ImportRecord[],
		sections: ImportSection[],
		onProgress: (progress: ImportProgress) => void,
	): Promise<ImportSummary> {
		// Group the enabled records by their target item id; bucket records that
		// need a search (no direct id) as skipped for now.
		const groups = new Map<string, ImportRecord[]>();
		let skipped = 0;
		for (const record of records) {
			if (!sections.includes(record.section)) continue;
			const id = resolveDirectId(record.resolve);
			if (!id) {
				skipped++;
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

		async function worker(): Promise<void> {
			while (cursor < ids.length) {
				const id = ids[cursor++]!;
				const group = groups.get(id)!;
				try {
					const built = await buildItem(id, group);
					if (built) {
						toWrite.push(built.item);
						if (built.isNew) created++;
						else updated++;
					} else {
						skipped += group.length;
					}
				} catch {
					// A single failed lookup shouldn't abort the whole import.
					skipped += group.length;
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
