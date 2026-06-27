import {
  collection,
  doc,
  getDocs,
  setDoc,
  writeBatch,
  type Firestore,
} from 'firebase/firestore';
import type { Item } from '~~/shared/types/item';
import { deriveCompletedYears } from '~~/shared/utils/completedYears';
import { deriveCompletionYearsByType } from '~~/shared/utils/completionYears';
import { deriveCreatorSort } from '~~/shared/utils/creatorSort';

// Firestore caps a write batch at 500 operations.
const BATCH_LIMIT = 500;

/**
 * Dev-only seeding: wipe the entire `items` collection and replace it with a
 * dataset. Kept out of the read path; only the `/dev` page (gated on
 * `import.meta.dev`) calls these, and only the dev project allows writes.
 *
 * Firestore is resolved lazily inside each method (not at setup): the Firebase
 * plugin is client-only, so `$firestore` is undefined during SSR.
 */
export function useSeed() {
  const nuxtApp = useNuxtApp();
  const getDb = () => nuxtApp.$firestore as Firestore;

  /** Delete every document in the `items` collection, in batches of 500. */
  async function wipeAll(): Promise<void> {
    const db = getDb();
    const snapshot = await getDocs(collection(db, 'items'));
    const docs = snapshot.docs;

    for (let i = 0; i < docs.length; i += BATCH_LIMIT) {
      const batch = writeBatch(db);
      for (const d of docs.slice(i, i + BATCH_LIMIT)) {
        batch.delete(d.ref);
      }
      await batch.commit();
    }
  }

  /**
   * Wipe the collection, then write `dataset` using each item's `id` as the
   * document id. `completed_years` is recomputed from `completed_dates` at write
   * time so the stored value can never drift from the source dates.
   */
  async function loadDataset(dataset: Item[]): Promise<void> {
    await wipeAll();

    const db = getDb();
    const items = collection(db, 'items');
    for (let i = 0; i < dataset.length; i += BATCH_LIMIT) {
      const batch = writeBatch(db);
      for (const item of dataset.slice(i, i + BATCH_LIMIT)) {
        const creatorSort =
          item.creator_sort ?? deriveCreatorSort(item.creator, item.type);
        const record: Item = {
          ...item,
          completed_years: deriveCompletedYears(item.completed_dates),
          ...(creatorSort ? { creator_sort: creatorSort } : {}),
        };
        batch.set(doc(items, item.id), record);
      }
      await batch.commit();
    }

    // Rebuild the History year switcher's aggregate from the full dataset. A
    // plain overwrite (not arrayUnion) drops years the new dataset no longer has.
    await writeCompletionYears(db, dataset);
  }

  /**
   * Overwrite the `meta/completionYears` aggregate from a set of items. A plain
   * set (not `arrayUnion`) so types/years no longer present are dropped.
   */
  async function writeCompletionYears(db: Firestore, source: Item[]) {
    await setDoc(
      doc(db, 'meta', 'completionYears'),
      deriveCompletionYearsByType(source),
    );
  }

  /**
   * Rebuild the History year switcher's aggregate from the items already in
   * Firestore — non-destructive (no wipe). The backfill/repair path for data
   * that predates the aggregate, or whenever it drifts. Returns the count of
   * distinct years across all types.
   */
  async function rebuildCompletionYears(): Promise<number> {
    const db = getDb();
    const snapshot = await getDocs(collection(db, 'items'));
    const items = snapshot.docs.map((d) => d.data() as Item);
    await writeCompletionYears(db, items);
    const byType = deriveCompletionYearsByType(items);
    const distinct = new Set(Object.values(byType).flat());
    return distinct.size;
  }

  return { wipeAll, loadDataset, rebuildCompletionYears };
}
