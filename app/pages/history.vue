<template>
  <section>
    <h1>History</h1>
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
      <ul v-else>
        <li v-for="item in displayed" :key="item.id">
          <NuxtLink :to="`/item/${item.id}`">
            <strong>{{ itemDisplayTitle(item) }}</strong>
          </NuxtLink>
          <span v-if="item.status === 'dnf'" data-status="dnf"> [DNF]</span>
          <span> — {{ item.type }}</span>
          <span v-if="item.creator"> · {{ formatCreator(item.creator) }}</span>
          <span v-if="formatSeries(item)"> · {{ formatSeries(item) }}</span>
          <span v-if="item.my_rating !== undefined">
            · ★ {{ item.my_rating }}</span
          >
          <span>
            · {{ item.status === 'dnf' ? 'stopped' : 'completed' }}
            {{ datesInYear(item).join(', ') }}</span
          >
        </li>
      </ul>
    </ClientOnly>
  </section>
</template>

<script setup lang="ts">
import type { Item, MediaType } from '~~/shared/types/item';
import type { CompletionYearsByType } from '~~/shared/utils/completionYears';
import {
  itemDisplayTitle,
  formatCreator,
  formatSeries,
} from '~~/shared/utils/itemDisplay';
import type { SortKey } from '~~/shared/utils/itemSort';

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

// Years offered by the switcher come from the maintained `meta/completionYears`
// aggregate (core design §15), scoped to the selected type so we never offer a
// year that has nothing for it. The whole per-type map loads once; switching
// type just re-reads it locally. Newest first; falls back to the current
// calendar year before the aggregate loads or when the type has no completions.
const currentYear = new Date().getFullYear();
const { data: completionYears } = useAsyncData(
  'completionYears',
  () => getCompletionYears(),
  {
    server: false,
    lazy: true,
    default: (): CompletionYearsByType => ({}),
  },
);
const years = computed<number[]>(() => {
  const ys = completionYears.value[type.value] ?? [];
  return ys.length ? [...ys].sort((a, b) => b - a) : [currentYear];
});

const year = ref<number>(currentYear);
const type = ref<MediaType>('book');

// Once the year list loads, snap the selection to the newest available year if
// the current one isn't offered (e.g. nothing completed yet this calendar year).
watch(
  years,
  (ys) => {
    if (!ys.includes(year.value)) year.value = ys[0]!;
  },
  { immediate: true },
);

// For shows, the series sort (show name + numeric season) replaces the title sort.
const sortKeys = computed<SortKey[]>(() =>
  type.value === 'show'
    ? SORT_KEYS.map((k) => (k === 'title' ? 'series' : k))
    : SORT_KEYS,
);

const {
  data: items,
  pending,
  error,
} = useAsyncData('history', () => getHistory(year.value, type.value), {
  server: false,
  lazy: true,
  default: () => [],
  watch: [year, type],
});

const { sortKey, reversed, displayed } = useItemList(items, {
  sortKeys: SORT_KEYS,
  defaultSort: 'completion_date',
  ratingField: 'my_rating',
  filterKeys: [],
  year,
});

// If the active sort is no longer offered (e.g. title → switched to shows), fall
// back to the default.
watch(sortKeys, (keys) => {
  if (!keys.includes(sortKey.value)) sortKey.value = 'completion_date';
});

/** The completion date(s) for this item that fall in the selected year. */
function datesInYear(item: Item): string[] {
  return item.completed_dates.filter(
    (d) => Number.parseInt(d.slice(0, 4), 10) === year.value,
  );
}
</script>
