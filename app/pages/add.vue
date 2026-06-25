<script setup lang="ts">
import type { Item } from '~~/shared/types/item';

definePageMeta({ middleware: 'owner' });

const { saveItem } = useItems();
const saving = ref(false);
const error = ref('');

async function onSubmit(item: Item) {
  saving.value = true;
  error.value = '';
  try {
    await saveItem(item);
    await navigateTo(`/item/${item.id}`);
  } catch (e) {
    error.value = (e as Error).message;
    saving.value = false;
  }
}
</script>

<template>
  <section>
    <h1>Add item</h1>
    <p v-if="error" role="alert">Failed to save: {{ error }}</p>
    <ItemForm mode="create" @submit="onSubmit" />
  </section>
</template>
