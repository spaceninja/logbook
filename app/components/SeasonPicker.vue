<template>
  <div>
    <p>
      <button type="button" @click="emit('back')">← Back to search</button>
    </p>
    <h2>{{ showTitle }} — pick seasons</h2>

    <ClientOnly>
      <template #fallback><p>Loading seasons…</p></template>
      <p v-if="pending">Loading seasons…</p>
      <p v-else-if="error" role="alert">
        Could not load seasons. Go back and try again.
      </p>
      <template v-else>
        <label v-if="hasSpecials">
          <input v-model="includeSpecials" type="checkbox" />
          Include Specials (Season 0)
        </label>
        <ul>
          <li v-for="season in visible" :key="season.season_number">
            <label>
              <input
                type="checkbox"
                :checked="selected.has(season.season_number)"
                @change="toggle(season.season_number)"
              />
              {{ season.name }}
              <span v-if="season.year"> · {{ season.year }}</span>
              · {{ season.episode_count }} eps
            </label>
          </li>
        </ul>
        <button type="button" :disabled="selected.size === 0" @click="confirm">
          Add {{ selected.size }} season(s)
        </button>
      </template>
    </ClientOnly>
  </div>
</template>

<script setup lang="ts">
import type { SeasonSummary } from '~~/shared/types/search';

const props = defineProps<{ showId: string; showTitle: string }>();
const emit = defineEmits<{ confirm: [seasons: number[]]; back: [] }>();

const {
  data: seasons,
  pending,
  error,
} = useAsyncData(
  () => `seasons:${props.showId}`,
  () =>
    $fetch<SeasonSummary[]>('/api/seasons', {
      params: { showId: props.showId },
    }),
  { server: false, lazy: true, default: () => [] },
);

const includeSpecials = ref(false);
const selected = ref<Set<number>>(new Set());

// Season 0 (Specials) is hidden unless opted in.
const visible = computed(() =>
  (seasons.value ?? []).filter(
    (s) => includeSpecials.value || s.season_number !== 0,
  ),
);
const hasSpecials = computed(() =>
  (seasons.value ?? []).some((s) => s.season_number === 0),
);

function toggle(n: number) {
  const next = new Set(selected.value);
  if (next.has(n)) next.delete(n);
  else next.add(n);
  selected.value = next;
}

function confirm() {
  if (selected.value.size) {
    emit(
      'confirm',
      [...selected.value].sort((a, b) => a - b),
    );
  }
}
</script>
