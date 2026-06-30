import {
	arrayUnion,
	collection,
	deleteDoc,
	doc,
	getDoc,
	getDocs,
	query,
	setDoc,
	where,
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
		saveItem,
		deleteItem,
	};
}
