<template>
  <section>
    <h1>Edit item</h1>
    <ClientOnly>
      <template #fallback><p>Loading…</p></template>
      <p v-if="pending">Loading…</p>
      <p v-else-if="error">Failed to load item: {{ error.message }}</p>
      <p v-else-if="!item">Item not found.</p>
      <template v-else>
        <p v-if="canRefresh">
          <button type="button" :disabled="refreshing" @click="onRefresh">
            {{ refreshing ? 'Refreshing…' : 'Refresh metadata' }}
          </button>
          <span v-if="refreshError" role="alert"> {{ refreshError }}</span>
        </p>
        <p v-if="saveError" role="alert">Failed to save: {{ saveError }}</p>
        <ItemForm
          ref="formRef"
          mode="edit"
          :initial="item"
          @submit="onSubmit"
        />
      </template>
    </ClientOnly>
  </section>
</template>

<script setup lang="ts">
import type { Item, ShowMetadata } from '~~/shared/types/item';

definePageMeta({ middleware: 'owner' });

const route = useRoute();
const id = computed(() => String(route.params.id));

const { getItem, saveItem } = useItems();

const {
  data: item,
  pending,
  error,
} = useAsyncData(
  () => `item-edit:${id.value}`,
  () => getItem(id.value),
  {
    server: false,
    lazy: true,
    watch: [id],
  },
);

// Type is inferred from the <ItemForm ref="formRef"> in the template, including
// its exposed applyProviderFields.
const formRef = useTemplateRef('formRef');
const saveError = ref('');
const refreshing = ref(false);
const refreshError = ref('');

const canRefresh = computed(
  () => !!item.value?.provider && item.value.provider !== 'manual',
);

/** Build /api/draft params for an item, or null if it isn't provider-sourced. */
function draftParams(it: Item): Record<string, string | number> | null {
  if (!it.provider || it.provider === 'manual') return null;
  if (it.type === 'show') {
    const meta = it.metadata as ShowMetadata;
    return { type: 'show', id: meta.show_tmdb_id, season: meta.season_number };
  }
  // Native provider id is the id with the `<type>-<provider>-` prefix removed.
  const prefix = `${it.type}-${it.provider}-`;
  if (!it.id.startsWith(prefix)) return null;
  return { type: it.type, id: it.id.slice(prefix.length) };
}

async function onRefresh() {
  if (!item.value) return;
  const params = draftParams(item.value);
  if (!params) return;
  refreshing.value = true;
  refreshError.value = '';
  try {
    const draft = await $fetch<Item>('/api/draft', { params });
    formRef.value?.applyProviderFields(draft);
  } catch {
    refreshError.value = 'Could not refresh metadata from the provider.';
  } finally {
    refreshing.value = false;
  }
}

async function onSubmit(updated: Item) {
  saveError.value = '';
  try {
    await saveItem(updated);
    await navigateTo(`/item/${id.value}`);
  } catch (e) {
    saveError.value = (e as Error).message;
  }
}
</script>
