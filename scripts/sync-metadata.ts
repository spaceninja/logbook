import 'dotenv/config';
import { appendFileSync } from 'node:fs';
import { mergeSyncedItem } from '../shared/import/metadataSync';
import type { Item, MediaType, ShowMetadata } from '../shared/types/item';
import { itemsEqual, readActiveItems, writeItems } from './lib/firestore-admin';
import { igdbDraft } from './lib/igdb';
import { tmdbMovieDraft, tmdbSeasonDraft } from './lib/tmdb';

/**
 * Daily metadata sync for movies, shows, and games (issue #106). Re-fetches each
 * active item's provider draft and merges the refreshable fields back onto the
 * stored doc, so a backlog item's community rating, cover art, and — for an
 * airing season — episode count stay current without anyone pressing "Refresh
 * metadata" by hand.
 *
 * Run:      npm run sync:metadata
 * Preview:  npm run sync:metadata -- --dry-run
 * Subset:   npm run sync:metadata -- --type=game --limit=5
 *
 * Requires FIREBASE_SERVICE_ACCOUNT, NUXT_TMDB_READ_TOKEN, NUXT_TWITCH_CLIENT_ID,
 * and NUXT_TWITCH_CLIENT_SECRET; NUXT_IGDB_TIME_TO_BEAT_STAT is optional.
 *
 * Books are deliberately out of scope: they're already refreshed by the Goodreads
 * RSS sync, under the different precedence rules in `providers/bookFields.ts`.
 * Which fields this sync may touch is `import/metadataSync.ts` — notably *not*
 * the same set the edit form's refresh button overwrites.
 */

/** The types this sync covers, and the default when `--type` isn't given. */
const SYNC_TYPES: MediaType[] = ['movie', 'show', 'game'];

/**
 * Abort before writing if more than this share of attempted lookups failed. A
 * bad token or a provider outage should fail the run loudly rather than
 * half-updating the library; a handful of individually-broken ids should not.
 */
const ERROR_ABORT_RATIO = 0.25;

/** How many changes `--dry-run` prints before truncating. */
const PREVIEW_LIMIT = 5;

interface Options {
	dryRun: boolean;
	types: MediaType[];
	limit?: number;
}

function parseArgs(argv: string[]): Options {
	const types: MediaType[] = [];
	let dryRun = false;
	let limit: number | undefined;

	for (const arg of argv) {
		if (arg === '--dry-run') {
			dryRun = true;
		} else if (arg.startsWith('--type=')) {
			const value = arg.slice('--type='.length) as MediaType;
			if (!SYNC_TYPES.includes(value)) {
				throw new Error(
					`--type must be one of ${SYNC_TYPES.join(', ')} (got "${value}")`,
				);
			}
			types.push(value);
		} else if (arg.startsWith('--limit=')) {
			limit = Number(arg.slice('--limit='.length));
			if (!Number.isInteger(limit) || limit <= 0) {
				throw new Error(`--limit must be a positive integer (got "${arg}")`);
			}
		} else {
			throw new Error(`Unknown argument: ${arg}`);
		}
	}

	return { dryRun, types: types.length > 0 ? types : SYNC_TYPES, limit };
}

/**
 * A fresh provider draft for an item, or null when it has no usable provider id.
 * The script-side twin of `draftParams` in `app/pages/item/[id]/edit.vue`, with
 * one deliberate difference: `letterboxd` items are skipped. Those are the films
 * TMDB doesn't carry, kept under a Letterboxd id so they still de-duplicate on
 * re-import (see `Provider` in `shared/types/item.ts`) — the id is not a TMDB id,
 * so there is nothing to look up.
 */
function draftFor(item: Item): Promise<Item> | null {
	if (!item.provider || item.provider === 'manual') return null;
	if (item.provider === 'letterboxd') return null;

	if (item.type === 'show') {
		const meta = item.metadata as ShowMetadata;
		if (!meta.show_tmdb_id || meta.season_number === undefined) return null;
		return tmdbSeasonDraft(String(meta.show_tmdb_id), meta.season_number);
	}

	// Native provider id is the item id with the `<type>-<provider>-` prefix removed.
	const prefix = `${item.type}-${item.provider}-`;
	if (!item.id.startsWith(prefix)) return null;
	const id = item.id.slice(prefix.length);

	if (item.type === 'movie') return tmdbMovieDraft(id);
	if (item.type === 'game') return igdbDraft(id);
	return null;
}

/** A copy with `community_rating` dropped, for the rating-only classification. */
function withoutRating(item: Item): Item {
	const copy = { ...item };
	delete copy.community_rating;
	return copy;
}

/** A key-stable JSON string, so object field order never fakes a difference. */
function stableJson(value: unknown): string {
	return JSON.stringify(value, (_key, val) =>
		val && typeof val === 'object' && !Array.isArray(val)
			? Object.fromEntries(
					Object.entries(val as Record<string, unknown>).sort(([a], [b]) =>
						a.localeCompare(b),
					),
				)
			: val,
	);
}

/** Which fields actually differ, for the dry-run preview line. */
function changedFields(prev: Item, merged: Item): string[] {
	const keys = new Set([...Object.keys(prev), ...Object.keys(merged)]) as Set<
		keyof Item
	>;
	return [...keys].filter(
		(key) => stableJson(prev[key]) !== stableJson(merged[key]),
	);
}

/**
 * Mirror the run's headline counts into the GitHub Actions run summary, so a
 * scheduled run's outcome is legible on the run page without opening the log.
 * A no-op locally, where the variable is unset.
 */
function writeStepSummary(lines: string[]): void {
	const path = process.env.GITHUB_STEP_SUMMARY;
	if (!path) return;
	appendFileSync(path, `${lines.join('\n')}\n`);
}

async function main() {
	const { dryRun, types, limit } = parseArgs(process.argv.slice(2));

	const active = await readActiveItems(types);
	// An empty result means the query or the credential broke, not that the
	// backlog emptied overnight — a silent no-op is the failure mode this sync
	// would otherwise hide (cf. the Goodreads feed's unpaged truncation, #103).
	if (active.length === 0) {
		throw new Error(
			`Metadata sync: no active ${types.join('/')} items found — refusing to treat that as a no-op`,
		);
	}
	const targets = limit ? active.slice(0, limit) : active;
	console.log(
		`Metadata sync: ${targets.length} active ${types.join('/')} items` +
			(limit ? ` (limited from ${active.length})` : ''),
	);

	const merged: { prev: Item; next: Item }[] = [];
	let skipped = 0;
	let errors = 0;
	for (const item of targets) {
		const draft = draftFor(item);
		if (!draft) {
			skipped++;
			console.log(`  skipped (no provider id): ${item.id}`);
			continue;
		}
		try {
			merged.push({ prev: item, next: mergeSyncedItem(item, await draft) });
		} catch (error) {
			// Per-item failure only: TMDB deletes and merges records, and IGDB merges
			// game ids, so one dead id is expected and must not blank the item or
			// stop the run. (The Goodreads sync aborts wholesale instead, because a
			// truncated feed is indistinguishable from books being removed.)
			errors++;
			console.log(`  error: ${item.id}: ${(error as Error).message}`);
		}
	}

	const attempted = targets.length - skipped;
	if (errors > attempted * ERROR_ABORT_RATIO) {
		throw new Error(
			`Metadata sync: ${errors}/${attempted} lookups failed — aborting without writing`,
		);
	}

	const toWrite: Item[] = [];
	const substantive: { prev: Item; next: Item }[] = [];
	let ratingOnly = 0;
	let unchanged = 0;
	for (const { prev, next } of merged) {
		if (itemsEqual(prev, next)) {
			unchanged++;
			continue;
		}
		toWrite.push(next);
		// TMDB's `vote_average` drifts continuously, so most runs update most items
		// by a hundredth of a point. Splitting those out keeps the update count
		// honest — without it a real change is invisible inside the churn.
		if (itemsEqual(withoutRating(prev), withoutRating(next))) ratingOnly++;
		else substantive.push({ prev, next });
	}

	if (dryRun) {
		console.log('--dry-run: no writes.');
		for (const { prev, next } of substantive.slice(0, PREVIEW_LIMIT)) {
			console.log(
				`  • update  ${next.title} — ${changedFields(prev, next).join(', ')}`,
			);
		}
		if (substantive.length > PREVIEW_LIMIT) {
			console.log(`  … and ${substantive.length - PREVIEW_LIMIT} more`);
		}
	} else {
		await writeItems(toWrite);
	}

	const summary =
		`updated ${toWrite.length} (${ratingOnly} rating-only), ` +
		`unchanged ${unchanged}, skipped ${skipped}, errors ${errors}`;
	console.log(summary);
	writeStepSummary([
		`### Metadata sync${dryRun ? ' (dry run)' : ''}`,
		'',
		`${targets.length} active ${types.join('/')} items — ${summary}`,
	]);
}

main().catch((error: unknown) => {
	console.error('Metadata sync failed:', error);
	process.exit(1);
});
