<script setup lang="ts">
import type { Item, ItemStatus } from '~~/shared/types/item';
import { itemDisplayTitle } from '~~/shared/utils/itemDisplay';

const props = withDefaults(defineProps<{ drafts: Item[]; unit?: string }>(), {
  unit: 'item',
});
const emit = defineEmits<{ done: []; back: [] }>();

const { saveItem } = useItems();

// Shared owner fields applied to every selected season.
const status = ref<ItemStatus>('backlog');
const isPrioritized = ref(false);
const isPurchased = ref(false);
const recommendedBy = ref('');
const tags = ref('');
const notes = ref('');

const fullEdit = ref(false);
const fullEditIndex = ref(0);
const saving = ref(false);
const error = ref('');

/** Merge the shared owner fields into a provider draft. */
function applyShared(draft: Item): Item {
  const item: Item = {
    ...draft,
    status: status.value,
    is_prioritized: isPrioritized.value,
    is_purchased: isPurchased.value,
  };
  // "Complete" seeds each season's completion with its air date (per the spec);
  // saveItem recomputes completed_years.
  if (status.value === 'complete' && draft.release_date) {
    item.completed_dates = [draft.release_date];
  }
  const rb = recommendedBy.value.trim();
  if (rb) item.recommended_by = rb;
  const n = notes.value.trim();
  if (n) item.notes = n;
  const userTags = tags.value
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
  if (userTags.length) item.tags = [...new Set([...draft.tags, ...userTags])];
  return item;
}

async function saveAll() {
  saving.value = true;
  error.value = '';
  try {
    for (const draft of props.drafts) await saveItem(applyShared(draft));
    emit('done');
  } catch (e) {
    error.value = (e as Error).message;
    saving.value = false;
  }
}

// Full-edit mode: prefill each season's form with the shared fields applied,
// save as you go so bailing partway keeps the earlier saves.
const currentDraft = computed(() =>
  applyShared(props.drafts[fullEditIndex.value]!),
);

async function onFullEditSubmit(item: Item) {
  error.value = '';
  try {
    await saveItem(item);
    if (fullEditIndex.value < props.drafts.length - 1) fullEditIndex.value += 1;
    else emit('done');
  } catch (e) {
    error.value = (e as Error).message;
  }
}
</script>

<template>
  <div>
    <p>
      <button type="button" @click="emit('back')">← Back to search</button>
    </p>

    <!-- Full edit: one form per item, saved as you go. -->
    <template v-if="fullEdit">
      <h2>{{ unit }} {{ fullEditIndex + 1 }} of {{ drafts.length }}</h2>
      <p v-if="error" role="alert">{{ error }}</p>
      <ItemForm
        :key="fullEditIndex"
        mode="create"
        :initial="currentDraft"
        @submit="onFullEditSubmit"
      />
    </template>

    <!-- Streamlined: shared fields applied to all selected items. -->
    <template v-else>
      <h2>Add {{ drafts.length }} {{ unit }}s</h2>
      <ul>
        <li v-for="draft in drafts" :key="draft.id">
          {{ itemDisplayTitle(draft) }}
          <span v-if="draft.release_date"> · {{ draft.release_date }}</span>
        </li>
      </ul>

      <p v-if="error" role="alert">{{ error }}</p>

      <label>
        Status
        <select v-model="status">
          <option value="backlog">backlog</option>
          <option value="in_progress">in_progress</option>
          <option value="complete">complete</option>
        </select>
      </label>
      <p v-if="status === 'complete'">
        Each {{ unit }} will be saved as complete with an initial completion
        date of its release date and no rating. Edit individual {{ unit }}s to
        set a custom date or rating.
      </p>

      <label>
        <input v-model="isPrioritized" type="checkbox" />
        Prioritized
      </label>
      <label>
        <input v-model="isPurchased" type="checkbox" />
        Purchased
      </label>
      <label>
        Recommended by
        <input v-model="recommendedBy" type="text" />
      </label>
      <label>
        Tags <small>(comma-separated)</small>
        <input v-model="tags" type="text" />
      </label>
      <label>
        Notes
        <textarea v-model="notes" />
      </label>

      <p>
        <button type="button" :disabled="saving" @click="saveAll">
          {{ saving ? 'Saving…' : `Add ${drafts.length} ${unit}s` }}
        </button>
        <button type="button" :disabled="saving" @click="fullEdit = true">
          Full edit instead
        </button>
      </p>
    </template>
  </div>
</template>
