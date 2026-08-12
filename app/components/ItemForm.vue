<template>
	<form
		:aria-label="mode === 'create' ? 'Add item' : 'Edit item'"
		@submit.prevent="onSubmit"
	>
		<p v-if="error" role="alert" class="full-width">{{ error }}</p>

		<div class="narrow">
			<label for="type">Type</label>
			<select id="type" v-model="form.type">
				<option v-for="t in MEDIA_TYPES" :key="t" :value="t">{{ t }}</option>
			</select>
		</div>

		<div class="narrow">
			<label for="status">Status</label>
			<select id="status" v-model="form.status">
				<option v-for="s in STATUSES" :key="s" :value="s">{{ s }}</option>
			</select>
		</div>

		<div class="narrow">
			<label>
				<input v-model="form.is_purchased" type="checkbox" />
				Purchased
			</label>
		</div>

		<div class="narrow">
			<label>
				<input v-model="form.is_prioritized" type="checkbox" />
				Prioritized
			</label>
		</div>

		<div>
			<label for="title">Title</label>
			<input id="title" v-model="form.title" type="text" required />
		</div>

		<div>
			<label for="release_date">Release date</label>
			<input
				id="release_date"
				v-model="form.release_date"
				:type="releaseDateType"
				:pattern="releaseDateType === 'text' ? RELEASE_DATE_PATTERN : undefined"
				:placeholder="releaseDateType === 'text' ? 'YYYY-MM-DD' : undefined"
				:title="
					releaseDateType === 'text'
						? 'A year, year-month, or full date: 1984, 1984-07, or 1984-07-01'
						: undefined
				"
			/>
		</div>

		<div>
			<label for="creator">
				Creator <small>(comma-separated for multiple)</small>
			</label>
			<input id="creator" v-model="form.creator" type="text" />
		</div>

		<div>
			<label for="creator_sort">
				Creator sort key <small>(surname first; blank = auto)</small>
			</label>
			<input id="creator_sort" v-model="form.creator_sort" type="text" />
		</div>

		<div>
			<label for="cover">Cover URL</label>
			<input id="cover" v-model="form.cover" type="url" />
		</div>

		<div>
			<label for="thumbnail">Thumbnail URL</label>
			<input id="thumbnail" v-model="form.thumbnail" type="url" />
		</div>

		<div>
			<label for="backdrop">Backdrop URL</label>
			<input id="backdrop" v-model="form.backdrop" type="url" />
		</div>

		<div class="addon">
			<label for="length">Length</label>
			<input id="length" v-model="form.length" type="number" min="0" />
			<label for="length_unit" class="visually-hidden">Length unit</label>
			<select id="length_unit" v-model="form.length_unit">
				<option v-for="u in LENGTH_UNITS" :key="u" :value="u">{{ u }}</option>
			</select>
		</div>

		<div>
			<label for="community_rating">
				Community rating <small>(0–10)</small>
			</label>
			<input
				id="community_rating"
				v-model="form.community_rating"
				type="number"
				min="0"
				max="10"
				step="any"
			/>
		</div>

		<div>
			<label for="my_rating">My rating <small>(0–10)</small></label>
			<input
				id="my_rating"
				v-model="form.my_rating"
				type="number"
				min="0"
				max="10"
				step="any"
			/>
		</div>

		<div>
			<label for="recommended_by">Recommended by</label>
			<input id="recommended_by" v-model="form.recommended_by" type="text" />
		</div>

		<div>
			<label for="tags">Tags <small>(comma-separated)</small></label>
			<input id="tags" v-model="form.tags" type="text" />
		</div>

		<div>
			<label for="description">Description</label>
			<textarea id="description" v-model="form.description" />
		</div>

		<div>
			<label for="notes">Notes</label>
			<textarea id="notes" v-model="form.notes" />
		</div>

		<!-- Type-specific metadata -->
		<fieldset v-if="form.type === 'book'" class="full-width">
			<legend>Book details</legend>
			<div>
				<label for="series">Series Name</label>
				<input id="series" v-model="form.series" type="text" />
			</div>
			<div>
				<label for="series_number">Series number</label>
				<input
					id="series_number"
					v-model="form.series_number"
					type="number"
					min="0"
					step="any"
				/>
			</div>
			<div>
				<label for="isbn">ISBN</label>
				<input id="isbn" v-model="form.isbn" type="text" />
			</div>
		</fieldset>

		<fieldset v-else-if="form.type === 'movie'" class="full-width">
			<legend>Movie details</legend>
			<div>
				<label for="series">Series Name</label>
				<input id="series" v-model="form.series" type="text" />
			</div>
			<div>
				<label for="series_number">Series number</label>
				<input
					id="series_number"
					v-model="form.series_number"
					type="number"
					min="0"
					step="any"
				/>
			</div>
		</fieldset>

		<fieldset v-else-if="form.type === 'show'" class="full-width">
			<legend>Show details</legend>
			<div>
				<label for="show_tmdb_id">Show TMDB id</label>
				<input
					id="show_tmdb_id"
					v-model="form.show_tmdb_id"
					type="number"
					min="0"
				/>
			</div>
			<div>
				<label for="season_number">Season number</label>
				<input
					id="season_number"
					v-model="form.season_number"
					type="number"
					min="0"
					step="any"
				/>
			</div>
			<div>
				<label for="season_title">
					Season title <small>(if different from the show name)</small>
				</label>
				<input id="season_title" v-model="form.season_title" type="text" />
			</div>
			<div>
				<label for="episode_count">Episode count</label>
				<input
					id="episode_count"
					v-model="form.episode_count"
					type="number"
					min="0"
				/>
			</div>
			<div>
				<label for="episode_runtime">
					Episode runtime <small>(min)</small>
				</label>
				<input
					id="episode_runtime"
					v-model="form.episode_runtime"
					type="number"
					min="0"
				/>
			</div>
		</fieldset>

		<fieldset v-else-if="form.type === 'game'" class="full-width">
			<legend>Game details</legend>
			<div>
				<label for="series">Series Name</label>
				<input id="series" v-model="form.series" type="text" />
			</div>
			<div>
				<label for="series_number">Series number</label>
				<input
					id="series_number"
					v-model="form.series_number"
					type="number"
					min="0"
					step="any"
				/>
			</div>
			<div>
				<label for="platform">Platform</label>
				<input id="platform" v-model="form.platform" type="text" />
			</div>
		</fieldset>

		<fieldset class="full-width">
			<legend>Completed dates</legend>
			<div
				v-for="(date, index) in form.completed_dates"
				:key="index"
				class="addon"
			>
				<label :for="`completed-date-${index}`" class="visually-hidden">
					Date
				</label>
				<input
					:id="`completed-date-${index}`"
					v-model="form.completed_dates[index]"
					type="date"
				/>
				<button type="button" @click="removeDate(index)">Remove</button>
			</div>
			<div class="buttons">
				<button type="button" @click="addDate">Add date</button>
				<!-- One-click completion, mostly for cleaning up imported partial
						 watches: set the status and a sensible date together. -->
				<button type="button" @click="completedToday">Completed today</button>
				<button
					type="button"
					:disabled="releaseBusy"
					@click="completedOnRelease"
				>
					Completed on release date
				</button>
			</div>
		</fieldset>

		<div class="full-width">
			<button type="submit">
				{{ mode === 'create' ? 'Add item' : 'Save changes' }}
			</button>
		</div>
	</form>

	<!-- Data source is provenance, not an editable field: it's the id namespace
			(e.g. a book's id is book-goodreads-…) and the refresh key, so changing
			it only desyncs those. Shown read-only; it round-trips on submit. -->
	<div>
		<p>Data source: {{ form.provider }}</p>
	</div>
</template>

<script setup lang="ts">
import { coerceIsoDay } from '~~/shared/import/dates';
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
	/** Canonical Hardcover book id — carried (not user-editable) so a save keeps the tag-enrichment handle. */
	hardcover_id: string;
	show_tmdb_id: string;
	season_number: string;
	season_title: string;
	episode_count: string;
	episode_runtime: string;
	/** Finale air date — carried (not user-editable) for "completed on release date". */
	end_date: string;
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
		hardcover_id: str(m.hardcover_id),
		show_tmdb_id: numStr(m.show_tmdb_id),
		season_number: numStr(m.season_number),
		season_title: str(m.season_title),
		episode_count: numStr(m.episode_count),
		episode_runtime: numStr(m.episode_runtime),
		end_date: str(m.end_date),
		platform: str(m.platform),
	};
}

const form = reactive<FormState>(initialForm());
const error = ref('');

/**
 * What a release date may look like on save: `YYYY`, `YYYY-MM`, or `YYYY-MM-DD`.
 * A string, because it doubles as the text input's `pattern` attribute. (#97)
 */
const RELEASE_DATE_PATTERN = '\\d{4}(-\\d{2}(-\\d{2})?)?';
const RELEASE_DATE_RE = new RegExp(`^${RELEASE_DATE_PATTERN}$`);

/**
 * Which control the release-date field uses. `type="date"` renders a partial value
 * like "1984" as *blank*, which is how every year-only book looked empty in the
 * edit form and one stray interaction could erase its year. Books are the only
 * media type that store a partial date, so a value the native picker can't hold
 * falls back to a plain text input; movies, shows, games, and fully-dated books
 * keep the picker.
 *
 * Fixed when the field is populated rather than computed from the live value: a
 * computed would swap the control mid-keystroke — the moment a typed "1984-07-0"
 * became "1984-07-01" — which resets the caret and the input's own edit state.
 */
const releaseDateType = ref(releaseDateInputType(form.release_date));

function releaseDateInputType(value: string): 'date' | 'text' {
	return !value || /^\d{4}-\d{2}-\d{2}$/.test(value) ? 'date' : 'text';
}

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
	releaseDateType.value = releaseDateInputType(form.release_date);
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
	// Tags come from the provider (Google Books categories, now Hardcover genres);
	// a refresh pulls the latest, so overwrite when the fresh draft carries any.
	if (source.tags.length > 0) form.tags = source.tags.join(', ');
	form.isbn = str(m.isbn);
	form.google_books_id = str(m.google_books_id);
	if (m.hardcover_id) form.hardcover_id = str(m.hardcover_id);
	form.show_tmdb_id = numStr(m.show_tmdb_id);
	form.season_number = numStr(m.season_number);
	form.season_title = str(m.season_title);
	form.episode_count = numStr(m.episode_count);
	form.episode_runtime = numStr(m.episode_runtime);
	form.end_date = str(m.end_date);
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

/** One-click completion: add `day` (deduped) and mark the item complete. */
function completeOn(day: string) {
	if (!form.completed_dates.includes(day)) form.completed_dates.push(day);
	form.status = 'complete';
}

function completedToday() {
	completeOn(todayIso());
}

const releaseBusy = ref(false);

/**
 * Complete the item on the day it came out — the shortcut for cleaning up
 * imported items whose real completion date is long lost (issue #20). Sets an
 * error instead when no release date is on record.
 */
async function completedOnRelease() {
	error.value = '';
	releaseBusy.value = true;
	try {
		// Coerced to a whole day: book release dates are often year-only.
		const day = coerceIsoDay(await releaseDay());
		if (!day) {
			error.value = 'No release date on record for this item.';
			return;
		}
		completeOn(day);
	} finally {
		releaseBusy.value = false;
	}
}

/**
 * The day this item "came out". A season is only *over* on its finale's air
 * date, so shows prefer the metadata `end_date` — fetched fresh when the item
 * was enriched before that field existed — over `release_date` (the premiere,
 * which doubles as the last resort when TMDB can't say).
 */
async function releaseDay(): Promise<string | undefined> {
	if (form.type === 'show') {
		if (form.end_date.trim()) return form.end_date;
		const id = form.show_tmdb_id.trim();
		const season = form.season_number.trim();
		if (id && season) {
			try {
				const draft = await $fetch<Item>('/api/draft', {
					params: { type: 'show', id, season },
				});
				const endDate = (draft.metadata as ShowMetadata).end_date;
				if (endDate) {
					form.end_date = endDate; // keep it: a save persists the lookup
					return endDate;
				}
				if (draft.release_date) return draft.release_date;
			} catch {
				// TMDB unavailable or the season unlisted: use the premiere below.
			}
		}
	}
	return form.release_date.trim() || undefined;
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
			if (form.hardcover_id.trim())
				meta.hardcover_id = form.hardcover_id.trim();
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
			if (form.end_date.trim()) meta.end_date = form.end_date.trim();
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
	const releaseDate = form.release_date.trim();
	if (releaseDate && !RELEASE_DATE_RE.test(releaseDate)) {
		error.value = 'Release date must be YYYY, YYYY-MM, or YYYY-MM-DD.';
		return;
	}
	error.value = '';
	emit('submit', assemble());
}
</script>

<style scoped>
form {
	display: grid;
	gap: 1em;
	grid-template-columns: repeat(2, 1fr);

	@media screen and (width >= 768px) {
		grid-template-columns: repeat(4, 1fr);
	}
}

form > div {
	align-self: end;
	grid-column: span 2;
}

.narrow {
	grid-column: span 1;
}

.full-width {
	grid-column: span 2;

	@media screen and (width >= 768px) {
		grid-column: span 4;
	}
}

label,
legend {
	display: block;
	font-size: 0.75em;
	font-stretch: 125%;
	font-weight: 600;
	text-transform: uppercase;

	small {
		font-stretch: 100%;
		font-weight: normal;
		text-transform: none;
	}
}

label {
	align-items: center;
	display: flex;
	gap: 0.25em;
	margin-bottom: 0.25em;
}

input:not([type='checkbox']),
select,
textarea {
	font-size: 16px;
	padding: 0.15em 0.33em;
	width: 100%;
}

textarea {
	font-family: system-ui, sans-serif;
	height: calc(5lh + 0.3em);
}

.addon {
	column-gap: 0.25em;
	display: grid;
	grid-template-columns: 1fr max-content;

	label {
		grid-column: span 2;
	}
}

fieldset {
	display: grid;
	gap: 1em;
	grid-template-columns: 1fr 1fr;
	padding: 1em;
}

.buttons {
	display: flex;
	gap: 0.5em;
	grid-column: span 2;
}
</style>
