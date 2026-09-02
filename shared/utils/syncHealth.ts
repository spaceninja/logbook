/**
 * Health of the scheduled sync jobs (issue #126), read from the `meta/syncRuns`
 * aggregate the sync scripts write after every run.
 *
 * The motivating failure is #103: the unpaged Goodreads feed meant only the
 * newest 100 of a 492-book shelf ever synced, and the job reported success every
 * morning for months. Nothing errored, so nothing alerted. A per-run check can't
 * catch that on its own — which is why each run records `attempted`, and the
 * detail page shows it over time. That bug would have been a column of `100`
 * against a shelf of 492, obvious the moment anyone looked.
 *
 * This module is the only place the health rule lives, so the footer indicator,
 * the detail page, and the tests can't disagree about what "unhealthy" means.
 */

/** The scheduled syncs this tracks. */
export const SYNC_NAMES = ['goodreads', 'metadata'] as const;

export type SyncName = (typeof SYNC_NAMES)[number];

/** One recorded run of one sync. */
export interface SyncRun {
	/** ISO 8601 UTC, when the run finished. */
	at: string;
	/** False when the run threw rather than completing. */
	ok: boolean;
	/** Items the run considered — the #103 detector. */
	attempted: number;
	/** Documents actually written. */
	written: number;
	/**
	 * Writes that were more than provider-rating drift. Only the metadata sync
	 * can tell the difference, so it's absent elsewhere.
	 */
	substantive?: number;
	/** Items deliberately passed over (e.g. no provider id). */
	skipped: number;
	/** Per-item lookup failures. Not the same as a failed run. */
	errors: number;
	/** Up to `ERROR_SAMPLE_LIMIT` of the per-item error strings. */
	errorSamples: string[];
	/** The thrown message. Present only when `ok` is false. */
	failure?: string;
}

/** The `meta/syncRuns` document: newest run first, per sync. */
export type SyncRunsDoc = Partial<Record<SyncName, SyncRun[]>>;

/** How many runs to keep per sync. */
export const RUN_HISTORY_LIMIT = 20;

/** How many per-item error strings one run records. */
export const ERROR_SAMPLE_LIMIT = 10;

/**
 * How long a sync may go unrecorded before it counts as stale. Both jobs run
 * daily, so 36 hours is one missed run plus enough margin that a late start or a
 * slow runner never trips it.
 */
export const STALE_AFTER_HOURS = 36;

export type SyncStatus = 'ok' | 'error' | 'unknown';

export interface SyncStatusDetail {
	name: SyncName;
	status: SyncStatus;
	/** The newest recorded run, absent when the sync has never recorded one. */
	latest?: SyncRun;
	/** Why the status is `error`, for display. Absent when healthy. */
	reason?: string;
	/** Hours since the newest run, or undefined when there is none. */
	ageHours?: number;
	/**
	 * The newest run that actually wrote something — the "is this job still
	 * doing anything" signal (#103). Informational only: a quiet week is not a
	 * fault, so this never drives `status`.
	 */
	lastWrite?: SyncRun;
}

export interface SyncHealth {
	status: SyncStatus;
	syncs: SyncStatusDetail[];
	/** How many tracked syncs are in `error`. */
	errorCount: number;
}

/** Prepend a run to a sync's history, keeping only the newest `limit`. */
export function appendRun(
	existing: SyncRun[] | undefined,
	run: SyncRun,
	limit: number = RUN_HISTORY_LIMIT,
): SyncRun[] {
	return [run, ...(existing ?? [])].slice(0, limit);
}

/** Whole hours between `at` and `now`, negative clamped to 0 for clock skew. */
function hoursSince(at: string, now: Date): number {
	const elapsed = now.getTime() - new Date(at).getTime();
	return Math.max(0, elapsed / 3_600_000);
}

function evaluate(
	name: SyncName,
	runs: SyncRun[] | undefined,
	now: Date,
): SyncStatusDetail {
	const latest = runs?.[0];
	// A sync with no history at all is a gap, not a pass. The tracked list is a
	// fixed constant rather than the document's own keys precisely so a job that
	// never recorded — or whose workflow was deleted — surfaces here instead of
	// silently not existing.
	if (!latest) return { name, status: 'unknown' };

	const ageHours = hoursSince(latest.at, now);
	const lastWrite = runs?.find((run) => run.written > 0);
	const detail: SyncStatusDetail = { name, status: 'ok', latest, ageHours };
	if (lastWrite) detail.lastWrite = lastWrite;

	if (!latest.ok) {
		return {
			...detail,
			status: 'error',
			reason: latest.failure ?? 'Run failed',
		};
	}
	if (latest.errors > 0) {
		const plural = latest.errors === 1 ? 'error' : 'errors';
		return {
			...detail,
			status: 'error',
			reason: `${latest.errors} ${plural} in the last run`,
		};
	}
	if (ageHours > STALE_AFTER_HOURS) {
		return {
			...detail,
			status: 'error',
			reason: `No run in ${Math.floor(ageHours)} hours`,
		};
	}
	return detail;
}

/** Rank for "worst wins" across syncs: a single failure colours the whole set. */
const SEVERITY: Record<SyncStatus, number> = { ok: 0, unknown: 1, error: 2 };

/**
 * Overall health plus the per-sync breakdown. `now` is injectable so tests can
 * pin the staleness window; callers pass the real clock.
 */
export function syncHealth(
	doc: SyncRunsDoc | null | undefined,
	now: Date = new Date(),
): SyncHealth {
	const syncs = SYNC_NAMES.map((name) => evaluate(name, doc?.[name], now));
	const status = syncs.reduce<SyncStatus>(
		(worst, sync) =>
			SEVERITY[sync.status] > SEVERITY[worst] ? sync.status : worst,
		'ok',
	);
	return {
		status,
		syncs,
		errorCount: syncs.filter((sync) => sync.status === 'error').length,
	};
}

/** Display label for a sync, for the footer link and the detail page. */
export const SYNC_LABELS: Record<SyncName, string> = {
	goodreads: 'Goodreads',
	metadata: 'Metadata',
};
