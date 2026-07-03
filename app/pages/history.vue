<template>
	<ItemBrowser
		v-model:type="type"
		v-model:sort-key="sortKey"
		v-model:reversed="reversed"
		:sort-keys="sortKeys"
		:pending="pending"
		:error="error"
		:displayed="displayed"
		view="history"
		:year="year"
		:empty-message="`Nothing completed in ${year}.`"
		error-message="Failed to load history"
	>
		<template #controls>
			<div class="filter year-switcher">
				<label for="year-switcher">Year</label>
				<select id="year-switcher" v-model.number="year">
					<option v-for="y in years" :key="y" :value="y">{{ y }}</option>
				</select>
			</div>
		</template>
	</ItemBrowser>
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
	'series',
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

// For shows, the series sort (show name + numeric season) supersedes the title
// sort — it groups seasons and orders them numerically — so offer Series, not Title.
const sortKeys = computed<SortKey[]>(() =>
	type.value === 'show' ? SORT_KEYS.filter((k) => k !== 'title') : SORT_KEYS,
);

// Keyed by year + type and cached per key (#24) so re-selecting a year/type
// shows its list instantly; writes invalidate the cache via useItems.
const historyKey = computed(() => `history:${year.value}:${type.value}`);
const {
	data: items,
	pending,
	error,
} = useItemQuery(historyKey, () => getHistory(year.value, type.value), [
	year,
	type,
]);

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
