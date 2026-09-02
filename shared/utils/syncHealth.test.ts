import { describe, expect, it } from 'vitest';
import {
	appendRun,
	RUN_HISTORY_LIMIT,
	syncHealth,
	type SyncRun,
	type SyncRunsDoc,
} from './syncHealth';

const NOW = new Date('2026-09-03T18:00:00Z');

/** A clean, recent, successful run. */
function run(overrides: Partial<SyncRun> = {}): SyncRun {
	return {
		at: '2026-09-03T12:47:00Z',
		ok: true,
		attempted: 311,
		written: 12,
		skipped: 2,
		errors: 0,
		errorSamples: [],
		...overrides,
	};
}

/** A document where both tracked syncs are healthy. */
function healthyDoc(overrides: Partial<SyncRunsDoc> = {}): SyncRunsDoc {
	return { goodreads: [run()], metadata: [run()], ...overrides };
}

describe('syncHealth', () => {
	it('reports ok when both syncs ran recently and cleanly', () => {
		const health = syncHealth(healthyDoc(), NOW);
		expect(health.status).toBe('ok');
		expect(health.errorCount).toBe(0);
	});

	it('reports unknown when a sync has never recorded a run', () => {
		const health = syncHealth({ goodreads: [run()] }, NOW);
		expect(health.status).toBe('unknown');
		const metadata = health.syncs.find((s) => s.name === 'metadata');
		expect(metadata?.status).toBe('unknown');
		expect(metadata?.latest).toBeUndefined();
	});

	it('reports unknown for a missing document entirely', () => {
		expect(syncHealth(null, NOW).status).toBe('unknown');
		expect(syncHealth(undefined, NOW).status).toBe('unknown');
	});

	it('reports error when the newest run failed, using its message', () => {
		const doc = healthyDoc({
			metadata: [run({ ok: false, failure: 'TMDB HTTP 401' })],
		});
		const health = syncHealth(doc, NOW);
		expect(health.status).toBe('error');
		expect(health.syncs.find((s) => s.name === 'metadata')?.reason).toBe(
			'TMDB HTTP 401',
		);
	});

	it('reports error when the newest run had per-item errors', () => {
		const doc = healthyDoc({ metadata: [run({ errors: 1 })] });
		const health = syncHealth(doc, NOW);
		expect(health.status).toBe('error');
		expect(health.syncs.find((s) => s.name === 'metadata')?.reason).toBe(
			'1 error in the last run',
		);
	});

	it('pluralizes the per-item error reason', () => {
		const doc = healthyDoc({ metadata: [run({ errors: 3 })] });
		const health = syncHealth(doc, NOW);
		expect(health.syncs.find((s) => s.name === 'metadata')?.reason).toBe(
			'3 errors in the last run',
		);
	});

	it('treats a run just inside the staleness window as ok', () => {
		// 35 hours before NOW — one missed daily run is still within margin.
		const doc = healthyDoc({
			metadata: [run({ at: '2026-09-02T07:00:00Z' })],
		});
		expect(syncHealth(doc, NOW).status).toBe('ok');
	});

	it('treats a run past the staleness window as an error', () => {
		// 37 hours before NOW.
		const doc = healthyDoc({
			metadata: [run({ at: '2026-09-02T05:00:00Z' })],
		});
		const health = syncHealth(doc, NOW);
		expect(health.status).toBe('error');
		expect(health.syncs.find((s) => s.name === 'metadata')?.reason).toBe(
			'No run in 37 hours',
		);
	});

	it('counts every failing sync', () => {
		const doc: SyncRunsDoc = {
			goodreads: [run({ errors: 2 })],
			metadata: [run({ ok: false, failure: 'boom' })],
		};
		expect(syncHealth(doc, NOW).errorCount).toBe(2);
	});

	it('lets a single failure outrank a healthy sibling', () => {
		const doc = healthyDoc({ metadata: [run({ errors: 1 })] });
		expect(syncHealth(doc, NOW).status).toBe('error');
	});

	it('lets an error outrank an unknown', () => {
		const doc: SyncRunsDoc = { goodreads: [run({ errors: 1 })] };
		expect(syncHealth(doc, NOW).status).toBe('error');
	});

	it('surfaces the newest run that wrote something', () => {
		const doc = healthyDoc({
			metadata: [
				run({ at: '2026-09-03T12:47:00Z', written: 0 }),
				run({ at: '2026-09-01T12:47:00Z', written: 0 }),
				run({ at: '2026-08-20T12:47:00Z', written: 4 }),
			],
		});
		const metadata = syncHealth(doc, NOW).syncs.find(
			(s) => s.name === 'metadata',
		);
		expect(metadata?.lastWrite?.at).toBe('2026-08-20T12:47:00Z');
		// A long inert stretch is information, not a fault (#126).
		expect(metadata?.status).toBe('ok');
	});

	it('leaves lastWrite absent when no recorded run wrote anything', () => {
		const doc = healthyDoc({ metadata: [run({ written: 0 })] });
		const metadata = syncHealth(doc, NOW).syncs.find(
			(s) => s.name === 'metadata',
		);
		expect(metadata?.lastWrite).toBeUndefined();
	});

	it('clamps a future timestamp rather than reporting negative age', () => {
		const doc = healthyDoc({
			metadata: [run({ at: '2026-09-04T00:00:00Z' })],
		});
		const metadata = syncHealth(doc, NOW).syncs.find(
			(s) => s.name === 'metadata',
		);
		expect(metadata?.ageHours).toBe(0);
		expect(metadata?.status).toBe('ok');
	});
});

describe('appendRun', () => {
	it('puts the newest run first', () => {
		const older = run({ at: '2026-09-01T12:47:00Z' });
		const newer = run({ at: '2026-09-02T12:47:00Z' });
		expect(appendRun([older], newer).map((r) => r.at)).toEqual([
			'2026-09-02T12:47:00Z',
			'2026-09-01T12:47:00Z',
		]);
	});

	it('starts a history when none exists', () => {
		expect(appendRun(undefined, run())).toHaveLength(1);
	});

	it('trims to the retention limit', () => {
		const existing = Array.from({ length: RUN_HISTORY_LIMIT }, (_, i) =>
			run({ at: `2026-08-${String(i + 1).padStart(2, '0')}T12:47:00Z` }),
		);
		const trimmed = appendRun(existing, run({ at: '2026-09-03T12:47:00Z' }));
		expect(trimmed).toHaveLength(RUN_HISTORY_LIMIT);
		expect(trimmed[0]!.at).toBe('2026-09-03T12:47:00Z');
		// The oldest entry is the one dropped.
		expect(trimmed.at(-1)!.at).toBe('2026-08-19T12:47:00Z');
	});

	it('honours an explicit limit', () => {
		const existing = [run(), run(), run()];
		expect(appendRun(existing, run(), 2)).toHaveLength(2);
	});
});
