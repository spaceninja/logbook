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
import { mediaTypeLabel } from '~~/shared/utils/itemDisplay';
import type { SortKey } from '~~/shared/utils/itemSort';
import { enumParam, flagParam, stringParam } from '~~/shared/utils/viewQuery';

const SORT_KEYS: SortKey[] = [
	'completion_date',
	'rating',
	'title',
	'creator',
	'series',
	'length',
	'release_date',
	'added_date',
];

const { getAllByType } = useItems();

// Same URL-bound view state as the other list views, so a search is bookmarkable
// and shareable. Type pushes a history entry (switching media type is a separate
// page); sort, direction, and the query update in place.
const type = useQueryParam(
	'type',
	enumParam(MEDIA_TYPES, DEFAULT_MEDIA_TYPE),
	'push',
);
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

// Follows the debounced param, not the field, so the title doesn't churn on
// every keystroke.
useHead({
	title: () => {
		const label = `Search ${mediaTypeLabel(type.value)}`;
		return searchParam.value.trim()
			? `${label}: ${searchParam.value.trim()}`
			: label;
	},
});

// Hand the type to the layout so the nav links stay on this type (#128).
usePageMediaType(type);

// For shows, the series sort (show name + numeric season) supersedes the title
// sort — it groups seasons and orders them numerically — so offer Series, not Title.
const sortKeys = computed<SortKey[]>(() =>
	type.value === 'show' ? SORT_KEYS.filter((k) => k !== 'title') : SORT_KEYS,
);

// Every item of the type, filtered client-side (Firestore can't do substring
// matching — see `getAllByType`). Keyed by type and cached per key (#24), so
// switching type and coming back is instant and refining the query never
// re-reads. History's all-years scopes (#33) read the same thing under the same
// key, so a session pays for one whole-type read, not two. Backlog items are
// included deliberately: searching "Dune" should tell you both when you read it
// and that the sequel is still queued.
const searchKey = computed(() => `all:${type.value}`);
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
