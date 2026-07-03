import {
	arrayUnion,
	collection,
	deleteDoc,
	doc,
	documentId,
	getDoc,
	getDocs,
	query,
	setDoc,
	where,
	writeBatch,
	type Firestore,
} from 'firebase/firestore';
import type { Item, MediaType } from '~~/shared/types/item';
import { deriveCompletedYears } from '~~/shared/utils/completedYears';
import type { CompletionYearsByType } from '~~/shared/utils/completionYears';
import { deriveCreatorSort } from '~~/shared/utils/creatorSort';

/** ms to wait on a Firestore read before treating a stall as a failure (#23). */
const READ_TIMEOUT_MS = 10_000;

/**
 * Reject if `promise` hasn't settled within `READ_TIMEOUT_MS`. The modular
 * Firestore SDK can't be aborted, so on a stalled long-poll the underlying read
 * never settles; racing a timer turns that silent hang into the pages' existing
 * `error` branch instead of an endless "Loading…" (#23). The orphaned read
 * resolving late is harmless — Nuxt has already taken the rejection.
 */
function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
	let timer: ReturnType<typeof setTimeout>;
	const timeout = new Promise<never>((_, reject) => {
		timer = setTimeout(() => {
			const message = `${label} timed out — a content blocker or network issue may be interfering with the connection.`;
			console.error(`[logbook] ${message}`);
			reject(new Error(message));
		}, READ_TIMEOUT_MS);
	});
	return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Read access to the `items` collection. Each method runs a coarse Firestore
 * query (core design §4); fine filtering and sorting happen client-side in the
 * pages. Reads are client-side this milestone.
 *
 * Firestore is resolved lazily inside each method (not at setup): the Firebase
 * plugin is client-only, so `$firestore` is undefined during SSR. The methods
 * only run on the client (the pages fetch with `server: false`).
 */
export function useItems() {
	const nuxtApp = useNuxtApp();
	const db = () => nuxtApp.$firestore as Firestore;
	const items = () => collection(db(), 'items');
	/** Aggregate doc backing the History year switcher (core design §15). */
	const completionYearsDoc = () => doc(db(), 'meta', 'completionYears');

	/** Backlog membership for one media type: status is `backlog` or `in_progress`. */
	async function getBacklog(type: MediaType): Promise<Item[]> {
		const snapshot = await withTimeout(
			getDocs(
				query(
					items(),
					where('type', '==', type),
					where('status', 'in', ['backlog', 'in_progress']),
				),
			),
			'Loading the backlog',
		);
		return snapshot.docs.map((d) => d.data() as Item);
	}

	/** History for one media type in a given year, via the derived `completed_years`. */
	async function getHistory(year: number, type: MediaType): Promise<Item[]> {
		const snapshot = await withTimeout(
			getDocs(
				query(
					items(),
					where('completed_years', 'array-contains', year),
					where('type', '==', type),
				),
			),
			'Loading history',
		);
		return snapshot.docs.map((d) => d.data() as Item);
	}

	/**
	 * Years that have at least one completion, grouped by media type, for the
	 * History year switcher. Read from the maintained `meta/completionYears`
	 * aggregate (a collection-wide DISTINCT is impossible in Firestore). Empty
	 * when the aggregate has not been written yet.
	 */
	async function getCompletionYears(): Promise<CompletionYearsByType> {
		const snapshot = await withTimeout(
			getDoc(completionYearsDoc()),
			'Loading media types',
		);
		if (!snapshot.exists()) return {};
		return snapshot.data() as CompletionYearsByType;
	}

	/** A single item by id, or null when the document does not exist. */
	async function getItem(id: string): Promise<Item | null> {
		const snapshot = await withTimeout(
			getDoc(doc(items(), id)),
			'Loading this item',
		);
		return snapshot.exists() ? (snapshot.data() as Item) : null;
	}

	/**
	 * Fetch many items by id in one batched pass, for the importer's existence
	 * check. Firestore caps a `documentId() in [...]` query at 30 values, so ids
	 * are chunked; missing ids simply don't appear in the result. This replaces
	 * hundreds of individual `getDoc`s — far fewer reads, and far less exposure to
	 * the long-poll stalls that a per-item read hits under bulk load (#20). Each
	 * chunk is retried a few times so a transient stall doesn't fail the import.
	 */
	async function getItemsByIds(ids: string[]): Promise<Map<string, Item>> {
		const found = new Map<string, Item>();
		for (let start = 0; start < ids.length; start += 30) {
			const chunk = ids.slice(start, start + 30);
			for (let attempt = 1; ; attempt++) {
				try {
					const snapshot = await withTimeout(
						getDocs(query(items(), where(documentId(), 'in', chunk))),
						'Loading existing items',
					);
					for (const found_doc of snapshot.docs) {
						found.set(found_doc.id, found_doc.data() as Item);
					}
					break;
				} catch (error) {
					if (attempt >= 3) throw error;
					await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
				}
			}
		}
		return found;
	}

	/**
	 * Create or replace an item (used by both add and edit). `completed_years` is
	 * recomputed from `completed_dates` so the stored value can't drift. Owner-only
	 * by Firestore rules; callers gate the UI on `isOwner`.
	 */
	async function saveItem(item: Item): Promise<void> {
		const creatorSort =
			item.creator_sort ?? deriveCreatorSort(item.creator, item.type);
		const record: Item = {
			...item,
			completed_years: deriveCompletedYears(item.completed_dates),
			...(creatorSort ? { creator_sort: creatorSort } : {}),
		};
		await setDoc(doc(items(), item.id), record);

		// Fold this item's years into its type's bucket so the History switcher
		// offers them for that type. arrayUnion only adds, so a year that loses its
		// last item stays until the next reseed rebuilds the doc — an accepted
		// trade-off (core design §15).
		if (record.completed_years.length > 0) {
			await setDoc(
				completionYearsDoc(),
				{ [record.type]: arrayUnion(...record.completed_years) },
				{ merge: true },
			);
		}

		// Drop cached list reads so the next Backlog/History view reflects this write.
		clearReadCache();
	}

	/**
	 * Bulk create/replace items for the importer. Writes in chunked `writeBatch`es
	 * (Firestore caps a batch at 500 ops) and mirrors `saveItem`'s per-doc
	 * normalization (`completed_years`, `creator_sort`). The `completionYears`
	 * aggregate is folded once per media type and the read cache cleared once —
	 * not per item — so a large import stays cheap. Owner-only by Firestore rules.
	 */
	async function saveItems(itemsToSave: Item[]): Promise<void> {
		if (itemsToSave.length === 0) return;
		const database = db();

		for (let start = 0; start < itemsToSave.length; start += 500) {
			const batch = writeBatch(database);
			for (const item of itemsToSave.slice(start, start + 500)) {
				const creatorSort =
					item.creator_sort ?? deriveCreatorSort(item.creator, item.type);
				const record: Item = {
					...item,
					completed_years: deriveCompletedYears(item.completed_dates),
					...(creatorSort ? { creator_sort: creatorSort } : {}),
				};
				batch.set(doc(items(), item.id), record);
			}
			await batch.commit();
		}

		// Fold every completion year into its type's bucket, one merge per type.
		const yearsByType = new Map<MediaType, Set<number>>();
		for (const item of itemsToSave) {
			const years = deriveCompletedYears(item.completed_dates);
			if (years.length === 0) continue;
			const bucket = yearsByType.get(item.type) ?? new Set<number>();
			for (const year of years) bucket.add(year);
			yearsByType.set(item.type, bucket);
		}
		for (const [type, years] of yearsByType) {
			await setDoc(
				completionYearsDoc(),
				{ [type]: arrayUnion(...years) },
				{ merge: true },
			);
		}

		clearReadCache();
	}

	/** Delete an item by id. Owner-only by Firestore rules. */
	async function deleteItem(id: string): Promise<void> {
		await deleteDoc(doc(items(), id));
		clearReadCache();
	}

	return {
		getBacklog,
		getHistory,
		getCompletionYears,
		getItem,
		getItemsByIds,
		saveItem,
		saveItems,
		deleteItem,
	};
}
