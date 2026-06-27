import type { Item } from '../types/item';
import { deriveCompletedYears } from './completedYears';

/**
 * Derives the full set of years in which *any* item was completed: the
 * de-duplicated, ascending union of every item's `completed_dates`. Powers the
 * History view's year switcher, which can't scan the collection at read time
 * (Firestore has no DISTINCT), so this is stored in a maintained aggregate doc
 * (`meta/completionYears`) and rebuilt by the seed loader (core design §15).
 */
export function deriveCompletionYears(items: Item[]): number[] {
  const years = new Set<number>();

  for (const item of items) {
    for (const year of deriveCompletedYears(item.completed_dates)) {
      years.add(year);
    }
  }

  return [...years].sort((a, b) => a - b);
}
