import type { Ref } from 'vue';
import type { Item } from '~~/shared/types/item';
import {
  applyItemFilters,
  type FilterKey,
  type FilterState,
  type ItemFilters,
} from '~~/shared/utils/itemFilter';
import {
  makeItemComparator,
  type RatingField,
  type SortKey,
} from '~~/shared/utils/itemSort';

export interface ItemListConfig {
  /** Sorts offered in the controls, in display order. */
  sortKeys: SortKey[];
  defaultSort: SortKey;
  /** Which rating the `rating` sort uses on this view. */
  ratingField: RatingField;
  /** Filters offered in the controls; empty hides the filter row. */
  filterKeys: FilterKey[];
  /** Scopes `completion_date` to the selected History year. */
  year?: Ref<number>;
}

/**
 * Holds a view's client-side sort/filter state over a coarse Firestore result
 * set and exposes the refined list (core design §4). Both views share this; each
 * passes a config for the sorts, filters, and rating field it exposes.
 */
export function useItemList(items: Ref<Item[]>, config: ItemListConfig) {
  const sortKey = ref<SortKey>(config.defaultSort);
  const reversed = ref(false);
  const filters = reactive<ItemFilters>(
    Object.fromEntries(
      config.filterKeys.map((k) => [k, 'all' as FilterState]),
    ) as ItemFilters,
  );

  const displayed = computed(() => {
    const filtered = applyItemFilters(items.value, filters);
    const comparator = makeItemComparator(sortKey.value, reversed.value, {
      ratingField: config.ratingField,
      year: config.year?.value,
    });
    return [...filtered].sort(comparator);
  });

  return { sortKey, reversed, filters, displayed };
}
