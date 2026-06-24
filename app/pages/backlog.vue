<script setup lang="ts">
import { itemDisplayTitle, formatCreator } from '~~/shared/utils/itemDisplay';

const { getBacklog } = useItems();

// Client-only: the Firestore plugin runs in the browser this milestone.
const {
  data: items,
  pending,
  error,
} = useAsyncData('backlog', () => getBacklog(), {
  server: false,
  lazy: true,
  default: () => [],
});

// Coarse query returns the working set; sort by title client-side (core design §4.1).
const sorted = computed(() =>
  [...items.value].sort((a, b) =>
    itemDisplayTitle(a).localeCompare(itemDisplayTitle(b)),
  ),
);
</script>

<template>
  <section>
    <h1>Backlog</h1>
    <!-- Data comes from the client-only Firestore SDK, so render it client-side
         to avoid hydrating against the empty SSR default. -->
    <ClientOnly>
      <template #fallback>
        <p>Loading…</p>
      </template>
      <p v-if="pending">Loading…</p>
      <p v-else-if="error">Failed to load backlog: {{ error.message }}</p>
      <p v-else-if="sorted.length === 0">Nothing in the backlog.</p>
      <ul v-else>
        <li v-for="item in sorted" :key="item.id">
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
