import {
	appendRun,
	ERROR_SAMPLE_LIMIT,
	type SyncName,
	type SyncRun,
	type SyncRunsDoc,
} from '../../shared/utils/syncHealth';
import { readSyncRuns, writeSyncRuns } from './firestore-admin';

/**
 * Records each sync run to the `meta/syncRuns` aggregate the app's footer and
 * `/sync` page read (issue #126). The health rule itself lives in
 * `shared/utils/syncHealth.ts`; this module only persists what happened.
 *
 * Every run is recorded, successful or not — a crash writes `ok: false` with its
 * message, so a failure is visible as a failure rather than only as eventual
 * staleness. Dry runs are deliberately never recorded: they write nothing, so
 * letting one reset the staleness clock would hide a job that had stopped doing
 * real work.
 */

/** The counts a script hands over; the rest of a `SyncRun` is derived here. */
export interface SyncRunInput {
	attempted: number;
	written: number;
	skipped: number;
	errors: number;
	/** Per-item error strings; trimmed to `ERROR_SAMPLE_LIMIT` on the way in. */
	errorSamples?: string[];
	/** Writes beyond provider-rating drift, where the sync can tell. */
	substantive?: number;
	/** The thrown message, when the run failed. */
	failure?: string;
}

/**
 * Build the stored record. Optional fields are *omitted* rather than set to
 * `undefined` — the Admin SDK rejects undefined values unless
 * `ignoreUndefinedProperties` is enabled, and it isn't.
 */
function toRun(input: SyncRunInput, at: Date): SyncRun {
	const run: SyncRun = {
		at: at.toISOString(),
		ok: input.failure === undefined,
		attempted: input.attempted,
		written: input.written,
		skipped: input.skipped,
		errors: input.errors,
		errorSamples: (input.errorSamples ?? []).slice(0, ERROR_SAMPLE_LIMIT),
	};
	if (input.substantive !== undefined) run.substantive = input.substantive;
	if (input.failure !== undefined) run.failure = input.failure;
	return run;
}

/**
 * Prepend this run to the sync's history and trim to the retention limit.
 *
 * Only this sync's key is written, so the two jobs can't clobber one another
 * even though they share a document — and in practice they run 30 minutes apart.
 */
export async function recordSyncRun(
	name: SyncName,
	input: SyncRunInput,
	now: Date = new Date(),
): Promise<void> {
	const doc: SyncRunsDoc = await readSyncRuns();
	const runs = appendRun(doc[name], toRun(input, now));
	await writeSyncRuns(name, runs);
}

/**
 * Record a run, swallowing any failure to do so.
 *
 * Used on the error path, where the sync has already failed: if Firestore is
 * itself what broke, a throw here would replace the real error with a less
 * useful one. Staleness covers the case where nothing gets recorded at all.
 */
export async function tryRecordSyncRun(
	name: SyncName,
	input: SyncRunInput,
): Promise<void> {
	try {
		await recordSyncRun(name, input);
	} catch (error) {
		console.error(`Could not record ${name} run:`, (error as Error).message);
	}
}
