import 'dotenv/config';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import JSZip from 'jszip';
import { parseGoodreads } from '../shared/import/goodreads';
import { parseInfiniteBacklog } from '../shared/import/infiniteBacklog';
import { parseLetterboxd } from '../shared/import/letterboxd';
import { resolveDirectId } from '../shared/import/resolve';
import { parseTrakt } from '../shared/import/trakt';
import type { ImportFileMap, ImportRecord } from '../shared/import/types';
import type { Item } from '../shared/types/item';
import {
	readAllItems,
	writeItems,
	type StoredItem,
} from './lib/firestore-admin';

/**
 * One-time backfill of `added_date` on every stored item (#95).
 *
 * The field was added after the library was imported, so nothing on disk carries
 * it. Two passes fill it, best source first:
 *
 * 1. **The service exports.** Every parser already reads a date-added into
 *    `ImportRecord.addedDate`; before #95 it was used only as a fallback
 *    *completion* date and then thrown away. Re-parsing the exports recovers the
 *    real dates — when a book actually hit the to-read shelf, when a film was
 *    added to Letterboxd.
 * 2. **The document's `createTime`.** Firestore stamps every document; the Admin
 *    SDK can read it. For an item added in the app or by the Goodreads sync
 *    that's its exact creation day, and for a bulk-imported item it's the day of
 *    the import — genuinely when it entered the library, just coarser.
 *
 * Between them no item is left undated, so there's no "stamp the rest with
 * today" pass. Trakt's watched history is the one real gap: its entries carry no
 * added-date field, so completed seasons land on the import day from pass 2.
 *
 * This writes `added_date` and nothing else — it does not re-run the import
 * pipeline, so completion dates, ratings, and statuses are untouched. Safe to
 * re-run: earliest date wins, so a second run can only move a date backwards,
 * and pass 2 skips anything pass 1 already dated.
 *
 * Run it before any operation that deletes and recreates documents — `createTime`
 * resets on recreate.
 *
 * Run:      npm run backfill:added-date -- --exports=~/Downloads/Logbook/logs/2026-07-30
 * Preview:  npm run backfill:added-date -- --exports=<dir> --dry-run
 *
 * With no `--exports`, pass 1 is skipped and every undated item takes its
 * `createTime` day. Requires FIREBASE_SERVICE_ACCOUNT.
 */

/** The four service parsers. Each finds its own files, so one map feeds them all. */
const PARSERS = [
	parseGoodreads,
	parseLetterboxd,
	parseTrakt,
	parseInfiniteBacklog,
];

/** `--flag=value` from argv, or undefined. */
function flag(name: string): string | undefined {
	const prefix = `--${name}=`;
	return process.argv
		.find((arg) => arg.startsWith(prefix))
		?.slice(prefix.length);
}

/**
 * The single top-level folder every archive entry sits under (`""` when they're
 * already at the root, as Letterboxd's export is). Mirrors `commonRoot` in
 * `app/utils/import.ts`, which does this for browser uploads.
 */
function commonRoot(names: string[]): string {
	const first = names[0];
	if (!first?.includes('/')) return '';
	const root = `${first.split('/')[0]}/`;
	return names.every((name) => name.startsWith(root)) ? root : '';
}

/**
 * Every file under one export root, keyed by its path relative to that root —
 * the Node counterpart of `collectFiles` in `app/utils/import.ts`, and keyed the
 * same way for the same reason: Letterboxd's export carries `deleted/diary.csv`
 * and `orphaned/diary.csv` beside the real `diary.csv`, and collapsing those to
 * a basename would let a usually-empty copy shadow the diary. Zips (Letterboxd,
 * Trakt) are expanded with their wrapping folder stripped.
 */
async function collectRoot(
	root: string,
	files: ImportFileMap,
	prefix = '',
): Promise<void> {
	for (const entry of await readdir(root, { withFileTypes: true })) {
		const path = join(root, entry.name);
		const key = `${prefix}${entry.name}`;
		if (entry.isDirectory()) {
			await collectRoot(path, files, `${key}/`);
		} else if (entry.name.toLowerCase().endsWith('.zip')) {
			const zip = await JSZip.loadAsync(await readFile(path));
			const entries = Object.values(zip.files).filter((e) => !e.dir);
			const zipRoot = commonRoot(entries.map((e) => e.name));
			for (const zipped of entries) {
				files.set(
					zipped.name.slice(zipRoot.length),
					await zipped.async('string'),
				);
			}
		} else {
			files.set(key, await readFile(path, 'utf8'));
		}
	}
}

/**
 * The parsers' `path → text` map for an export directory. Each immediate
 * subdirectory is treated as its own export root, so a snapshot laid out as one
 * folder per service (`letterboxd/watched.csv`) presents the same top-level
 * paths as a flat one — which is what the parsers look for, since they ignore
 * anything nested.
 */
async function collectFiles(dir: string): Promise<ImportFileMap> {
	const files: ImportFileMap = new Map();
	const entries = await readdir(dir, { withFileTypes: true });
	await collectRoot(dir, files);
	for (const entry of entries) {
		if (entry.isDirectory()) await collectRoot(join(dir, entry.name), files);
	}
	return files;
}

/** Lowercased, de-punctuated, whitespace-collapsed — for title matching. */
function normalizeTitle(title: string): string {
	return title
		.normalize('NFKD')
		.replace(/\p{M}/gu, '')
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, ' ')
		.trim();
}

/**
 * How far a stored movie's year may sit from the export's and still be the same
 * film. Letterboxd dates a film by its *premiere* year while TMDB's
 * `release_date` is the wide release, so a festival or late-December title is
 * routinely off by one ("The Cabin in the Woods" is 2011 on Letterboxd, 2012 on
 * TMDB). One year recovers those; two starts pulling in remakes for no real gain.
 */
const YEAR_SLACK = 1;

interface MovieEntry {
	id: string;
	year: number | undefined;
}

/**
 * Stored movies by normalized title, for the one record shape whose id can't be
 * computed: a Letterboxd film. Its export carries no TMDB id, so the import
 * resolved the id by searching TMDB — a network call this backfill has no reason
 * to repeat when the item it produced is already in hand.
 */
function movieIndex(stored: StoredItem[]): Map<string, MovieEntry[]> {
	const index = new Map<string, MovieEntry[]>();
	for (const { item } of stored) {
		if (item.type !== 'movie') continue;
		const title = normalizeTitle(item.title);
		const year = item.release_date
			? Number(item.release_date.slice(0, 4))
			: undefined;
		index.set(title, [...(index.get(title) ?? []), { id: item.id, year }]);
	}
	return index;
}

/**
 * The stored movie a Letterboxd row refers to, or undefined when the title is
 * unknown or names more than one candidate in range — a remake a year apart is
 * left undated rather than guessed at, since a wrong date is worse than a
 * coarse one (the item still gets its `createTime` day).
 */
function matchMovie(
	record: ImportRecord,
	movies: Map<string, MovieEntry[]>,
): string | undefined {
	const candidates = movies.get(normalizeTitle(record.title)) ?? [];
	const wanted = record.year ? Number(record.year) : undefined;
	const inRange =
		wanted === undefined
			? candidates
			: candidates.filter(
					(c) =>
						c.year !== undefined && Math.abs(c.year - wanted) <= YEAR_SLACK,
				);
	return inRange.length === 1 ? inRange[0]!.id : undefined;
}

/** The item id a record refers to, or undefined when it can't be pinned down. */
function idFor(
	record: ImportRecord,
	movies: Map<string, MovieEntry[]>,
): string | undefined {
	return resolveDirectId(record.resolve) ?? matchMovie(record, movies);
}

async function main(): Promise<void> {
	const dryRun = process.argv.includes('--dry-run');
	const exportsDir = flag('exports');

	const stored = await readAllItems();
	console.log(`${stored.length} items in Firestore.`);

	// --- Pass 1: the exports.
	const fromExports = new Map<string, string>();
	let unmatchedRecords = 0;
	if (exportsDir) {
		const files = await collectFiles(
			exportsDir.replace(/^~/, process.env.HOME ?? '~'),
		);
		console.log(`Read ${files.size} export files from ${exportsDir}.`);

		const movies = movieIndex(stored);
		const known = new Set(stored.map(({ item }) => item.id));
		for (const parse of PARSERS) {
			for (const record of parse(files).records) {
				if (!record.addedDate) continue;
				const id = idFor(record, movies);
				if (!id || !known.has(id)) {
					unmatchedRecords++;
					continue;
				}
				// Earliest wins, matching `applyContribution`: two sources for one
				// title settle on whichever added it first.
				const current = fromExports.get(id);
				if (!current || record.addedDate < current) {
					fromExports.set(id, record.addedDate);
				}
			}
		}
		console.log(
			`Dated ${fromExports.size} items from exports; ` +
				`${unmatchedRecords} records matched no stored item.`,
		);
	} else {
		console.log('No --exports given: using createTime for every item.');
	}

	// --- Pass 2: createTime for whatever is left, then write.
	const toWrite: Item[] = [];
	let fromCreateTime = 0;
	let alreadyDated = 0;
	const histogram = new Map<string, number>();
	for (const { item, createdDay } of stored) {
		const added = fromExports.get(item.id) ?? item.added_date ?? createdDay;
		if (!fromExports.has(item.id)) fromCreateTime++;
		if (item.added_date) alreadyDated++;
		histogram.set(added, (histogram.get(added) ?? 0) + 1);
		// Earliest wins, so a re-run can only move a date backwards.
		if (item.added_date && item.added_date <= added) continue;
		toWrite.push({ ...item, added_date: added });
	}

	console.log(
		`\n${toWrite.length} items to update ` +
			`(${fromExports.size} from exports, ${fromCreateTime} from createTime; ` +
			`${alreadyDated} already had a date).`,
	);
	console.log('\nResulting added_date histogram:');
	for (const [day, count] of [...histogram].sort()) {
		console.log(`  ${day}  ${count}`);
	}

	if (dryRun) {
		console.log('\n--dry-run: no writes.');
		return;
	}
	await writeItems(toWrite);
	console.log(`\nWrote ${toWrite.length} items.`);
}

main().catch((error: unknown) => {
	console.error('added_date backfill failed:', error);
	process.exit(1);
});
