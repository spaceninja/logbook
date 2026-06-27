<template>
  <li>
    <NuxtLink :to="`/item/${item.id}`">
      <img
        v-if="item.thumbnail"
        :src="item.thumbnail"
        :alt="`${itemDisplayTitle(item)} cover`"
        width="125"
      />
    </NuxtLink>
    <strong class="title">{{ itemDisplayTitle(item) }}</strong>
    <em v-if="formatSeries(item)" class="series">{{ formatSeries(item) }}</em>
    <span v-if="item.creator" class="creator">{{
      formatCreator(item.creator)
    }}</span>
    <span v-if="item.community_rating" class="rating">{{
      item.community_rating
    }}</span>
    <!--
      <span v-if="item.status === 'dnf'" data-status="dnf"> [DNF]</span>
      <span>
        · {{ item.status === 'dnf' ? 'stopped' : 'completed' }}
        {{ datesInYear(item).join(', ') }}</span
      >
    -->
  </li>
</template>

<script setup lang="ts">
import type { Item } from '~~/shared/types/item';

import {
  itemDisplayTitle,
  formatCreator,
  formatSeries,
} from '~~/shared/utils/itemDisplay';

defineProps<{
  item: Item;
}>();
</script>

<style scoped>
li {
  font-size: small;
  position: relative;
  text-align: center;
  text-wrap: balance;
}

.title {
  margin: 0.33em;
}

.title,
.series,
.creator,
.rating {
  display: block;
}

.series,
.creator,
.rating {
  font-size: smaller;
}

.rating {
  background: rgb(0 0 0 / 50%);
  color: white;
  padding: 0.1em 0.25em;
  position: absolute;
  right: 0;
  top: 0;
}
</style>
