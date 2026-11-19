import 'dotenv/config';
import { absorbTwin, findBookTwin } from '../shared/import/bookTwin';
import {
	inferReadDates,
	mergeSyncedBook,
	newBookSkeleton,
	readDayFor,
	SYNC_SHELVES,
	type SyncedBook,
	type SyncShelf,
} from '../shared/import/goodreadsSync';
import { parseWidget, widgetUrl } from '../shared/import/goodreadsWidget';
import type { BookMetadata, Item } from '../shared/types/item';
import { makeBookId } from '../shared/utils/itemId';
import { coverWidth } from './lib/coverSize';
import {
	deleteItems,
	itemsEqual,
	projectId,
	readBooks,
	readItems,
	writeItems,
} from './lib/firestore-admin';
import { enrichBooksWithGoogleBooks } from './lib/googleBooks';
import { enrichBooksWithHardcover } from './lib/hardcover';
import { tryRecordSyncRun, type SyncRunInput } from './lib/syncRuns';

/**
 * Daily Goodreads sync (issue #17). Reads the tracked shelves from Goodreads'
 * public shelf widget (RSS was retired in October 2026, #205), maps each book to
 * an `Item`, and idempotently upserts them to Firestore via the Admin SDK. Books
 * flow in on their own — `to-read` → backlog, `currently-reading` → in progress,
 * `read` → complete — and since the widget carries no dates, a book's completion
 * date is the day before the run that first sees it on `read`.
 *
 * Run:      npm run sync:goodreads
 * Preview:  npm run sync:goodreads -- --dry-run
 *
 * Requires GOODREADS_USER_ID and FIREBASE_SERVICE_ACCOUNT.
 */

/** Fetch and parse one shelf's widget; throws on a bad response. */
async function fetchShelf(shelf: SyncShelf): Promise<SyncedBook[]> {
	const userId = requireEnv('GOODREADS_USER_ID');
	// Unique per request — Goodreads caches the rendered widget per id.
	const widgetId = `${Date.now()}${SYNC_SHELVES.indexOf(shelf)}`;
	const response = await fetch(widgetUrl(userId, shelf, widgetId), {
		headers: { 'user-agent': 'logbook-goodreads-sync' },
	});
	if (!response.ok) {
		throw new Error(`${shelf} widget: HTTP ${response.status}`);
	}
	const { books, skipped } = parseWidget(await response.text(), shelf);
	for (const title of skipped) {
		console.log(`  ? ${title} (${shelf}): no cover, so no book id — skipped`);
	}
	return books;
}

function requireEnv(name: string): string {
	const value = process.env[name];
	if (!value) throw new Error(`${name} is not set`);
	return value;
}

/** How many covers to measure at once — small enough to stay polite to the CDN. */
const COVER_CONCURRENCY = 8;

/**
 * Measured widths for the shelf covers `mergeSyncedBook` needs to judge (#69),
 * keyed by item id. Only covers the sync hasn't already evaluated are fetched: a
 * book records the URL it was measured against in `metadata.goodreads_cover`, so
 * an unchanged cover costs nothing.
 */
async function measureCovers(
	books: Map<string, SyncedBook>,
	existing: Map<string, Item>,
): Promise<Map<string, number>> {
	const pending = [...books].filter(([id, book]) => {
		const prev = existing.get(id);
		if (!book.coverLarge || !prev) return false; // new books take it unconditionally
		return (prev.metadata as BookMetadata).goodreads_cover !== book.coverLarge;
	});

	const widths = new Map<string, number>();
	for (let i = 0; i < pending.length; i += COVER_CONCURRENCY) {
		const batch = pending.slice(i, i + COVER_CONCURRENCY);
		const measured = await Promise.all(
			batch.map(
				async ([id, book]) => [id, await coverWidth(book.coverLarge!)] as const,
			),
		);
		for (const [id, width] of measured) {
			if (width !== undefined) widths.set(id, width);
		}
	}
	if (pending.length > 0) {
		console.log(
			`Covers: measured ${pending.length}, resolved ${widths.size} widths`,
		);
	}
	return widths;
}

/**
 * App-created twins for the shelf books that have no Goodreads document yet,
 * keyed by the id the sync is about to create (#105).
 *
 * A book added through the app's search is keyed by its Google Books volume id,
 * so shelving it on Goodreads afterwards would mint a *second* document and leave
 * the first — the one holding the owner's notes — orphaned and never refreshed
 * again. Rather than create alongside it, the sync absorbs it: the user-owned
 * fields move onto the new Goodreads document and the twin is deleted.
 *
 * Only runs when a shelf actually holds a book we've never seen, so the steady
 * state (no new books) costs nothing. Candidates exclude anything already keyed by
 * Goodreads: two Goodreads documents for one book is a duplicate on the *shelf*,
 * which is the owner's to resolve there, not ours to merge away silently.
 */
async function findTwins(
	books: Map<string, SyncedBook>,
	existing: Map<string, Item>,
): Promise<Map<string, Item>> {
	const unseen = [...books].filter(([id]) => !existing.has(id));
	const twins = new Map<string, Item>();
	if (unseen.length === 0) return twins;

	const candidates = (await readBooks()).filter(
		(book) => !book.id.startsWith('book-goodreads-'),
	);
	if (candidates.length === 0) return twins;

	for (const [id, book] of unseen) {
		const match = findBookTwin(candidates, newBookSkeleton(book));
		if (match.kind === 'ambiguous') {
			console.log(
				`  ? ${book.title}: ${match.candidates.length} possible twins ` +
					`(${match.candidates.map((c) => c.id).join(', ')}) — left alone`,
			);
			continue;
		}
		if (match.kind !== 'none') twins.set(id, match.twin);
	}
	return twins;
}

/** Top-level fields (and `metadata.*` keys) that differ, for the dry-run report. */
function changedFields(prev: Item, next: Item): string[] {
	const differs = (a: unknown, b: unknown) =>
		JSON.stringify(a) !== JSON.stringify(b);
	const keys = new Set([...Object.keys(prev), ...Object.keys(next)]);
	const fields = [...keys].filter(
		(key) =>
			key !== 'metadata' &&
			differs(prev[key as keyof Item], next[key as keyof Item]),
	);
	const before = (prev.metadata ?? {}) as Record<string, unknown>;
	const after = (next.metadata ?? {}) as Record<string, unknown>;
	const metaKeys = new Set([...Object.keys(before), ...Object.keys(after)]);
	for (const key of metaKeys) {
		if (differs(before[key], after[key])) fields.push(`metadata.${key}`);
	}
	return fields;
}

const dryRun = process.argv.includes('--dry-run');

/**
 * What the run has managed so far, so the failure path can record real counts
 * rather than zeros (#126). `attempted` is the book count across shelves.
 */
const progress: SyncRunInput = {
	attempted: 0,
	written: 0,
	skipped: 0,
	errors: 0,
	errorSamples: [],
};

async function main(): Promise<void> {
	console.log(`Firebase project: ${projectId()}`);

	// All shelves first: if any fetch/parse fails the whole run aborts before a
	// single write, so partial/garbage state is never committed.
	const shelves = await Promise.all(SYNC_SHELVES.map(fetchShelf));
	console.log(
		`Shelves: ${SYNC_SHELVES.map((shelf, i) => `${shelf} ${shelves[i]!.length}`).join(', ')}`,
	);

	// Key by the Goodreads document id. The exclusive shelves don't overlap, so
	// no book appears twice.
	const books = new Map<string, SyncedBook>();
	for (const shelf of shelves) {
		for (const book of shelf) {
			books.set(makeBookId('goodreads', book.bookId), book);
		}
	}
	progress.attempted = books.size;

	const existing = await readItems([...books.keys()]);

	// A book the app already holds under a Google Books id must be absorbed, not
	// duplicated. Found before the merge so its owner-typed fields ride along into
	// the new document. (#105)
	const twins = await findTwins(books, existing);

	// Which `read` books are newly finished, judged against what the app already
	// holds — a twin included, so a book logged in the app first isn't dated twice.
	const stored = new Map([...twins, ...existing]);
	const readShelf = shelves[SYNC_SHELVES.indexOf('read')]!;
	const readDay = readDayFor(new Date());
	const completions = inferReadDates(readShelf, stored, readDay);
	for (const [id, day] of completions) {
		console.log(
			`  ✓ ${books.get(id)!.title}: ` +
				(day
					? `finished ${day}`
					: 'finished, undated (Goodreads has an older read date)'),
		);
	}

	// Goodreads' cover only beats a stored Google one when it's actually high-res,
	// which takes a real measurement — done here so `mergeSyncedBook` stays pure.
	const coverWidths = await measureCovers(books, existing);

	// Merge every book first, so the supplemental enrichment below can run before
	// the change diff — enriching a book that was otherwise unchanged turns it
	// into a write.
	const merged = [...books].map(([id, book]) => {
		const item = mergeSyncedBook(existing.get(id), book, {
			...(completions.has(id)
				? { completion: { day: completions.get(id) } }
				: {}),
			coverWidth: coverWidths.get(id),
		});
		const twin = twins.get(id);
		if (!twin) return { prev: existing.get(id), item };
		const absorbed = absorbTwin(item, twin);
		console.log(
			`Absorbed ${twin.id} into ${id} (${item.title})` +
				(absorbed.carried.length > 0
					? `: ${absorbed.carried.map((c) => c.field).join(', ')}`
					: ''),
		);
		return { prev: existing.get(id), item: absorbed.item };
	});

	// Populate community tags for books lacking a hardcover_id, and a community
	// rating where none is stored — the widget carries none, so for a new book
	// Hardcover is the only source. Best-effort: a Hardcover failure is logged,
	// never fatal — the books simply retry on the next run.
	const enrichment = await enrichBooksWithHardcover(
		merged.map((m) => m.item),
		// NUXT_-prefixed so one variable serves both this script and the app's
		// runtimeConfig; the bare name is still honoured for older environments.
		process.env.NUXT_HARDCOVER_TOKEN ?? process.env.HARDCOVER_TOKEN,
	);
	if (
		enrichment.enriched > 0 ||
		enrichment.errors > 0 ||
		enrichment.skipped > 0
	) {
		console.log(
			`Hardcover: enriched ${enrichment.enriched}, errors ${enrichment.errors}, skipped ${enrichment.skipped}` +
				(enrichment.skipped > 0 ? ' (NUXT_HARDCOVER_TOKEN not set)' : ''),
		);
	}

	// Resolve a Google Books volume for books that have no `google_books_id`: the
	// handle "Refresh metadata" needs, and — since the widget carries no
	// description, length, or release date — where a new book gets those. (#98)
	const googleBooks = await enrichBooksWithGoogleBooks(
		merged.map((m) => m.item),
	);
	if (googleBooks.matched > 0 || googleBooks.unmatched > 0) {
		console.log(
			`Google Books: matched ${googleBooks.matched} (${googleBooks.dated} gained a full date), ` +
				`unmatched ${googleBooks.unmatched}, errors ${googleBooks.errors}`,
		);
	}

	// Enrichment failures are the only per-item errors this sync counts; a bad
	// shelf aborts the run rather than failing item by item. Neither enricher
	// retains the individual messages, so `errorSamples` stays empty here — unlike
	// the metadata sync, which names the offending item (#126).
	progress.errors = enrichment.errors + googleBooks.errors;
	progress.skipped = enrichment.skipped;

	const toWrite: Item[] = [];
	let created = 0;
	let updated = 0;
	let unchanged = 0;
	for (const { prev, item } of merged) {
		if (!prev) {
			toWrite.push(item);
			created++;
		} else if (!itemsEqual(prev, item)) {
			toWrite.push(item);
			updated++;
		} else {
			unchanged++;
		}
	}

	console.log(
		`Goodreads sync: ${books.size} books across ${SYNC_SHELVES.length} shelves`,
	);
	const absorbed = [...twins.values()].map((twin) => twin.id);
	if (dryRun) {
		console.log('--dry-run: no writes.');
		for (const item of toWrite) {
			const prev = existing.get(item.id);
			const change =
				prev && prev.status !== item.status
					? `${prev.status} → ${item.status}`
					: item.status;
			console.log(
				`  • ${prev ? 'update' : 'create'}  ${item.title} — ${change}, ` +
					`dates ${item.completed_dates.join(', ') || '—'}, rating ${item.my_rating ?? '—'}` +
					(prev ? ` [${changedFields(prev, item).join(', ')}]` : ''),
			);
		}
	} else {
		// Write the absorbing document before dropping the twin, so an interruption
		// between the two leaves a harmless duplicate rather than losing the notes.
		await writeItems(toWrite);
		await deleteItems(absorbed);
	}

	progress.written = toWrite.length;
	progress.substantive = created;

	console.log(
		`created ${created}, updated ${updated}, unchanged ${unchanged}` +
			(absorbed.length > 0 ? `, absorbed ${absorbed.length}` : ''),
	);
}

// A dry run is never recorded: it writes nothing, so letting it reset the
// staleness clock would mask a job that had stopped doing real work. Recording
// is best-effort on both paths — a failed health write must not turn an
// otherwise-good sync into a failed job, and staleness catches a silent one
// within 36 hours. (#126)
main()
	.then(async () => {
		if (!dryRun) await tryRecordSyncRun('goodreads', progress);
	})
	.catch(async (error: unknown) => {
		console.error('Goodreads sync failed:', error);
		if (!dryRun) {
			await tryRecordSyncRun('goodreads', {
				...progress,
				failure: (error as Error).message,
			});
		}
		process.exit(1);
	});
