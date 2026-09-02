<template>
	<section class="sync-page">
		<h1>Sync health</h1>
		<p class="sync-page__intro">
			The scheduled jobs that refresh this library:
			<a href="https://www.goodreads.com">Goodreads</a> books daily at 12:17
			UTC, and movie, show, and game metadata at 12:47.
		</p>

		<p v-if="pending">Loading…</p>
		<p v-else-if="error">Failed to load sync health: {{ error.message }}</p>

		<template v-else>
			<article v-for="sync in health.syncs" :key="sync.name" class="sync">
				<h2 class="sync__heading">
					<span class="sync__dot" :class="`sync__dot--${sync.status}`" />
					{{ label(sync.name) }}
					<span class="sync__status">{{ statusText(sync) }}</span>
				</h2>

				<p v-if="sync.reason" class="sync__reason">{{ sync.reason }}</p>

				<p v-if="!sync.latest" class="sync__empty">
					No runs recorded yet. The first scheduled run will populate this.
				</p>

				<template v-else>
					<p class="sync__meta">
						Last wrote something:
						<template v-if="sync.lastWrite">
							{{ relative(sync.lastWrite.at) }} ({{ sync.lastWrite.written }}
							{{ sync.lastWrite.written === 1 ? 'item' : 'items' }})
						</template>
						<template v-else>
							not in the last {{ runs(sync).length }} recorded runs
						</template>
					</p>

					<table class="sync__runs">
						<caption class="sync__caption">
							Recent runs.
							<strong>Considered</strong>
							is every item the run looked at — a number that drops or sticks is
							the sign a sync has quietly stopped covering the whole library.
						</caption>
						<thead>
							<tr>
								<th scope="col">When</th>
								<th scope="col">Result</th>
								<th scope="col" class="num">Considered</th>
								<th scope="col" class="num">Written</th>
								<th scope="col" class="num">Skipped</th>
								<th scope="col" class="num">Errors</th>
							</tr>
						</thead>
						<tbody>
							<template v-for="run in runs(sync)" :key="run.at">
								<tr :class="{ 'is-failed': !run.ok }">
									<td>{{ absolute(run.at) }}</td>
									<td>{{ run.ok ? 'Completed' : 'Failed' }}</td>
									<td class="num">{{ run.attempted }}</td>
									<td class="num">
										{{ run.written }}
										<span v-if="run.substantive !== undefined" class="subtle">
											({{ run.substantive }} substantive)
										</span>
									</td>
									<td class="num">{{ run.skipped }}</td>
									<td class="num">{{ run.errors }}</td>
								</tr>
								<tr v-if="run.failure || run.errorSamples.length > 0">
									<td colspan="6" class="sync__detail">
										<p v-if="run.failure" class="sync__failure">
											{{ run.failure }}
										</p>
										<ul v-if="run.errorSamples.length > 0">
											<li v-for="sample in run.errorSamples" :key="sample">
												{{ sample }}
											</li>
										</ul>
									</td>
								</tr>
							</template>
						</tbody>
					</table>
				</template>
			</article>
		</template>
	</section>
</template>

<script setup lang="ts">
import {
	syncHealth,
	SYNC_LABELS,
	type SyncName,
	type SyncRunsDoc,
	type SyncStatusDetail,
} from '~~/shared/utils/syncHealth';

/**
 * Detail behind the footer's sync indicator (#126). Deliberately not
 * access-gated, only the link to it is: the underlying `meta/syncRuns` document
 * is public-read in `firestore.rules` like every other aggregate, so gating the
 * page would be cosmetic rather than protective.
 */
useHead({ title: 'Sync health' });

const { getSyncRuns } = useItems();

// `lazy` with no `await`, matching the other data-backed pages: awaiting here
// makes the page an async component, and the resulting Suspense boundary renders
// differently on the server than on hydration — a mismatch this page hit and the
// others don't.
const { data, status, error } = useAsyncData('sync-page', () => getSyncRuns(), {
	server: false,
	lazy: true,
	default: (): SyncRunsDoc | null => null,
});

/**
 * `idle` counts as pending. The fetch is client-only, so on the server the
 * status is `idle` and on hydration it is already `pending` — treating only the
 * latter as loading made the two sides pick different branches, and because the
 * `v-else` here is a top-level `<template>` fragment that surfaced as a
 * hydration node mismatch (a fragment anchor where the client wanted a `<p>`).
 */
const pending = computed(
	() => status.value === 'idle' || status.value === 'pending',
);

const health = computed(() => syncHealth(data.value));

function label(name: SyncName): string {
	return SYNC_LABELS[name];
}

function runs(sync: SyncStatusDetail) {
	return data.value?.[sync.name] ?? [];
}

function statusText(sync: SyncStatusDetail): string {
	if (sync.status === 'unknown') return 'never run';
	if (sync.status === 'error') return 'needs attention';
	return `ran ${relative(sync.latest!.at)}`;
}

/** "3 hours ago" — enough precision for a daily job. */
function relative(at: string): string {
	const hours = (Date.now() - new Date(at).getTime()) / 3_600_000;
	if (hours < 1) return 'less than an hour ago';
	if (hours < 24) {
		const rounded = Math.round(hours);
		return `${rounded} ${rounded === 1 ? 'hour' : 'hours'} ago`;
	}
	const days = Math.round(hours / 24);
	return `${days} ${days === 1 ? 'day' : 'days'} ago`;
}

function absolute(at: string): string {
	return new Date(at).toLocaleString(undefined, {
		dateStyle: 'medium',
		timeStyle: 'short',
	});
}
</script>

<style scoped>
.sync-page__intro {
	max-inline-size: 60ch;
}

.sync {
	border-block-start: 1px solid var(--color-border);
	margin-block-start: 2rem;
	padding-block-start: 1rem;
}

.sync__heading {
	align-items: center;
	display: flex;
	gap: 0.5em;
}

.sync__dot {
	block-size: 0.6em;
	border-radius: 50%;
	flex: none;
	inline-size: 0.6em;
}

.sync__dot--ok {
	background: light-dark(green, lightgreen);
}

.sync__dot--error {
	background: light-dark(firebrick, lightcoral);
}

.sync__dot--unknown {
	background: var(--color-currentcolor-20);
}

.sync__status {
	font-size: 0.7em;
	font-weight: 400;
	opacity: 0.8;
}

.sync__reason {
	font-weight: 700;
}

.sync__runs {
	border-collapse: collapse;
	inline-size: 100%;
	margin-block-start: 1rem;
}

.sync__caption {
	margin-block-end: 0.5rem;
	max-inline-size: 70ch;
	opacity: 0.8;
	text-align: left;
}

.sync__runs th,
.sync__runs td {
	border-block-end: 1px solid var(--color-border);
	padding: 0.35em 0.5em;
	text-align: left;
}

.sync__runs .num {
	text-align: right;
}

.sync__runs .is-failed {
	color: light-dark(firebrick, lightcoral);
}

.sync__detail {
	font-size: 0.85em;
	opacity: 0.9;

	ul {
		margin: 0;
		padding-inline-start: 1.2em;
	}
}

.sync__failure {
	font-weight: 700;
	margin: 0;
}

.subtle {
	opacity: 0.7;
}
</style>
