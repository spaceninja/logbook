<template>
  <div>
    <fieldset role="radiogroup" aria-label="Media type">
      <label v-for="t in TYPES" :key="t">
        <input v-model="type" type="radio" name="add-type" :value="t" />
        {{ t }}
      </label>
    </fieldset>

    <label>
      Search
      <input v-model="query" type="search" placeholder="Title…" />
    </label>

    <p v-if="pending">Searching…</p>
    <p v-else-if="error" role="alert">{{ error }}</p>
    <ul v-else-if="results.length">
      <li v-for="result in results" :key="result.providerId">
        <button type="button" @click="emit('select', result)">
          <img
            v-if="result.thumbnail"
            :src="result.thumbnail"
            :alt="`${result.title} cover`"
            width="40"
          />
          <strong>{{ result.title }}</strong>
          <span v-if="result.year"> ({{ result.year }})</span>
          <span v-if="result.subtitle"> · {{ result.subtitle }}</span>
        </button>
        <button
          v-if="result.type === 'movie' || result.type === 'game'"
          type="button"
          @click="emit('series', result)"
        >
          Add series
        </button>
      </li>
    </ul>
    <p v-else-if="query.trim()">No results.</p>

    <p>
      <button type="button" @click="emit('manual', type)">
        Enter manually instead
      </button>
    </p>
  </div>
</template>

<script setup lang="ts">
import type { MediaType } from '~~/shared/types/item';
import type { SearchResult } from '~~/shared/types/search';

const emit = defineEmits<{
  select: [result: SearchResult];
  series: [result: SearchResult];
  manual: [type: MediaType];
}>();

const TYPES: MediaType[] = ['movie', 'show', 'book', 'game'];
const type = ref<MediaType>('movie');
const query = ref('');
const results = ref<SearchResult[]>([]);
const pending = ref(false);
const error = ref('');

// Monotonic token so out-of-order responses from fast typing are ignored.
let latest = 0;
let debounce: ReturnType<typeof setTimeout> | undefined;

async function runSearch() {
  const q = query.value.trim();
  if (!q) {
    results.value = [];
    error.value = '';
    pending.value = false;
    return;
  }
  const token = ++latest;
  pending.value = true;
  error.value = '';
  try {
    const res = await $fetch<SearchResult[]>('/api/search', {
      params: { type: type.value, q },
    });
    if (token !== latest) return; // a newer search superseded this one
    results.value = res;
  } catch {
    if (token !== latest) return;
    results.value = [];
    error.value = 'Search failed. You can still enter the item manually.';
  } finally {
    if (token === latest) pending.value = false;
  }
}

// Debounce typing and re-run when the type changes.
watch([query, type], () => {
  clearTimeout(debounce);
  debounce = setTimeout(runSearch, 300);
});
</script>
