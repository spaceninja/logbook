<template>
	<section>
		<fieldset>
			<legend>Type</legend>
			<label v-for="t in MEDIA_TYPES" :key="t">
				<input v-model="type" type="radio" :value="t" />
				{{ t }}
			</label>
		</fieldset>

		<!-- Data comes from the client-only Firestore SDK, so render it client-side
         to avoid hydrating against the empty SSR default. -->
		<ClientOnly>
			<template #fallback>
				<p>Loading…</p>
			</template>
			<ItemControls
				v-model:sort-key="sortKey"
				v-model:reversed="reversed"
				:sort-keys="sortKeys"
				:filter-keys="FILTER_KEYS"
				:filters="filters"
				@update:filter="setFilter"
			/>
			<p v-if="pending">Loading…</p>
			<p v-else-if="error">Failed to load backlog: {{ error.message }}</p>
			<p v-else-if="displayed.length === 0">Nothing in the backlog.</p>
			<ItemCardList v-else :items="displayed" view="backlog" />
		</ClientOnly>
	</section>
</template>

<script setup lang="ts">
import type { MediaType } from '~~/shared/types/item';
import type {
	FilterKey,
	FilterState,
	ItemFilters,
} from '~~/shared/utils/itemFilter';
import type { SortKey } from '~~/shared/utils/itemSort';
import { enumParam, flagParam } from '~~/shared/utils/viewQuery';

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
} = useAsyncData(backlogKey, () => getBacklog(type.value), {
	server: false,
	lazy: true,
	default: () => [],
	watch: [type],
	...readCacheOptions(),
});

const { displayed } = useItemList(items, {
	sortKey,
	reversed,
	filters,
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
