<script setup lang="ts">
import type { Item, MediaType } from '~~/shared/types/item';
import type { SearchResult } from '~~/shared/types/search';

definePageMeta({ middleware: 'owner' });

const { saveItem } = useItems();

type Step = 'search' | 'seasons' | 'batch' | 'form';
const step = ref<Step>('search');
const formInitial = ref<Item | undefined>();
const manualType = ref<MediaType>('movie');
const showResult = ref<SearchResult | null>(null);
const batchDrafts = ref<Item[]>([]);
const error = ref('');

function reset() {
  step.value = 'search';
  formInitial.value = undefined;
  showResult.value = null;
  error.value = '';
}

async function onSelect(result: SearchResult) {
  error.value = '';
  if (result.type === 'show') {
    showResult.value = result;
    step.value = 'seasons';
    return;
  }
  try {
    formInitial.value = await $fetch<Item>('/api/draft', {
      params: { type: result.type, id: result.providerId },
    });
    step.value = 'form';
  } catch {
    error.value = 'Could not load that item. Try entering it manually.';
  }
}

function onManual(type: MediaType) {
  formInitial.value = undefined; // empty form → manual UUID id
  manualType.value = type;
  step.value = 'form';
}

async function onSeasonsConfirm(seasonNumbers: number[]) {
  error.value = '';
  const id = showResult.value!.providerId;
  try {
    const drafts = await Promise.all(
      seasonNumbers.map((season) =>
        $fetch<Item>('/api/draft', { params: { type: 'show', id, season } }),
      ),
    );
    if (drafts.length === 1) {
      formInitial.value = drafts[0];
      step.value = 'form';
    } else {
      batchDrafts.value = drafts;
      step.value = 'batch';
    }
  } catch {
    error.value = 'Could not load those seasons. Go back and try again.';
  }
}

async function onFormSubmit(item: Item) {
  error.value = '';
  try {
    await saveItem(item);
    await navigateTo(`/item/${item.id}`);
  } catch (e) {
    error.value = (e as Error).message;
  }
}

function onBatchDone() {
  navigateTo('/backlog');
}
</script>

<template>
  <section>
    <h1>Add item</h1>
    <p v-if="error" role="alert">{{ error }}</p>

    <AddSearch v-if="step === 'search'" @select="onSelect" @manual="onManual" />

    <SeasonPicker
      v-else-if="step === 'seasons' && showResult"
      :show-id="showResult.providerId"
      :show-title="showResult.title"
      @confirm="onSeasonsConfirm"
      @back="reset"
    />

    <BatchAddPanel
      v-else-if="step === 'batch'"
      :drafts="batchDrafts"
      @done="onBatchDone"
      @back="reset"
    />

    <template v-else-if="step === 'form'">
      <p><button type="button" @click="reset">← Back to search</button></p>
      <ItemForm
        mode="create"
        :initial="formInitial"
        :initial-type="manualType"
        @submit="onFormSubmit"
      />
    </template>
  </section>
</template>
