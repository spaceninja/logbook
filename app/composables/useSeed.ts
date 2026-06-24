import {
  collection,
  doc,
  getDocs,
  writeBatch,
  type Firestore,
} from 'firebase/firestore';
import type { Item } from '~~/shared/types/item';
import { deriveCompletedYears } from '~~/shared/utils/completedYears';

// Firestore caps a write batch at 500 operations.
const BATCH_LIMIT = 500;

/**
 * Dev-only seeding: wipe the entire `items` collection and replace it with a
 * dataset. Kept out of the read path; only the `/dev` page (gated on
 * `import.meta.dev`) calls these, and only the dev project allows writes.
 */
export function useSeed() {
  const { $firestore } = useNuxtApp();
  const db = $firestore as Firestore;
  const items = collection(db, 'items');

  /** Delete every document in the `items` collection, in batches of 500. */
  async function wipeAll(): Promise<void> {
    const snapshot = await getDocs(items);
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

    for (let i = 0; i < dataset.length; i += BATCH_LIMIT) {
      const batch = writeBatch(db);
      for (const item of dataset.slice(i, i + BATCH_LIMIT)) {
        const record: Item = {
          ...item,
          completed_years: deriveCompletedYears(item.completed_dates),
        };
        batch.set(doc(items, item.id), record);
      }
      await batch.commit();
    }
  }

  return { wipeAll, loadDataset };
}
