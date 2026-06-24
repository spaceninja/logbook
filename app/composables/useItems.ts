import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  type Firestore,
} from 'firebase/firestore';
import type { Item } from '~~/shared/types/item';

/**
 * Read access to the `items` collection. Each method runs a coarse Firestore
 * query (core design §4); fine filtering and sorting happen client-side in the
 * pages. Reads are client-side this milestone.
 */
export function useItems() {
  const { $firestore } = useNuxtApp();
  const db = $firestore as Firestore;
  const items = collection(db, 'items');

  /** Backlog membership: status is `backlog` or `in_progress`. */
  async function getBacklog(): Promise<Item[]> {
    const snapshot = await getDocs(
      query(items, where('status', 'in', ['backlog', 'in_progress'])),
    );
    return snapshot.docs.map((d) => d.data() as Item);
  }

  /** History membership for a given year, via the derived `completed_years`. */
  async function getHistory(year: number): Promise<Item[]> {
    const snapshot = await getDocs(
      query(items, where('completed_years', 'array-contains', year)),
    );
    return snapshot.docs.map((d) => d.data() as Item);
  }

  /** A single item by id, or null when the document does not exist. */
  async function getItem(id: string): Promise<Item | null> {
    const snapshot = await getDoc(doc(items, id));
    return snapshot.exists() ? (snapshot.data() as Item) : null;
  }

  return { getBacklog, getHistory, getItem };
}
