<template>
  <div>
    <p>
      <button type="button" @click="emit('back')">← Back to search</button>
    </p>
    <h2>{{ title }} — pick titles to add</h2>

    <ul>
      <li v-for="member in members" :key="member.providerId">
        <label>
          <input
            type="checkbox"
            :checked="selected.has(member.providerId)"
            @change="toggle(member.providerId)"
          />
          <img
            v-if="member.thumbnail"
            :src="member.thumbnail"
            :alt="`${member.title} cover`"
            width="30"
          />
          {{ member.title }}
          <span v-if="member.year"> · {{ member.year }}</span>
        </label>
      </li>
    </ul>

    <button type="button" :disabled="selected.size === 0" @click="confirm">
      Add {{ selected.size }} title(s)
    </button>
  </div>
</template>

<script setup lang="ts">
import type { SearchResult } from '~~/shared/types/search';

defineProps<{ title: string; members: SearchResult[] }>();
const emit = defineEmits<{ confirm: [providerIds: string[]]; back: [] }>();

const selected = ref<Set<string>>(new Set());

function toggle(providerId: string) {
  const next = new Set(selected.value);
  if (next.has(providerId)) next.delete(providerId);
  else next.add(providerId);
  selected.value = next;
}

function confirm() {
  if (selected.value.size) emit('confirm', [...selected.value]);
}
</script>
