<template>
	<form
		:aria-label="mode === 'create' ? 'Add item' : 'Edit item'"
		@submit.prevent="onSubmit"
	>
		<p v-if="error" role="alert">{{ error }}</p>

		<label>
			Type
			<select v-model="form.type">
				<option v-for="t in MEDIA_TYPES" :key="t" :value="t">{{ t }}</option>
			</select>
		</label>

		<label>
			Title
			<input v-model="form.title" type="text" required />
		</label>

		<label>
			Creator <small>(comma-separated for multiple)</small>
			<input v-model="form.creator" type="text" />
		</label>

		<label>
			Creator sort key <small>(surname first; blank = auto)</small>
			<input v-model="form.creator_sort" type="text" />
		</label>

		<label>
			Status
			<select v-model="form.status">
				<option v-for="s in STATUSES" :key="s" :value="s">{{ s }}</option>
			</select>
		</label>

		<label>
			Release date
			<input v-model="form.release_date" type="date" />
		</label>

		<label>
			Description
			<textarea v-model="form.description" />
		</label>

		<label>
			Cover URL
			<input v-model="form.cover" type="url" />
		</label>

		<label>
			Thumbnail URL
			<input v-model="form.thumbnail" type="url" />
		</label>

		<label>
			Backdrop URL
			<input v-model="form.backdrop" type="url" />
		</label>

		<label>
			Length
			<input v-model="form.length" type="number" min="0" />
		</label>

		<label>
			Length unit
			<select v-model="form.length_unit">
				<option v-for="u in LENGTH_UNITS" :key="u" :value="u">{{ u }}</option>
			</select>
		</label>

		<label>
			Community rating <small>(0–10)</small>
			<input
				v-model="form.community_rating"
				type="number"
				min="0"
				max="10"
				step="any"
			/>
		</label>

		<label>
			My rating <small>(0–10)</small>
			<input
				v-model="form.my_rating"
				type="number"
				min="0"
				max="10"
				step="any"
			/>
		</label>

		<!-- Data source is provenance, not an editable field: it's the id namespace
		     (e.g. a book's id is book-goodreads-…) and the refresh key, so changing
		     it only desyncs those. Shown read-only; it round-trips on submit. -->
		<p>Data source: {{ form.provider }}</p>

		<label>
			Recommended by
			<input v-model="form.recommended_by" type="text" />
		</label>

		<label>
			<input v-model="form.is_purchased" type="checkbox" />
			Purchased
		</label>

		<label>
			<input v-model="form.is_prioritized" type="checkbox" />
			Prioritized
		</label>

		<fieldset>
			<legend>Completed dates</legend>
			<div v-for="(date, index) in form.completed_dates" :key="index">
				<input v-model="form.completed_dates[index]" type="date" />
				<button type="button" @click="removeDate(index)">Remove</button>
			</div>
			<button type="button" @click="addDate">Add date</button>
		</fieldset>

		<label>
			Notes
			<textarea v-model="form.notes" />
		</label>

		<label>
			Tags <small>(comma-separated)</small>
			<input v-model="form.tags" type="text" />
		</label>

		<!-- Type-specific metadata -->
		<fieldset v-if="form.type === 'book'">
			<legend>Book details</legend>
			<label>
				Series
				<input v-model="form.series" type="text" />
			</label>
			<label>
				Series number
				<input v-model="form.series_number" type="number" min="0" step="any" />
			</label>
			<label>
				ISBN
				<input v-model="form.isbn" type="text" />
			</label>
		</fieldset>

		<fieldset v-else-if="form.type === 'movie'">
			<legend>Movie details</legend>
			<label>
				Series
				<input v-model="form.series" type="text" />
			</label>
			<label>
				Series number
				<input v-model="form.series_number" type="number" min="0" step="any" />
			</label>
		</fieldset>

		<fieldset v-else-if="form.type === 'show'">
			<legend>Show details</legend>
			<label>
				Show TMDB id
				<input v-model="form.show_tmdb_id" type="number" min="0" />
			</label>
			<label>
				Season number
				<input v-model="form.season_number" type="number" min="0" step="any" />
			</label>
			<label>
				Season title <small>(if different from the show name)</small>
				<input v-model="form.season_title" type="text" />
			</label>
			<label>
				Episode count
				<input v-model="form.episode_count" type="number" min="0" />
			</label>
			<label>
				Episode runtime <small>(min)</small>
				<input v-model="form.episode_runtime" type="number" min="0" />
			</label>
		</fieldset>

		<fieldset v-else-if="form.type === 'game'">
			<legend>Game details</legend>
			<label>
				Series
				<input v-model="form.series" type="text" />
			</label>
			<label>
				Series number
				<input v-model="form.series_number" type="number" min="0" step="any" />
			</label>
			<label>
				Platform
				<input v-model="form.platform" type="text" />
			</label>
		</fieldset>

		<button type="submit">
			{{ mode === 'create' ? 'Add item' : 'Save changes' }}
		</button>
	</form>
</template>

<script setup lang="ts">
import type {
	Item,
	ItemMetadata,
	ItemStatus,
	LengthUnit,
	MediaType,
	Provider,
	ShowMetadata,
} from '~~/shared/types/item';
import { deriveCompletedYears } from '~~/shared/utils/completedYears';
import { deriveCreatorSort } from '~~/shared/utils/creatorSort';
import { makeManualId } from '~~/shared/utils/itemId';

const props = defineProps<{
	mode: 'create' | 'edit';
	initial?: Item;
	/** Starting type for a manual add (no `initial`); ignored when `initial` is set. */
	initialType?: MediaType;
}>();

const emit = defineEmits<{ submit: [item: Item] }>();

const MEDIA_TYPES: MediaType[] = ['book', 'movie', 'show', 'game'];
const STATUSES: ItemStatus[] = ['backlog', 'in_progress', 'complete', 'dnf'];
const LENGTH_UNITS: LengthUnit[] = ['pages', 'min', 'episodes', 'hours'];

// Form state mirrors the schema but holds inputs as strings (numbers parsed on
// submit), so empty inputs are easy to detect and omit.
interface FormState {
	type: MediaType;
	title: string;
	creator: string;
	creator_sort: string;
	cover: string;
	thumbnail: string;
	backdrop: string;
	release_date: string;
	description: string;
	length: string;
	length_unit: LengthUnit;
	community_rating: string;
	my_rating: string;
	provider: Provider;
	recommended_by: string;
	status: ItemStatus;
	is_purchased: boolean;
	is_prioritized: boolean;
	completed_dates: string[];
	notes: string;
	tags: string;
	// metadata (only the block matching `type` is read on submit)
	series: string;
	series_number: string;
	isbn: string;
	/** Google Books volume id — carried (not user-editable) so a save keeps the book's refresh handle. */
	google_books_id: string;
	show_tmdb_id: string;
	season_number: string;
	season_title: string;
	episode_count: string;
	episode_runtime: string;
	platform: string;
}

function defaultUnit(type: MediaType): LengthUnit {
	if (type === 'book') return 'pages';
	if (type === 'game') return 'hours';
	return 'min';
}

// Convert stored values to the string-based form fields.
const numStr = (v: unknown) => (typeof v === 'number' ? String(v) : '');
const str = (v: unknown) => (typeof v === 'string' ? v : '');
const creatorStr = (creator: Item['creator']) =>
	Array.isArray(creator) ? creator.join(', ') : (creator ?? '');

function initialForm(): FormState {
	const i = props.initial;
	const type = i?.type ?? props.initialType ?? 'movie';
	const m = (i?.metadata ?? {}) as Record<string, unknown>;
	return {
		type,
		title: i?.title ?? '',
		creator: creatorStr(i?.creator),
		creator_sort: i?.creator_sort ?? deriveCreatorSort(i?.creator, type) ?? '',
		cover: i?.cover ?? '',
		thumbnail: i?.thumbnail ?? '',
		backdrop: i?.backdrop ?? '',
		release_date: i?.release_date ?? '',
		description: i?.description ?? '',
		length: numStr(i?.length),
		length_unit: i?.length_unit ?? defaultUnit(type),
		community_rating: numStr(i?.community_rating),
		my_rating: numStr(i?.my_rating),
		provider: i?.provider ?? 'manual',
		recommended_by: i?.recommended_by ?? '',
		status: i?.status ?? 'backlog',
		is_purchased: i?.is_purchased ?? false,
		is_prioritized: i?.is_prioritized ?? false,
		completed_dates: i ? [...i.completed_dates] : [],
		notes: i?.notes ?? '',
		tags: i ? i.tags.join(', ') : '',
		series: str(m.series),
		series_number: numStr(m.series_number),
		isbn: str(m.isbn),
		google_books_id: str(m.google_books_id),
		show_tmdb_id: numStr(m.show_tmdb_id),
		season_number: numStr(m.season_number),
		season_title: str(m.season_title),
		episode_count: numStr(m.episode_count),
		episode_runtime: numStr(m.episode_runtime),
		platform: str(m.platform),
	};
}

const form = reactive<FormState>(initialForm());
const error = ref('');

/**
 * Overwrite only the provider-sourced fields from `source`, leaving the user's
 * fields (status, ratings, completion, notes, tags, …) and any unsaved edits
 * intact. Used by the edit page's "Refresh metadata" action.
 */
function applyProviderFields(source: Item) {
	const m = source.metadata as Record<string, unknown>;
	form.title = source.title;
	form.creator = creatorStr(source.creator);
	form.creator_sort =
		source.creator_sort ?? deriveCreatorSort(source.creator, source.type) ?? '';
	form.cover = source.cover ?? '';
	form.thumbnail = source.thumbnail ?? '';
	form.backdrop = source.backdrop ?? '';
	form.release_date = source.release_date ?? '';
	form.description = source.description ?? '';
	// length is user-maintainable and the provider's coverage is thin (IGDB
	// time-to-beat is often absent), so a refresh must not wipe a hand-entered
	// value — only overwrite when the fresh draft carries a length.
	if (source.length !== undefined) {
		form.length = numStr(source.length);
		form.length_unit = source.length_unit ?? defaultUnit(form.type);
	}
	form.community_rating = numStr(source.community_rating);
	// series and series_number are user-maintained (no provider returns them yet),
	// so a refresh must not wipe them — only overwrite when the fresh draft carries
	// the value.
	if (m.series) form.series = str(m.series);
	if (m.series_number !== undefined)
		form.series_number = numStr(m.series_number);
	form.isbn = str(m.isbn);
	form.google_books_id = str(m.google_books_id);
	form.show_tmdb_id = numStr(m.show_tmdb_id);
	form.season_number = numStr(m.season_number);
	form.season_title = str(m.season_title);
	form.episode_count = numStr(m.episode_count);
	form.episode_runtime = numStr(m.episode_runtime);
	form.platform = str(m.platform);
}

defineExpose({ applyProviderFields });

// Reset the length unit to the type's default when the type changes.
watch(
	() => form.type,
	(type) => {
		form.length_unit = defaultUnit(type);
	},
);

/** Today as a local `YYYY-MM-DD` (not UTC, which can be a day off near midnight). */
function todayIso(): string {
	const now = new Date();
	const pad = (n: number) => String(n).padStart(2, '0');
	return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

// Completing an item auto-adds today's date if none is set — a timesaver, and it
// keeps a completed item from being saved undated by accident (which would hide it
// from both History and Backlog). Not required: the user can remove it to file the
// item under History's "Undated" bucket intentionally.
watch(
	() => form.status,
	(status) => {
		if (
			(status === 'complete' || status === 'dnf') &&
			form.completed_dates.length === 0
		) {
			form.completed_dates.push(todayIso());
		}
	},
);

function addDate() {
	form.completed_dates.push('');
}
function removeDate(index: number) {
	form.completed_dates.splice(index, 1);
}

// `<input type="number">` v-model yields a number once edited, so coerce to a
// string before trimming (the field may hold either a string or a number).
function num(value: string | number): number | undefined {
	const trimmed = String(value).trim();
	if (trimmed === '') return undefined;
	const n = Number(trimmed);
	return Number.isNaN(n) ? undefined : n;
}

function parseList(value: string): string[] {
	return value
		.split(',')
		.map((part) => part.trim())
		.filter(Boolean);
}

function parseCreator(value: string): string | string[] | undefined {
	const parts = parseList(value);
	if (parts.length === 0) return undefined;
	if (parts.length === 1) return parts[0];
	return parts;
}

// Series name/number, shared by the types that support it (book/movie/game).
function seriesMeta(): { series?: string; series_number?: number } {
	const meta: { series?: string; series_number?: number } = {};
	if (form.series.trim()) meta.series = form.series.trim();
	const seriesNumber = num(form.series_number);
	if (seriesNumber !== undefined) meta.series_number = seriesNumber;
	return meta;
}

function assembleMetadata(): ItemMetadata {
	switch (form.type) {
		case 'book': {
			const meta: Record<string, string | number> = { ...seriesMeta() };
			if (form.isbn.trim()) meta.isbn = form.isbn.trim();
			if (form.google_books_id.trim())
				meta.google_books_id = form.google_books_id.trim();
			return meta;
		}
		case 'movie':
			return seriesMeta();
		case 'show': {
			const meta: ShowMetadata = {
				show_tmdb_id: num(form.show_tmdb_id) ?? 0,
				season_number: num(form.season_number) ?? 0,
				episode_count: num(form.episode_count) ?? 0,
				episode_runtime: num(form.episode_runtime) ?? 0,
			};
			if (form.season_title.trim())
				meta.season_title = form.season_title.trim();
			return meta;
		}
		case 'game': {
			const meta: Record<string, string | number> = { ...seriesMeta() };
			if (form.platform.trim()) meta.platform = form.platform.trim();
			return meta;
		}
		default:
			return {};
	}
}

function assemble(): Item {
	const completedDates = form.completed_dates
		.map((d) => d.trim())
		.filter(Boolean);

	const item: Item = {
		// Keep the id from `initial` when present — an edit, or a create prefilled
		// from a provider draft (e.g. movie-tmdb-27205). Only a truly manual add
		// (empty form) mints a UUID id.
		id: props.initial?.id ?? makeManualId(form.type),
		type: form.type,
		title: form.title.trim(),
		provider: form.provider,
		status: form.status,
		is_purchased: form.is_purchased,
		is_prioritized: form.is_prioritized,
		completed_dates: completedDates,
		completed_years: deriveCompletedYears(completedDates),
		tags: parseList(form.tags),
		metadata: assembleMetadata(),
	};

	// Optional fields: include the key only when populated (Firestore rejects
	// explicit `undefined`).
	const creator = parseCreator(form.creator);
	if (creator !== undefined) item.creator = creator;
	// Persist a manual sort key when given, else fall back to the derived one.
	const creatorSort =
		form.creator_sort.trim() || deriveCreatorSort(creator, form.type);
	if (creatorSort) item.creator_sort = creatorSort;
	if (form.cover.trim()) item.cover = form.cover.trim();
	if (form.thumbnail.trim()) item.thumbnail = form.thumbnail.trim();
	if (form.backdrop.trim()) item.backdrop = form.backdrop.trim();
	if (form.release_date.trim()) item.release_date = form.release_date.trim();
	if (form.description.trim()) item.description = form.description.trim();
	const length = num(form.length);
	if (length !== undefined) {
		item.length = length;
		item.length_unit = form.length_unit;
	}
	const communityRating = num(form.community_rating);
	if (communityRating !== undefined) item.community_rating = communityRating;
	const myRating = num(form.my_rating);
	if (myRating !== undefined) item.my_rating = myRating;
	if (form.recommended_by.trim())
		item.recommended_by = form.recommended_by.trim();
	if (form.notes.trim()) item.notes = form.notes.trim();

	return item;
}

function onSubmit() {
	if (!form.title.trim()) {
		error.value = 'Title is required.';
		return;
	}
	error.value = '';
	emit('submit', assemble());
}
</script>
