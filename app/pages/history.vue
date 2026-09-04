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
		:year="scopeYear"
		:empty-message="emptyMessage"
		error-message="Failed to load history"
	>
		<template #controls>
			<ItemSearch
				v-model="search"
				placeholder="All years…"
				@submit="goToSearch"
			/>
			<div class="filter scope-switcher">
				<label for="history-scope">Show</label>
				<select id="history-scope" v-model="selection">
					<optgroup label="Year">
						<option v-for="y in years" :key="y" :value="String(y)">
							{{ y }}
						</option>
					</optgroup>
					<optgroup label="All years">
						<!-- Completed items with no date, otherwise unreachable (#20). -->
						<option value="undated">Undated</option>
						<option value="unrated">Unrated</option>
						<option value="top100">Top 100</option>
					</optgroup>
				</select>
			</div>
		</template>
	</ItemBrowser>
</template>

<script setup lang="ts">
import type { CompletionYearsByType } from '~~/shared/utils/completionYears';
import { mediaTypeLabel } from '~~/shared/utils/itemDisplay';
import {
	HISTORY_SCOPES,
	topRatedItems,
	unratedItems,
	type HistoryScope,
} from '~~/shared/utils/historyScope';
import type { SortKey } from '~~/shared/utils/itemSort';
import { enumParam, flagParam, yearParam } from '~~/shared/utils/viewQuery';

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

const { getHistory, getUndated, getAllByType, getCompletionYears } = useItems();
const route = useRoute();
const router = useRouter();

// View state is bound to the URL so the view is bookmarkable. Content type,
// scope, and year each push a browser-history entry (back button steps through
// them like separate pages); sort and direction update the URL in place (core
// design §4).
const type = useQueryParam(
	'type',
	enumParam(MEDIA_TYPES, DEFAULT_MEDIA_TYPE),
	'push',
);
const sortKey = useQueryParam('sort', enumParam(SORT_KEYS, 'completion_date'));
const reversed = useQueryParam('reverse', flagParam());
const urlYear = useQueryParam('year', yearParam(), 'push');
// What the list is showing: one year (the default, using `year`), or one of the
// all-years scopes (#33), which ignore `year` entirely.
const scope = useQueryParam('scope', enumParam(HISTORY_SCOPES, 'year'), 'push');

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

// One control drives both params: an all-years scope clears the year, and
// picking a year returns to the `year` scope. `useRouteQuery` batches param
// writes on nextTick, so the pair lands as a single navigation.
const selection = computed<string>({
	get: () => (scope.value === 'year' ? String(year.value) : scope.value),
	set: (value) => {
		if (value !== 'year' && HISTORY_SCOPES.includes(value as HistoryScope)) {
			scope.value = value as HistoryScope;
			urlYear.value = null;
		} else {
			scope.value = 'year';
			year.value = Number(value);
		}
	},
});

// Self-correct a bookmarked year that has no entries for the current type: drop
// the param (replace, not push) so the view falls back to newest. Only after the
// aggregate has actually loaded, and client-side, to avoid clearing valid years
// prematurely or replacing during SSR.
watch(
	[yearsStatus, type, urlYear, scope],
	() => {
		if (!import.meta.client || yearsStatus.value !== 'success') return;
		if (scope.value !== 'year') return;
		const available = completionYears.value[type.value] ?? [];
		if (urlYear.value != null && !available.includes(urlYear.value)) {
			const query = { ...route.query };
			delete query.year;
			router.replace({ query });
		}
	},
	{ immediate: true },
);

// History only ever holds one year at a time, so filtering it in place would
// search a single year and silently miss the rest — the exact problem #40 is
// about. Instead the field hands off to the search view, which spans every year
// for this media type. Submit (Enter), not live, so we don't push a route per
// keystroke.
const search = ref('');
function goToSearch() {
	if (!search.value.trim()) return;
	navigateTo({
		path: '/search',
		// The default type is omitted, like every other link to a type-scoped view —
		// writing it produced a `?type=book` URL the app never generates elsewhere.
		query: { ...mediaTypeQuery(type.value), q: search.value.trim() },
	});
}

// For shows, the series sort (show name + numeric season) supersedes the title
// sort — it groups seasons and orders them numerically — so offer Series, not Title.
const sortKeys = computed<SortKey[]>(() =>
	type.value === 'show' ? SORT_KEYS.filter((k) => k !== 'title') : SORT_KEYS,
);

// Keyed by scope (plus year and type) and cached per key (#24) so re-selecting a
// year/type/scope shows its list instantly; writes invalidate the cache via
// useItems. The all-years scopes need every item of the type, so they share the
// search view's `all:` read rather than paying for a second one.
const historyKey = computed(() =>
	scope.value === 'year'
		? `history:${year.value}:${type.value}`
		: scope.value === 'undated'
			? `undated:${type.value}`
			: `all:${type.value}`,
);
const {
	data: items,
	pending,
	error,
} = useItemQuery(
	historyKey,
	() =>
		scope.value === 'year'
			? getHistory(year.value, type.value)
			: scope.value === 'undated'
				? getUndated(type.value)
				: getAllByType(type.value),
	[year, type, scope],
);

// The all-years scopes refine that whole-type read down to what they're for
// (#33). `getHistory`/`getUndated` already return exactly their scope's items.
const scopedItems = computed(() => {
	switch (scope.value) {
		case 'unrated':
			return unratedItems(items.value);
		case 'top100':
			return topRatedItems(items.value);
		default:
			return items.value;
	}
});

// Only a year-scoped list has a year to scope by: the all-years scopes sort on
// each item's latest completion overall, and their cards show every date.
const scopeYear = computed<number | undefined>(() =>
	scope.value === 'year' ? year.value : undefined,
);

// Type and scope are both bookmarkable, so both belong in the tab title —
// "Books History: 2025", "Movies History: Top 100".
const scopeLabel = computed(() => {
	switch (scope.value) {
		case 'undated':
			return 'Undated';
		case 'unrated':
			return 'Unrated';
		case 'top100':
			return 'Top 100';
		default:
			return String(year.value);
	}
});
useHead({
	title: () => `${mediaTypeLabel(type.value)} History: ${scopeLabel.value}`,
});

// Hand the type to the layout so the nav's Backlog link stays on this type (#128).
usePageMediaType(type);

const emptyMessage = computed(() => {
	switch (scope.value) {
		case 'undated':
			return `No undated ${type.value} completions.`;
		case 'unrated':
			return `No unrated ${type.value} completions.`;
		case 'top100':
			return `No rated ${type.value} completions yet.`;
		default:
			return `Nothing completed in ${year.value}.`;
	}
});

const { displayed } = useItemList(scopedItems, {
	sortKey,
	reversed,
	filters: () => ({}),
	ratingField: 'my_rating',
	year: scopeYear,
});

// Top 100 is a ranking, so open it ranked. Only on entering the scope, not on
// load, so a bookmarked `?scope=top100&sort=title` keeps its sort — the list's
// membership is the rating ranking either way, so re-sorting is free.
watch(scope, (s) => {
	if (s === 'top100' && sortKey.value !== 'rating') sortKey.value = 'rating';
});

// If the active sort is no longer offered (e.g. title → switched to shows), fall
// back to the default.
watch(sortKeys, (keys) => {
	if (!keys.includes(sortKey.value)) sortKey.value = 'completion_date';
});
</script>
