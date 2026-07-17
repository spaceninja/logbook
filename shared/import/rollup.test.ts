import { describe, expect, it } from 'vitest';
import type { EpisodeWatch } from './rollup';
import { rollupSeason } from './rollup';

/** `n` episodes watched on consecutive days from `startDay` (a binge). */
function binge(n: number, startDay = '2024-03-01'): EpisodeWatch[] {
	const start = Date.parse(`${startDay}T20:00:00.000Z`);
	return Array.from({ length: n }, (_, i) => ({
		number: i + 1,
		watchedAt: new Date(start + i * 86_400_000).toISOString(),
	}));
}

describe('rollupSeason — auto-complete', () => {
	it('completes a full binge, dated by the finale', () => {
		const rollup = rollupSeason(binge(10), 10);
		expect(rollup).toMatchObject({
			tier: 'complete',
			watchedCount: 10,
			episodeCount: 10,
			coverage: 1,
			completedDay: '2024-03-10',
		});
	});

	it('tolerates a missing scrobble or two (≥90% with the finale)', () => {
		// Episodes 3 and 7 missing from a 20-episode season: 90% with the finale.
		const watches = binge(20).filter((w) => w.number !== 3 && w.number !== 7);
		expect(rollupSeason(watches, 20).tier).toBe('complete');
	});

	it('completes a weekly watch spanning most of a year', () => {
		const start = Date.parse('2024-01-05T20:00:00.000Z');
		const weekly = Array.from({ length: 22 }, (_, i) => ({
			number: i + 1,
			watchedAt: new Date(start + i * 7 * 86_400_000).toISOString(),
		}));
		const rollup = rollupSeason(weekly, 22);
		expect(rollup.tier).toBe('complete');
		expect(rollup.spanDays).toBe(147);
	});
});

describe('rollupSeason — review', () => {
	it('routes 60–90% coverage with the finale to review', () => {
		// 15 of 20 episodes (75%), finale included.
		const watches = binge(20).filter((w) => w.number > 5);
		const rollup = rollupSeason(watches, 20);
		expect(rollup.tier).toBe('review');
		expect(rollup.completedDay).toBe('2024-03-20');
	});

	it('routes full coverage scattered over more than a year to review', () => {
		// Every episode, one per month for 12 months: span ≥ 365 days.
		const watches = Array.from({ length: 13 }, (_, i) => ({
			number: i + 1,
			watchedAt: new Date(Date.UTC(2022, i, 15)).toISOString(),
		}));
		const rollup = rollupSeason(watches, 13);
		expect(rollup.tier).toBe('review');
		expect(rollup.spanDays).toBeGreaterThanOrEqual(365);
	});

	it('routes an unknown season length to review, dated by the last watch', () => {
		const rollup = rollupSeason(binge(8), 0);
		expect(rollup).toMatchObject({
			tier: 'review',
			coverage: 0,
			episodeCount: 0,
			completedDay: '2024-03-08',
		});
	});
});

describe('rollupSeason — in progress', () => {
	it('keeps a season under 60% coverage in progress, even with the finale', () => {
		// Only the last 5 of 20 episodes (25%).
		const watches = binge(20).filter((w) => w.number > 15);
		const rollup = rollupSeason(watches, 20);
		expect(rollup.tier).toBe('in_progress');
		expect(rollup.completedDay).toBeUndefined();
	});

	it('keeps a season whose finale is unwatched in progress at any coverage', () => {
		// 19 of 20 — but the missing one is the finale.
		const watches = binge(19);
		expect(rollupSeason(watches, 20).tier).toBe('in_progress');
	});

	it('handles no watches at all', () => {
		const rollup = rollupSeason([], 10);
		expect(rollup).toMatchObject({
			tier: 'in_progress',
			watchedCount: 0,
			spanDays: 0,
		});
		expect(rollup.firstDay).toBeUndefined();
	});
});

describe('rollupSeason — episode dedupe', () => {
	it('counts a rewatched episode once, keeping the latest watch', () => {
		const watches = [
			...binge(6),
			{ number: 6, watchedAt: '2024-05-01T20:00:00.000Z' },
		];
		const rollup = rollupSeason(watches, 6);
		expect(rollup.watchedCount).toBe(6);
		expect(rollup.completedDay).toBe('2024-05-01');
	});

	it('caps coverage at 1 when Trakt numbers past the TMDB count', () => {
		expect(rollupSeason(binge(12), 10).coverage).toBe(1);
	});
});
