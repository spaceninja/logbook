<template>
	<ItemBrowser
		v-model:type="type"
		v-model:sort-key="sortKey"
		v-model:reversed="reversed"
		:sort-keys="sortKeys"
		:pending="pending"
		:error="error"
		:displayed="displayed"
		view="search"
		:empty-message="emptyMessage"
		error-message="Failed to load items"
	>
		<template #controls>
			<ItemSearch v-model="search" placeholder="Title, creator, series…" />
		</template>
	</ItemBrowser>
</template>

<script setup lang="ts">
import { watchDebounced } from '@vueuse/core';
import type { MediaType } from '~~/shared/types/item';
import type { SortKey } from '~~/shared/utils/itemSort';
import { enumParam, flagParam, stringParam } from '~~/shared/utils/viewQuery';

const MEDIA_TYPES: MediaType[] = ['book', 'movie', 'show', 'game'];
const SORT_KEYS: SortKey[] = [
	'completion_date',
	'rating',
	'title',
	'creator',
	'series',
	'length',
	'release_date',
];

const { getAllByType } = useItems();

// Same URL-bound view state as the other list views, so a search is bookmarkable
// and shareable. Type pushes a history entry (switching media type is a separate
// page); sort, direction, and the query update in place.
const type = useQueryParam('type', enumParam(MEDIA_TYPES, 'book'), 'push');
const sortKey = useQueryParam('sort', enumParam(SORT_KEYS, 'completion_date'));
const reversed = useQueryParam('reverse', flagParam());

// Refining the query here filters the already-loaded list, same as the Backlog —
// the hand-off from History has already happened, so there's nowhere to navigate.
const searchParam = useQueryParam('q', stringParam());
const search = ref(searchParam.value);
watchDebounced(
	search,
	(q) => {
		searchParam.value = q;
	},
	{ debounce: 300 },
);
watch(searchParam, (q) => {
	if (q !== search.value) search.value = q;
});

// For shows, the series sort (show name + numeric season) supersedes the title
// sort — it groups seasons and orders them numerically — so offer Series, not Title.
const sortKeys = computed<SortKey[]>(() =>
	type.value === 'show' ? SORT_KEYS.filter((k) => k !== 'title') : SORT_KEYS,
);

// Every item of the type, filtered client-side (Firestore can't do substring
// matching — see `getAllByType`). Keyed by type and cached per key (#24), so
// switching type and coming back is instant and refining the query never
// re-reads. Backlog items are included deliberately: searching "Dune" should
// tell you both when you read it and that the sequel is still queued.
const searchKey = computed(() => `search:${type.value}`);
const {
	data: items,
	pending,
	error,
} = useItemQuery(searchKey, () => getAllByType(type.value), [type]);

// No `year`, so the completion_date sort uses each item's latest completion
// overall — the right ordering for a list that spans every year.
const { displayed: matches } = useItemList(items, {
	sortKey,
	reversed,
	filters: () => ({}),
	search,
	ratingField: 'my_rating',
});

// A blank query matches everything, which here would dump the whole library
// rather than prompt for input. Show nothing instead. The read above still runs,
// which is deliberate: it warms the cache while the user is typing.
const displayed = computed(() => (search.value.trim() ? matches.value : []));

const emptyMessage = computed(() =>
	search.value.trim()
		? `No ${type.value} matches “${search.value.trim()}”.`
		: 'Type to search.',
);

// If the active sort is no longer offered (e.g. title → switched to shows), fall
// back to the default.
watch(sortKeys, (keys) => {
	if (!keys.includes(sortKey.value)) sortKey.value = 'completion_date';
});
</script>
