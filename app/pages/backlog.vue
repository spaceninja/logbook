<script setup lang="ts">
import type { MediaType } from '~~/shared/types/item';
import { itemDisplayTitle, formatCreator } from '~~/shared/utils/itemDisplay';
import type { FilterKey, FilterState } from '~~/shared/utils/itemFilter';
import type { SortKey } from '~~/shared/utils/itemSort';

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

const { getBacklog } = useItems();

// Content type drives the coarse query; default to books (core design §4.1).
const type = ref<MediaType>('book');

// For shows, the series sort (show name + numeric season) supersedes the title
// sort — it groups seasons and orders them numerically — so offer Series, not Title.
const sortKeys = computed<SortKey[]>(() =>
  type.value === 'show' ? SORT_KEYS.filter((k) => k !== 'title') : SORT_KEYS,
);

// Client-only: the Firestore plugin runs in the browser this milestone.
const {
  data: items,
  pending,
  error,
} = useAsyncData('backlog', () => getBacklog(type.value), {
  server: false,
  lazy: true,
  default: () => [],
  watch: [type],
});

const { sortKey, reversed, filters, displayed } = useItemList(items, {
  sortKeys: SORT_KEYS,
  defaultSort: 'rating',
  ratingField: 'community_rating',
  filterKeys: FILTER_KEYS,
});

// If the active sort is no longer offered (e.g. series → switched to shows),
// fall back to the default.
watch(sortKeys, (keys) => {
  if (!keys.includes(sortKey.value)) sortKey.value = 'rating';
});

function setFilter(key: FilterKey, state: FilterState) {
  filters[key] = state;
}
</script>

<template>
  <section>
    <h1>Backlog</h1>

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
      <ul v-else>
        <li v-for="item in displayed" :key="item.id">
          <NuxtLink :to="`/item/${item.id}`">
            <img
              v-if="item.thumbnail"
              :src="item.thumbnail"
              :alt="`${itemDisplayTitle(item)} cover`"
              width="40"
            />
            <strong>{{ itemDisplayTitle(item) }}</strong>
          </NuxtLink>
          <span> — {{ item.type }}</span>
          <span v-if="item.creator"> · {{ formatCreator(item.creator) }}</span>
          <span> · {{ item.status }}</span>
        </li>
      </ul>
    </ClientOnly>
  </section>
</template>
