<script setup lang="ts">
import { itemDisplayTitle, formatCreator } from '~~/shared/utils/itemDisplay';

const route = useRoute();
const id = computed(() => String(route.params.id));

const { getItem } = useItems();

const {
  data: item,
  pending,
  error,
} = useAsyncData(
  () => `item:${id.value}`,
  () => getItem(id.value),
  {
    server: false,
    lazy: true,
    watch: [id],
  },
);

// Entries of the type-specific metadata map, for display.
const metadataEntries = computed(() =>
  item.value ? Object.entries(item.value.metadata) : [],
);
</script>

<template>
  <section>
    <p>
      <NuxtLink to="/backlog">← Backlog</NuxtLink> ·
      <NuxtLink to="/history">History</NuxtLink>
    </p>

    <!-- Client-only Firestore data; render client-side to avoid hydrating
         against the empty SSR default. -->
    <ClientOnly>
      <template #fallback>
        <p>Loading…</p>
      </template>
      <p v-if="pending">Loading…</p>
      <p v-else-if="error">Failed to load item: {{ error.message }}</p>
      <p v-else-if="!item">Item not found.</p>

      <article v-else>
        <h1>{{ itemDisplayTitle(item) }}</h1>
        <img
          v-if="item.cover"
          :src="item.cover"
          :alt="`${itemDisplayTitle(item)} cover`"
          width="200"
        />
        <dl>
          <dt>Type</dt>
          <dd>{{ item.type }}</dd>

          <dt>Status</dt>
          <dd>{{ item.status }}</dd>

          <template v-if="item.creator">
            <dt>Creator</dt>
            <dd>{{ formatCreator(item.creator) }}</dd>
          </template>

          <template v-if="item.release_date">
            <dt>Released</dt>
            <dd>{{ item.release_date }}</dd>
          </template>

          <template v-if="item.length">
            <dt>Length</dt>
            <dd>{{ item.length }} {{ item.length_unit }}</dd>
          </template>

          <template v-if="item.community_rating !== undefined">
            <dt>Community rating</dt>
            <dd>{{ item.community_rating }}</dd>
          </template>

          <template v-if="item.my_rating !== undefined">
            <dt>My rating</dt>
            <dd>{{ item.my_rating }}</dd>
          </template>

          <template v-if="item.provider">
            <dt>Provider</dt>
            <dd>{{ item.provider }}</dd>
          </template>

          <template v-if="item.recommended_by">
            <dt>Recommended by</dt>
            <dd>{{ item.recommended_by }}</dd>
          </template>

          <dt>Purchased</dt>
          <dd>{{ item.is_purchased ? 'yes' : 'no' }}</dd>

          <dt>Prioritized</dt>
          <dd>{{ item.is_prioritized ? 'yes' : 'no' }}</dd>

          <template v-if="item.completed_dates.length">
            <dt>Completed</dt>
            <dd>{{ item.completed_dates.join(', ') }}</dd>
          </template>

          <template v-if="item.tags.length">
            <dt>Tags</dt>
            <dd>{{ item.tags.join(', ') }}</dd>
          </template>

          <template v-if="item.description">
            <dt>Description</dt>
            <dd>{{ item.description }}</dd>
          </template>

          <template v-if="item.notes">
            <dt>Notes</dt>
            <dd>{{ item.notes }}</dd>
          </template>

          <template v-for="[key, value] in metadataEntries" :key="key">
            <dt>{{ key }}</dt>
            <dd>{{ value }}</dd>
          </template>
        </dl>
      </article>
    </ClientOnly>
  </section>
</template>
