<template>
	<ItemBrowser
		v-model:type="type"
		v-model:sort-key="sortKey"
		v-model:reversed="reversed"
		:sort-keys="sortKeys"
		:filter-keys="FILTER_KEYS"
		:filters="filters"
		:pending="pending"
		:error="error"
		:displayed="displayed"
		view="backlog"
		empty-message="Nothing in the backlog."
		error-message="Failed to load backlog"
		@update:filter="setFilter"
	>
		<template #controls>
			<ItemSearch
				v-model="search"
				label="Filter"
				placeholder="Title, creator…"
			/>
		</template>
	</ItemBrowser>
</template>

<script setup lang="ts">
import { watchDebounced } from '@vueuse/core';
import type { MediaType } from '~~/shared/types/item';
import type {
	FilterKey,
	FilterState,
	ItemFilters,
} from '~~/shared/utils/itemFilter';
import type { SortKey } from '~~/shared/utils/itemSort';
import { enumParam, flagParam, stringParam } from '~~/shared/utils/viewQuery';

const MEDIA_TYPES: MediaType[] = ['book', 'movie', 'show', 'game'];
const SORT_KEYS: SortKey[] = [
	'rating',
	'title',
	'creator',
	'series',
	'length',
	'release_date',
];
const FILTER_KEYS: FilterKey[] = ['purchased', 'prioritized', 'released'];
const FILTER_STATES: FilterState[] = ['all', 'yes', 'no'];

const { getBacklog } = useItems();

// View state is bound to the URL so the view is bookmarkable. Content type pushes
// a browser-history entry (back button treats it like a separate page); sort,
// direction, and filters update the URL in place (core design §4).
const type = useQueryParam('type', enumParam(MEDIA_TYPES, 'book'), 'push');
const sortKey = useQueryParam('sort', enumParam(SORT_KEYS, 'rating'));
const reversed = useQueryParam('reverse', flagParam());
const purchased = useQueryParam('purchased', enumParam(FILTER_STATES, 'all'));
const prioritized = useQueryParam(
	'prioritized',
	enumParam(FILTER_STATES, 'all'),
);
const released = useQueryParam('released', enumParam(FILTER_STATES, 'all'));

// The backlog is already loaded client-side, so search is just another
// refinement of the current view (#40) — no navigation. Filtering runs off the
// local ref so typing feels instant; the URL catches up on a debounce, keeping
// the view bookmarkable without writing a `q` on every keystroke.
const searchParam = useQueryParam('q', stringParam());
const search = ref(searchParam.value);
watchDebounced(
	search,
	(q) => {
		searchParam.value = q;
	},
	{ debounce: 300 },
);
// Back/forward navigation moves the param, not the field; sync it back.
watch(searchParam, (q) => {
	if (q !== search.value) search.value = q;
});

const filterRefs = { purchased, prioritized, released };
const filters = computed<ItemFilters>(() => ({
	purchased: purchased.value,
	prioritized: prioritized.value,
	released: released.value,
}));

// For shows, the series sort (show name + numeric season) supersedes the title
// sort — it groups seasons and orders them numerically — so offer Series, not Title.
const sortKeys = computed<SortKey[]>(() =>
	type.value === 'show' ? SORT_KEYS.filter((k) => k !== 'title') : SORT_KEYS,
);

// Client-only: the Firestore plugin runs in the browser this milestone. Keyed by
// type and cached per key (#24) so re-selecting a type shows its list instantly
// instead of re-reading Firestore; writes invalidate the cache via useItems.
const backlogKey = computed(() => `backlog:${type.value}`);
const {
	data: items,
	pending,
	error,
} = useItemQuery(backlogKey, () => getBacklog(type.value), [type]);

const { displayed } = useItemList(items, {
	sortKey,
	reversed,
	filters,
	search,
	ratingField: 'community_rating',
});

// If the active sort is no longer offered (e.g. title → switched to shows),
// fall back to the default.
watch(sortKeys, (keys) => {
	if (!keys.includes(sortKey.value)) sortKey.value = 'rating';
});

function setFilter(key: FilterKey, state: FilterState) {
	filterRefs[key].value = state;
}
</script>
