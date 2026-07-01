<template>
	<section>
		<label>
			Year:
			<select v-model.number="year">
				<option v-for="y in years" :key="y" :value="y">{{ y }}</option>
			</select>
		</label>

		<fieldset>
			<legend>Type</legend>
			<label v-for="t in MEDIA_TYPES" :key="t">
				<input v-model="type" type="radio" :value="t" />
				{{ t }}
			</label>
		</fieldset>

		<!-- Client-only Firestore data; render client-side to avoid hydrating
         against the empty SSR default. -->
		<ClientOnly>
			<template #fallback>
				<p>Loading…</p>
			</template>
			<ItemControls
				v-model:sort-key="sortKey"
				v-model:reversed="reversed"
				:sort-keys="sortKeys"
				:filter-keys="[]"
				:filters="{}"
			/>
			<p v-if="pending">Loading…</p>
			<p v-else-if="error">Failed to load history: {{ error.message }}</p>
			<p v-else-if="displayed.length === 0">Nothing completed in {{ year }}.</p>
			<ItemCardList v-else :items="displayed" view="history" :year="year" />
		</ClientOnly>
	</section>
</template>

<script setup lang="ts">
import type { MediaType } from '~~/shared/types/item';
import type { CompletionYearsByType } from '~~/shared/utils/completionYears';
import type { SortKey } from '~~/shared/utils/itemSort';
import { enumParam, flagParam, yearParam } from '~~/shared/utils/viewQuery';

const MEDIA_TYPES: MediaType[] = ['book', 'movie', 'show', 'game'];
const SORT_KEYS: SortKey[] = [
	'completion_date',
	'rating',
	'title',
	'creator',
	'length',
	'release_date',
];

const { getHistory, getCompletionYears } = useItems();
const route = useRoute();
const router = useRouter();

// View state is bound to the URL so the view is bookmarkable. Content type and
// year each push a browser-history entry (back button steps through them like
// separate pages); sort and direction update the URL in place (core design §4).
const type = useQueryParam('type', enumParam(MEDIA_TYPES, 'book'), 'push');
const sortKey = useQueryParam('sort', enumParam(SORT_KEYS, 'completion_date'));
const reversed = useQueryParam('reverse', flagParam());
const urlYear = useQueryParam('year', yearParam(), 'push');

// Years offered by the switcher come from the maintained `meta/completionYears`
// aggregate (core design §15), scoped to the selected type so we never offer a
// year that has nothing for it. Newest first; falls back to the current calendar
// year before the aggregate loads or when the type has no completions.
const currentYear = new Date().getFullYear();
const { data: completionYears, status: yearsStatus } = useAsyncData(
	'completionYears',
	() => getCompletionYears(),
	{
		server: false,
		lazy: true,
		default: (): CompletionYearsByType => ({}),
		...readCacheOptions(),
	},
);
const years = computed<number[]>(() => {
	const ys = completionYears.value[type.value] ?? [];
	return ys.length ? [...ys].sort((a, b) => b - a) : [currentYear];
});

// An absent `year` param means "newest available", so the default view writes
// nothing to the URL. Selecting the newest year clears the param (clean URL);
// any other selection sets it (and pushes, per the binding).
const newestAvailable = computed<number>(() => years.value[0] ?? currentYear);
const year = computed<number>({
	get: () => urlYear.value ?? newestAvailable.value,
	set: (y) => {
		urlYear.value = y === newestAvailable.value ? null : y;
	},
});

// Self-correct a bookmarked year that has no entries for the current type: drop
// the param (replace, not push) so the view falls back to newest. Only after the
// aggregate has actually loaded, and client-side, to avoid clearing valid years
// prematurely or replacing during SSR.
watch(
	[yearsStatus, type, urlYear],
	() => {
		if (!import.meta.client || yearsStatus.value !== 'success') return;
		const available = completionYears.value[type.value] ?? [];
		if (urlYear.value != null && !available.includes(urlYear.value)) {
			const query = { ...route.query };
			delete query.year;
			router.replace({ query });
		}
	},
	{ immediate: true },
);

// For shows, the series sort (show name + numeric season) replaces the title sort.
const sortKeys = computed<SortKey[]>(() =>
	type.value === 'show'
		? SORT_KEYS.map((k) => (k === 'title' ? 'series' : k))
		: SORT_KEYS,
);

// Keyed by year + type and cached per key (#24) so re-selecting a year/type
// shows its list instantly; writes invalidate the cache via useItems.
const historyKey = computed(() => `history:${year.value}:${type.value}`);
const {
	data: items,
	pending,
	error,
} = useAsyncData(historyKey, () => getHistory(year.value, type.value), {
	server: false,
	lazy: true,
	default: () => [],
	watch: [year, type],
	...readCacheOptions(),
});

const { displayed } = useItemList(items, {
	sortKey,
	reversed,
	filters: () => ({}),
	ratingField: 'my_rating',
	year,
});

// If the active sort is no longer offered (e.g. title → switched to shows), fall
// back to the default.
watch(sortKeys, (keys) => {
	if (!keys.includes(sortKey.value)) sortKey.value = 'completion_date';
});
</script>
