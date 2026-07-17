/**
 * Season rollup for the Trakt import (issue #20). Trakt records per-episode
 * watches; the logbook tracks whole seasons — so a season's episode history has
 * to be rolled up into one verdict: was this season *finished*?
 *
 * Three tiers:
 *
 * - `complete`    — ≥90% of episodes including the finale, watched within about
 *                   a year: a normal binge or weekly watch. The 90% threshold
 *                   tolerates a missing scrobble or two; strict sequentiality is
 *                   deliberately not required.
 * - `review`      — plausibly finished but not confidently: 60–90% coverage
 *                   with the finale watched (scrobble gaps), or full coverage
 *                   scattered over more than a year (background TV watched at
 *                   random — was it really "completed"?). Surfaced to the owner
 *                   mid-import to confirm or decline, defaulting to yes.
 * - `in_progress` — under 60% coverage, or the finale unwatched.
 *
 * v1 infers at most ONE completion per season, never a rewatch: the export
 * carries only a play count and a single `last_watched_at` per episode, so
 * rewatch reconstruction is impossible without the noisy scrobble files.
 */

/** One episode's watch state from the export (its latest watch only). */
export interface EpisodeWatch {
	/** Episode number within the season. */
	number: number;
	/** ISO datetime of the last watch Trakt recorded for this episode. */
	watchedAt: string;
}

export type RollupTier = 'complete' | 'review' | 'in_progress';

export interface SeasonRollup {
	tier: RollupTier;
	/** Distinct episodes watched. */
	watchedCount: number;
	/** The season's episode count per TMDB; 0 when unknown. */
	episodeCount: number;
	/** Fraction of the season watched, capped at 1; 0 when the count is unknown. */
	coverage: number;
	/** Days between the first and last watch. */
	spanDays: number;
	/** First and last watch, as `YYYY-MM-DD` days, for the review prompt. */
	firstDay?: string;
	lastDay?: string;
	/**
	 * The day a completion would be dated: the finale's watch day, or the last
	 * watch when the season's length is unknown. Absent for `in_progress`.
	 */
	completedDay?: string;
}

/** Coverage at or above this, with the finale and a tight span, auto-completes. */
const COMPLETE_COVERAGE = 0.9;

/** Coverage at or above this, with the finale, is at least worth reviewing. */
const REVIEW_COVERAGE = 0.6;

/**
 * A first→last watch span at or beyond this routes to review even at full
 * coverage: "seen every episode at random over years" is not confidently a
 * completion.
 */
const SPAN_LIMIT_DAYS = 365;

const MS_PER_DAY = 86_400_000;

function toDay(value: string): string | undefined {
	const day = value.slice(0, 10);
	return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : undefined;
}

/** Roll a season's episode watches up into a completion verdict. */
export function rollupSeason(
	watches: EpisodeWatch[],
	episodeCount: number,
): SeasonRollup {
	// Dedupe by episode number, keeping the latest watch of each.
	const byEpisode = new Map<number, string>();
	for (const watch of watches) {
		const existing = byEpisode.get(watch.number);
		if (!existing || watch.watchedAt > existing) {
			byEpisode.set(watch.number, watch.watchedAt);
		}
	}

	const watchedCount = byEpisode.size;
	const times = [...byEpisode.values()]
		.map((iso) => Date.parse(iso))
		.filter((t) => Number.isFinite(t));
	const first = Math.min(...times);
	const last = Math.max(...times);
	const spanDays =
		times.length > 1 ? Math.round((last - first) / MS_PER_DAY) : 0;

	const rollup: SeasonRollup = {
		tier: 'in_progress',
		watchedCount,
		episodeCount: Math.max(episodeCount, 0),
		coverage: episodeCount > 0 ? Math.min(watchedCount / episodeCount, 1) : 0,
		spanDays,
	};
	if (watchedCount === 0) return rollup;

	rollup.firstDay = toDay(new Date(first).toISOString());
	rollup.lastDay = toDay(new Date(last).toISOString());

	// Season length unknown (TMDB had no count): we can't judge coverage or find
	// a finale, so let the owner decide; a yes dates the completion by the last
	// watch, the only end we know of.
	if (episodeCount <= 0) {
		rollup.tier = 'review';
		rollup.completedDay = rollup.lastDay;
		return rollup;
	}

	// The finale is the anchor: a season whose last episode was never reached is
	// simply still in progress, whatever the coverage.
	const finaleWatch = byEpisode.get(episodeCount);
	if (!finaleWatch || rollup.coverage < REVIEW_COVERAGE) return rollup;

	rollup.completedDay = toDay(finaleWatch);
	rollup.tier =
		rollup.coverage >= COMPLETE_COVERAGE && spanDays < SPAN_LIMIT_DAYS
			? 'complete'
			: 'review';
	return rollup;
}
