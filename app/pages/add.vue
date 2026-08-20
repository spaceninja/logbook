<template>
	<section>
		<h1>Add item</h1>
		<p v-if="error" role="alert">{{ error }}</p>

		<AddSearch
			v-if="step === 'search'"
			@select="onSelect"
			@series="onSeries"
			@manual="onManual"
		/>

		<SeasonPicker
			v-else-if="step === 'seasons' && showResult"
			:show-id="showResult.providerId"
			:show-title="showResult.title"
			@confirm="onSeasonsConfirm"
			@back="reset"
		/>

		<SeriesPicker
			v-else-if="step === 'series'"
			:title="seriesTitle"
			:members="seriesMembers"
			@confirm="onSeriesConfirm"
			@back="reset"
		/>

		<BatchAddPanel
			v-else-if="step === 'batch'"
			:drafts="batchDrafts"
			:unit="batchUnit"
			@done="onBatchDone"
			@back="reset"
		/>

		<template v-else-if="step === 'form'">
			<p><button type="button" @click="reset">← Back to search</button></p>
			<p v-if="existing" role="status">
				Already in your logbook as “{{ existing.title }}” — editing that entry
				instead of adding a second copy.
			</p>
			<ItemForm
				:mode="existing ? 'edit' : 'create'"
				:initial="formInitial"
				:initial-type="manualType"
				@submit="onFormSubmit"
			/>
		</template>
	</section>
</template>

<script setup lang="ts">
import { findBookTwin } from '~~/shared/import/bookTwin';
import type { Item, MediaType } from '~~/shared/types/item';
import type { SearchResult } from '~~/shared/types/search';

definePageMeta({ middleware: 'owner' });
useHead({ title: 'Add Item' });

const { getAllByType, saveItem } = useItems();

type Step = 'search' | 'seasons' | 'series' | 'batch' | 'form';
const step = ref<Step>('search');
const formInitial = ref<Item | undefined>();
const manualType = ref<MediaType>('movie');
const showResult = ref<SearchResult | null>(null);
const seriesMembers = ref<SearchResult[]>([]);
const seriesTitle = ref('');
const seriesType = ref<MediaType>('movie');
const batchDrafts = ref<Item[]>([]);
const batchUnit = ref('item');
const error = ref('');
/** The library entry this book already has, when the search found one (#105). */
const existing = ref<Item | undefined>();

function reset() {
	step.value = 'search';
	formInitial.value = undefined;
	existing.value = undefined;
	showResult.value = null;
	seriesMembers.value = [];
	error.value = '';
}

/**
 * The document this book is already tracked under, if any.
 *
 * A book drafted from search is keyed by its Google Books volume id, but the same
 * book shelved on Goodreads lives under a Goodreads id — two id spaces that never
 * collide, so adding it again would silently create a second document the daily
 * sync can't see (#105). Editing the entry that already exists is what the owner
 * meant either way.
 *
 * Best-effort: if the library read fails, the add proceeds as a new item rather
 * than blocking on a check.
 */
async function findExisting(draft: Item): Promise<Item | undefined> {
	try {
		const match = findBookTwin(await getAllByType('book'), draft);
		return match.kind === 'isbn' || match.kind === 'title'
			? match.twin
			: undefined;
	} catch {
		return undefined;
	}
}

async function onSelect(result: SearchResult) {
	error.value = '';
	existing.value = undefined;
	if (result.type === 'show') {
		showResult.value = result;
		step.value = 'seasons';
		return;
	}
	try {
		const draft = await $fetch<Item>('/api/draft', {
			params: { type: result.type, id: result.providerId },
		});
		existing.value =
			result.type === 'book' ? await findExisting(draft) : undefined;
		formInitial.value = existing.value ?? draft;
		step.value = 'form';
	} catch {
		error.value = 'Could not load that item. Try entering it manually.';
	}
}

async function onSeries(result: SearchResult) {
	error.value = '';
	try {
		const members = await $fetch<SearchResult[]>('/api/series', {
			params: { type: result.type, id: result.providerId },
		});
		if (!members.length) {
			error.value = `No series found for “${result.title}”.`;
			return;
		}
		seriesType.value = result.type;
		seriesTitle.value = result.title;
		seriesMembers.value = members;
		step.value = 'series';
	} catch {
		error.value = 'Could not load the series.';
	}
}

function onManual(type: MediaType) {
	formInitial.value = undefined; // empty form → manual UUID id
	manualType.value = type;
	step.value = 'form';
}

async function fetchDrafts(
	type: MediaType,
	params: Record<string, string | number>[],
) {
	return Promise.all(
		params.map((p) => $fetch<Item>('/api/draft', { params: { type, ...p } })),
	);
}

async function onSeasonsConfirm(seasonNumbers: number[]) {
	error.value = '';
	const id = showResult.value!.providerId;
	try {
		const drafts = await fetchDrafts(
			'show',
			seasonNumbers.map((season) => ({ id, season })),
		);
		if (drafts.length === 1) {
			formInitial.value = drafts[0];
			step.value = 'form';
		} else {
			batchDrafts.value = drafts;
			batchUnit.value = 'season';
			step.value = 'batch';
		}
	} catch {
		error.value = 'Could not load those seasons. Go back and try again.';
	}
}

async function onSeriesConfirm(providerIds: string[]) {
	error.value = '';
	try {
		const drafts = await fetchDrafts(
			seriesType.value,
			providerIds.map((id) => ({ id })),
		);
		if (drafts.length === 1) {
			formInitial.value = drafts[0];
			step.value = 'form';
		} else {
			batchDrafts.value = drafts;
			batchUnit.value = seriesType.value; // "movie" / "game"
			step.value = 'batch';
		}
	} catch {
		error.value = 'Could not load those titles. Go back and try again.';
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
	navigateTo('/');
}
</script>
