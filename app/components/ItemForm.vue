<script setup lang="ts">
import type {
  Item,
  ItemMetadata,
  ItemStatus,
  LengthUnit,
  MediaType,
  Provider,
} from '~~/shared/types/item';
import { deriveCompletedYears } from '~~/shared/utils/completedYears';
import { makeManualId } from '~~/shared/utils/itemId';

const props = defineProps<{
  mode: 'create' | 'edit';
  initial?: Item;
}>();

const emit = defineEmits<{ submit: [item: Item] }>();

const MEDIA_TYPES: MediaType[] = ['book', 'movie', 'show', 'game'];
const STATUSES: ItemStatus[] = ['backlog', 'in_progress', 'inactive'];
const LENGTH_UNITS: LengthUnit[] = ['pages', 'min', 'episodes', 'hours'];
const PROVIDERS: Provider[] = [
  'manual',
  'tmdb',
  'igdb',
  'goodreads',
  'google-books',
  'open-library',
];

// Form state mirrors the schema but holds inputs as strings (numbers parsed on
// submit), so empty inputs are easy to detect and omit.
interface FormState {
  type: MediaType;
  title: string;
  creator: string;
  cover: string;
  thumbnail: string;
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
  show_tmdb_id: string;
  season_number: string;
  episode_count: string;
  episode_runtime: string;
  platform: string;
}

function defaultUnit(type: MediaType): LengthUnit {
  if (type === 'book') return 'pages';
  if (type === 'game') return 'hours';
  return 'min';
}

function initialForm(): FormState {
  const i = props.initial;
  const type = i?.type ?? 'movie';
  const m = (i?.metadata ?? {}) as Record<string, unknown>;
  const numStr = (v: unknown) => (typeof v === 'number' ? String(v) : '');
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  return {
    type,
    title: i?.title ?? '',
    creator: Array.isArray(i?.creator)
      ? i.creator.join(', ')
      : (i?.creator ?? ''),
    cover: i?.cover ?? '',
    thumbnail: i?.thumbnail ?? '',
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
    show_tmdb_id: numStr(m.show_tmdb_id),
    season_number: numStr(m.season_number),
    episode_count: numStr(m.episode_count),
    episode_runtime: numStr(m.episode_runtime),
    platform: str(m.platform),
  };
}

const form = reactive<FormState>(initialForm());
const error = ref('');

// Reset the length unit to the type's default when the type changes.
watch(
  () => form.type,
  (type) => {
    form.length_unit = defaultUnit(type);
  },
);

function addDate() {
  form.completed_dates.push('');
}
function removeDate(index: number) {
  form.completed_dates.splice(index, 1);
}

function num(value: string): number | undefined {
  const trimmed = value.trim();
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

function assembleMetadata(): ItemMetadata {
  switch (form.type) {
    case 'book': {
      const meta: Record<string, string | number> = {};
      if (form.series.trim()) meta.series = form.series.trim();
      const seriesNumber = num(form.series_number);
      if (seriesNumber !== undefined) meta.series_number = seriesNumber;
      if (form.isbn.trim()) meta.isbn = form.isbn.trim();
      return meta;
    }
    case 'show':
      return {
        show_tmdb_id: num(form.show_tmdb_id) ?? 0,
        season_number: num(form.season_number) ?? 0,
        episode_count: num(form.episode_count) ?? 0,
        episode_runtime: num(form.episode_runtime) ?? 0,
      };
    case 'game': {
      const meta: Record<string, string> = {};
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
    id:
      props.mode === 'edit' && props.initial
        ? props.initial.id
        : makeManualId(form.type),
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
  if (form.cover.trim()) item.cover = form.cover.trim();
  if (form.thumbnail.trim()) item.thumbnail = form.thumbnail.trim();
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
        step="0.1"
      />
    </label>

    <label>
      My rating <small>(0–10)</small>
      <input
        v-model="form.my_rating"
        type="number"
        min="0"
        max="10"
        step="0.1"
      />
    </label>

    <label>
      Provider
      <select v-model="form.provider">
        <option v-for="p in PROVIDERS" :key="p" :value="p">{{ p }}</option>
      </select>
    </label>

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
        <input v-model="form.series_number" type="number" min="0" />
      </label>
      <label>
        ISBN
        <input v-model="form.isbn" type="text" />
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
        <input v-model="form.season_number" type="number" min="0" />
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
        Platform
        <input v-model="form.platform" type="text" />
      </label>
    </fieldset>

    <button type="submit">
      {{ mode === 'create' ? 'Add item' : 'Save changes' }}
    </button>
  </form>
</template>
