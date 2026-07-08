<template>
	<section>
		<h1>Edit item</h1>
		<ClientOnly>
			<template #fallback><p>Loading…</p></template>
			<p v-if="pending">Loading…</p>
			<p v-else-if="error">Failed to load item: {{ error.message }}</p>
			<p v-else-if="!item">Item not found.</p>
			<template v-else>
				<p>
					<button
						v-if="canRefresh"
						type="button"
						:disabled="refreshing"
						@click="onRefresh"
					>
						{{ refreshing ? 'Refreshing…' : 'Refresh metadata' }}
					</button>
					<button
						v-if="item.type === 'book'"
						type="button"
						@click="choosingEdition = !choosingEdition"
					>
						Choose edition
					</button>
					<span v-if="refreshError" role="alert"> {{ refreshError }}</span>
				</p>
				<BookEditionPicker
					v-if="choosingEdition && item.type === 'book'"
					:initial-query="editionQuery"
					@select="onChooseEdition"
					@cancel="choosingEdition = false"
				/>
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
import type { BookMetadata, Item, ShowMetadata } from '~~/shared/types/item';
import type { SearchResult } from '~~/shared/types/search';

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
const choosingEdition = ref(false);

// Refresh is available whenever we can build a provider lookup for the item —
// which for books means a stored Google Books volume id (see draftParams).
const canRefresh = computed(
	() => !!item.value && draftParams(item.value) !== null,
);

/** A title+author query to seed the edition picker. */
const editionQuery = computed(() => {
	const it = item.value;
	if (!it) return '';
	const author = Array.isArray(it.creator) ? it.creator[0] : it.creator;
	return [it.title, author].filter(Boolean).join(' ');
});

/** Build /api/draft params for an item, or null if it isn't provider-sourced. */
function draftParams(it: Item): Record<string, string | number> | null {
	if (!it.provider || it.provider === 'manual') return null;
	if (it.type === 'show') {
		const meta = it.metadata as ShowMetadata;
		return { type: 'show', id: meta.show_tmdb_id, season: meta.season_number };
	}
	// Books enrich from Google Books, whose volume id can't be recovered from the
	// (Goodreads-namespaced) item id, so it's stored in metadata instead.
	if (it.type === 'book') {
		const meta = it.metadata as BookMetadata;
		return meta.google_books_id
			? { type: 'book', id: meta.google_books_id }
			: null;
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

/**
 * Repoint a book at a different Google Books volume: pull that volume's draft and
 * overwrite only the provider-sourced fields (cover, description, google_books_id,
 * …), leaving the item's id/provider and the user's own fields untouched. The
 * change is staged in the form and persisted on save like any edit.
 */
async function onChooseEdition(result: SearchResult) {
	refreshError.value = '';
	try {
		const draft = await $fetch<Item>('/api/draft', {
			params: { type: 'book', id: result.providerId },
		});
		formRef.value?.applyProviderFields(draft);
		choosingEdition.value = false;
	} catch {
		refreshError.value = 'Could not load that edition.';
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
