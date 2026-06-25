<script setup lang="ts">
import type { Item } from '~~/shared/types/item';

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

const saveError = ref('');

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

<template>
  <section>
    <h1>Edit item</h1>
    <ClientOnly>
      <template #fallback>
        <p>Loading…</p>
      </template>
      <p v-if="pending">Loading…</p>
      <p v-else-if="error">Failed to load item: {{ error.message }}</p>
      <p v-else-if="!item">Item not found.</p>
      <template v-else>
        <p v-if="saveError" role="alert">Failed to save: {{ saveError }}</p>
        <ItemForm mode="edit" :initial="item" @submit="onSubmit" />
      </template>
    </ClientOnly>
  </section>
</template>
