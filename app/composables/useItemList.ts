import { toValue, type MaybeRefOrGetter, type Ref } from 'vue';
import type { Item } from '~~/shared/types/item';
import { applyItemFilters, type ItemFilters } from '~~/shared/utils/itemFilter';
import { applyItemSearch } from '~~/shared/utils/itemSearch';
import {
	makeItemComparator,
	type RatingField,
	type SortKey,
} from '~~/shared/utils/itemSort';

export interface ItemListConfig {
	/** The active sort key (owned by the page; e.g. URL-bound via useViewQuery). */
	sortKey: Ref<SortKey>;
	/** Whether the sort is reversed. */
	reversed: Ref<boolean>;
	/** Active filter states; an empty object means no filtering. */
	filters: MaybeRefOrGetter<ItemFilters>;
	/** Free-text query matched against title/creator/series; blank means no search. */
	search?: MaybeRefOrGetter<string>;
	/** Which rating the `rating` sort uses on this view. */
	ratingField: RatingField;
	/** Scopes `completion_date` to the selected History year. */
	year?: Ref<number>;
}

/**
 * Given a coarse Firestore result set and the view's sort/filter state, exposes
 * the refined list (core design §4). The state refs are injected by the page so
 * the URL-bound refs are the single source of truth; this composable only
 * derives `displayed`.
 */
export function useItemList(items: Ref<Item[]>, config: ItemListConfig) {
	const displayed = computed(() => {
		const filtered = applyItemSearch(
			applyItemFilters(items.value, toValue(config.filters)),
			toValue(config.search) ?? '',
		);
		const comparator = makeItemComparator(
			config.sortKey.value,
			config.reversed.value,
			{ ratingField: config.ratingField, year: config.year?.value },
		);
		return [...filtered].sort(comparator);
	});

	return { displayed };
}
