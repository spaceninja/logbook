import {
	cert,
	getApps,
	initializeApp,
	type ServiceAccount,
} from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import type { Item, MediaType } from '../../shared/types/item';
import { deriveCompletedYears } from '../../shared/utils/completedYears';
import { deriveCreatorSort } from '../../shared/utils/creatorSort';

/**
 * Firestore access for the Goodreads sync via the Firebase Admin SDK. Unlike the
 * app's client SDK (which writes as the signed-in owner, gated by
 * `firestore.rules`), this authenticates with a service-account key and so runs
 * unattended — the headless credential a scheduled job needs. It mirrors
 * `useItems`' write normalization (`completed_years`, `creator_sort`, and the
 * `meta/completionYears` aggregate) so synced docs match app-written ones.
 */

/** Init the Admin SDK once, from the `FIREBASE_SERVICE_ACCOUNT` JSON. */
function db() {
	if (getApps().length === 0) {
		const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
		if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT is not set');
		const account = JSON.parse(raw) as ServiceAccount & { project_id?: string };
		initializeApp({
			credential: cert(account),
			projectId: account.project_id,
		});
	}
	return getFirestore();
}

/** The `items` collection handle. */
function items() {
	return db().collection('items');
}

/** Fetch existing docs for the given ids in one batched read (missing ids omitted). */
export async function readItems(ids: string[]): Promise<Map<string, Item>> {
	const found = new Map<string, Item>();
	if (ids.length === 0) return found;
	const refs = ids.map((id) => items().doc(id));
	const snapshots = await db().getAll(...refs);
	for (const snapshot of snapshots) {
		if (snapshot.exists) found.set(snapshot.id, snapshot.data() as Item);
	}
	return found;
}

/** The stored record for an item: `completed_years`/`creator_sort` normalized. */
function normalize(item: Item): Item {
	const creatorSort =
		item.creator_sort ?? deriveCreatorSort(item.creator, item.type);
	return {
		...item,
		completed_years: deriveCompletedYears(item.completed_dates),
		...(creatorSort ? { creator_sort: creatorSort } : {}),
	};
}

/** A key-stable JSON string, so object field order never fakes a difference. */
function canonical(value: unknown): string {
	return JSON.stringify(value, (_key, val) =>
		val && typeof val === 'object' && !Array.isArray(val)
			? Object.fromEntries(
					Object.entries(val as Record<string, unknown>).sort(([a], [b]) =>
						a.localeCompare(b),
					),
				)
			: val,
	);
}

/**
 * Whether the merged item is byte-identical to the stored doc once normalized —
 * so the sync only writes real changes. Compares the whole record (metadata
 * included), which is what lets a `community_rating`-only "ripening" update still
 * be written even though no tracking field changed.
 */
export function itemsEqual(existing: Item, merged: Item): boolean {
	return canonical(existing) === canonical(normalize(merged));
}

/**
 * Create/replace items and fold their completion years into the
 * `meta/completionYears` aggregate (one merge per media type), mirroring
 * `useItems.saveItems`. Batched at Firestore's 500-op limit.
 */
export async function writeItems(itemsToSave: Item[]): Promise<void> {
	if (itemsToSave.length === 0) return;
	const database = db();

	for (let start = 0; start < itemsToSave.length; start += 500) {
		const batch = database.batch();
		for (const item of itemsToSave.slice(start, start + 500)) {
			batch.set(items().doc(item.id), normalize(item));
		}
		await batch.commit();
	}

	const yearsByType = new Map<MediaType, Set<number>>();
	for (const item of itemsToSave) {
		const years = deriveCompletedYears(item.completed_dates);
		if (years.length === 0) continue;
		const bucket = yearsByType.get(item.type) ?? new Set<number>();
		for (const year of years) bucket.add(year);
		yearsByType.set(item.type, bucket);
	}
	const completionYears = database.collection('meta').doc('completionYears');
	for (const [type, years] of yearsByType) {
		await completionYears.set(
			{ [type]: FieldValue.arrayUnion(...years) },
			{ merge: true },
		);
	}
}
