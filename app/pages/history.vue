<script setup lang="ts">
import type { Item } from '~~/shared/types/item';
import { itemDisplayTitle, formatCreator } from '~~/shared/utils/itemDisplay';

const YEARS = [2026, 2025];
const year = ref<number>(YEARS[0]!);

const { getHistory } = useItems();

const {
  data: items,
  pending,
  error,
} = await useAsyncData('history', () => getHistory(year.value), {
  server: false,
  default: () => [],
  watch: [year],
});

/** The completion date(s) for this item that fall in the selected year. */
function datesInYear(item: Item): string[] {
  return item.completed_dates.filter(
    (d) => Number.parseInt(d.slice(0, 4), 10) === year.value,
  );
}

// Sort by most recent completion within the selected year, descending.
const sorted = computed(() =>
  [...items.value].sort((a, b) => {
    const aDate = datesInYear(a).sort().at(-1) ?? '';
    const bDate = datesInYear(b).sort().at(-1) ?? '';
    return bDate.localeCompare(aDate);
  }),
);
</script>

<template>
  <section>
    <h1>History</h1>
    <label>
      Year:
      <select v-model.number="year">
        <option v-for="y in YEARS" :key="y" :value="y">{{ y }}</option>
      </select>
    </label>

    <p v-if="pending">Loading…</p>
    <p v-else-if="error">Failed to load history: {{ error.message }}</p>
    <p v-else-if="sorted.length === 0">Nothing completed in {{ year }}.</p>
    <ul v-else>
      <li v-for="item in sorted" :key="item.id">
        <NuxtLink :to="`/item/${item.id}`">
          <strong>{{ itemDisplayTitle(item) }}</strong>
        </NuxtLink>
        <span> — {{ item.type }}</span>
        <span v-if="item.creator"> · {{ formatCreator(item.creator) }}</span>
        <span> · completed {{ datesInYear(item).join(', ') }}</span>
      </li>
    </ul>
  </section>
</template>
