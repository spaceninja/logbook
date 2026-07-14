<template>
	<section>
		<h1>Import</h1>
		<p v-if="error" role="alert">{{ error }}</p>

		<!-- Choose a service and upload its export. -->
		<template v-if="step === 'select'">
			<label>
				Service
				<select v-model="serviceSource">
					<option
						v-for="s in IMPORT_SERVICES"
						:key="s.source"
						:value="s.source"
					>
						{{ s.label }}
					</option>
				</select>
			</label>
			<label>
				Export files
				<input
					type="file"
					multiple
					accept=".zip,.csv,.json"
					@change="onFiles"
				/>
			</label>
			<p>
				<small>
					Upload the {{ activeService.label }} export — the whole
					<code>.zip</code>, or the individual files.
				</small>
			</p>
		</template>

		<!-- Review what will happen, then confirm. -->
		<template v-else-if="step === 'preview'">
			<h2>{{ activeService.label }}</h2>
			<ul>
				<li>
					<label>
						<input v-model="importHistory" type="checkbox" />
						History: {{ historyCount }} items
					</label>
				</li>
				<li>
					<label>
						<input v-model="importBacklog" type="checkbox" />
						Backlog: {{ backlogCount }} items
					</label>
				</li>
			</ul>
			<fieldset v-if="importHistory && undatedHistoryCount">
				<legend>
					Date for {{ undatedHistoryCount }} completed items with no completion
					date
				</legend>
				<label v-for="option in dateFallbackOptions" :key="option.value">
					<input v-model="dateFallback" type="radio" :value="option.value" />
					{{ option.label }}
				</label>
			</fieldset>
			<p v-if="isDev">
				<label>
					<input v-model="fastImport" type="checkbox" />
					Fast import ({{ FAST_IMPORT_LIMIT }} items only)
				</label>
			</p>
			<p v-if="skipped.length">
				{{ skipped.length }} rows skipped (no provider id).
			</p>
			<p v-if="unresolvedCount">
				{{ unresolvedCount }} items carry no provider id, and will be matched to
				TMDB by title and year.
			</p>
			<p>
				<button type="button" @click="reset">Cancel</button>
				<button type="button" :disabled="selectedCount === 0" @click="run">
					Import {{ importCount }} items
				</button>
			</p>
		</template>

		<!-- Running. -->
		<template v-else-if="step === 'running'">
			<template v-if="progress.phase === 'matching'">
				<h2>Matching to TMDB…</h2>
				<progress :value="progress.processed" :max="progress.total || 1" />
				<p>
					{{ progress.processed }} / {{ progress.total }} films matched by title
					and year.
				</p>
			</template>
			<template v-else-if="progress.phase === 'reading'">
				<h2>Checking your library…</h2>
				<progress />
				<p>Looking up {{ progress.total }} existing items.</p>
			</template>
			<template v-else-if="progress.phase === 'saving'">
				<h2>Saving…</h2>
				<progress />
				<p>Writing {{ progress.created + progress.updated }} changes.</p>
			</template>
			<template v-else>
				<h2>Importing…</h2>
				<progress :value="progress.processed" :max="progress.total || 1" />
				<p>
					{{ progress.processed }} / {{ progress.total }} —
					{{ progress.created }} new, {{ progress.updated }} updated,
					{{ progress.unchanged }} unchanged
				</p>
			</template>
		</template>

		<!-- Done. -->
		<template v-else-if="step === 'done' && summary">
			<h2>Import complete</h2>
			<p>
				{{ summary.created }} created, {{ summary.updated }} updated,
				{{ summary.unchanged }} unchanged<span v-if="summary.skipped.length"
					>, {{ summary.skipped.length }} skipped</span
				>.
			</p>
			<details v-if="summary.skipped.length">
				<summary>{{ summary.skipped.length }} skipped</summary>
				<ul>
					<li v-for="(item, i) in summary.skipped" :key="i">
						{{ item.title }} — {{ item.reason }}
					</li>
				</ul>
			</details>
			<details v-if="summary.unmatched.length">
				<summary>
					{{ summary.unmatched.length }} imported without cover or description
				</summary>
				<ul>
					<li v-for="(item, i) in summary.unmatched" :key="i">
						{{ item.title }}
					</li>
				</ul>
			</details>
			<p>
				<button type="button" @click="reset">Import more</button>
				<NuxtLink to="/">Done</NuxtLink>
			</p>
		</template>
	</section>
</template>

<script setup lang="ts">
import { resolveDirectId } from '~~/shared/import/resolve';
import type {
	DateFallback,
	ImportRecord,
	ImportSection,
} from '~~/shared/import/types';
import { collectFiles, IMPORT_SERVICES } from '~~/app/utils/import';
import { FAST_IMPORT_LIMIT } from '~~/app/composables/useImport';
import type {
	ImportProgress,
	ImportSummary,
} from '~~/app/composables/useImport';

definePageMeta({ middleware: 'owner' });

type Step = 'select' | 'preview' | 'running' | 'done';

const { runImport } = useImport();

const isDev = import.meta.dev;

const step = ref<Step>('select');
const error = ref('');
const serviceSource = ref(IMPORT_SERVICES[0]!.source);
const records = ref<ImportRecord[]>([]);
const skipped = ref<{ title: string; reason: string }[]>([]);
const importHistory = ref(true);
const importBacklog = ref(true);
const fastImport = ref(false);
const dateFallback = ref<DateFallback>('added');
const progress = ref<ImportProgress>({
	phase: 'reading',
	total: 0,
	processed: 0,
	created: 0,
	updated: 0,
	unchanged: 0,
});
const summary = ref<ImportSummary | null>(null);

const activeService = computed(
	() =>
		IMPORT_SERVICES.find((s) => s.source === serviceSource.value) ??
		IMPORT_SERVICES[0]!,
);

const historyCount = computed(
	() => records.value.filter((r) => r.section === 'history').length,
);
const backlogCount = computed(
	() => records.value.filter((r) => r.section === 'backlog').length,
);
const unresolvedCount = computed(
	() => records.value.filter((r) => resolveDirectId(r.resolve) === null).length,
);
const undatedHistoryRecords = computed(() =>
	records.value.filter(
		(r) => r.section === 'history' && r.completedDates.length === 0,
	),
);
const undatedHistoryCount = computed(() => undatedHistoryRecords.value.length);

// Only offer a date fallback the export can actually satisfy — Goodreads has no
// "last updated", so that option is hidden for it. Release date always shows: it
// comes from enrichment (unknown until the run) and covers the no-date-at-all case.
const dateFallbackOptions = computed(() => {
	const options: { value: DateFallback; label: string }[] = [];
	if (undatedHistoryRecords.value.some((r) => r.addedDate))
		options.push({ value: 'added', label: 'Date added' });
	if (undatedHistoryRecords.value.some((r) => r.updatedDate))
		options.push({ value: 'updated', label: 'Last updated' });
	options.push({ value: 'release', label: 'Release date' });
	return options;
});

// If a parsed export can't satisfy the selected fallback (e.g. Goodreads and the
// default were "last updated"), drop to the first offered option. Not immediate:
// at mount there are no records yet, and firing then would discard the default.
watch(dateFallbackOptions, (options) => {
	if (!options.some((o) => o.value === dateFallback.value)) {
		dateFallback.value = options[0]!.value;
	}
});
const selectedCount = computed(
	() =>
		(importHistory.value ? historyCount.value : 0) +
		(importBacklog.value ? backlogCount.value : 0),
);

// A fast run's true count isn't known until the existence prefetch tells us how
// many of these have already been imported, so the button promises an upper bound.
const importCount = computed(() =>
	fastImport.value ? `up to ${FAST_IMPORT_LIMIT}` : selectedCount.value,
);

function reset() {
	step.value = 'select';
	error.value = '';
	records.value = [];
	skipped.value = [];
	summary.value = null;
}

async function onFiles(event: Event) {
	error.value = '';
	const input = event.target as HTMLInputElement;
	if (!input.files || input.files.length === 0) return;
	try {
		const files = await collectFiles(input.files);
		const result = activeService.value.parse(files);
		if (result.records.length === 0) {
			error.value = `No importable rows found. Are these ${activeService.value.label} files?`;
			return;
		}
		records.value = result.records;
		skipped.value = result.skipped;
		// Which undated-completion date suits this export (Letterboxd prefers the
		// film's release date); the watcher below still vets it against what the
		// parsed rows can actually offer.
		dateFallback.value = activeService.value.defaultDateFallback ?? 'added';
		step.value = 'preview';
	} catch {
		error.value = 'Could not read those files.';
	} finally {
		input.value = ''; // allow re-selecting the same files
	}
}

async function run() {
	error.value = '';
	step.value = 'running';
	const sections: ImportSection[] = [];
	if (importHistory.value) sections.push('history');
	if (importBacklog.value) sections.push('backlog');
	try {
		summary.value = await runImport(
			records.value,
			sections,
			dateFallback.value,
			(p) => {
				progress.value = p;
			},
			isDev && fastImport.value ? FAST_IMPORT_LIMIT : undefined,
		);
		step.value = 'done';
	} catch (e) {
		error.value = (e as Error).message;
		step.value = 'preview';
	}
}
</script>
