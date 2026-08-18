import 'dotenv/config';
import { absorbTwin, findBookTwin } from '../shared/import/bookTwin';
import {
	mergeSyncedBook,
	newBookSkeleton,
	parseFeed,
	type RssBook,
	type SyncShelf,
} from '../shared/import/goodreadsRss';
import type { BookMetadata, Item } from '../shared/types/item';
import { makeBookId } from '../shared/utils/itemId';
import { coverWidth } from './lib/coverSize';
import {
	deleteItems,
	itemsEqual,
	readBooks,
	readItems,
	writeItems,
} from './lib/firestore-admin';
import { enrichBooksWithGoogleBooks } from './lib/googleBooks';
import { enrichBooksWithHardcover } from './lib/hardcover';

/**
 * Daily Goodreads sync (issue #17). Fetches the tracked shelf RSS feeds, maps
 * each book to an `Item`, and idempotently upserts them to Firestore via the
 * Admin SDK. Books flow in on their own — `to-read` → backlog, `read` →
 * complete, `currently-reading` → in progress — and re-runs refresh ratings,
 * status, and community rating without duplicating.
 *
 * Run:      npm run sync:goodreads
 * Preview:  npm run sync:goodreads -- --dry-run
 *
 * Requires GOODREADS_USER_ID, GOODREADS_RSS_KEY, and FIREBASE_SERVICE_ACCOUNT.
 */

const SHELVES: SyncShelf[] = ['to-read', 'currently-reading', 'read'];

/** Fetch and parse one shelf; throws on a bad response so nothing is written. */
async function fetchShelf(shelf: SyncShelf): Promise<RssBook[]> {
	const userId = requireEnv('GOODREADS_USER_ID');
	const key = requireEnv('GOODREADS_RSS_KEY');
	const url = `https://www.goodreads.com/review/list_rss/${userId}?key=${key}&shelf=${encodeURIComponent(shelf)}`;

	const response = await fetch(url, {
		headers: { 'user-agent': 'logbook-goodreads-sync' },
	});
	if (!response.ok) {
		throw new Error(`${shelf} feed: HTTP ${response.status}`);
	}
	const xml = await response.text();
	if (!xml.includes('<rss')) {
		throw new Error(
			`${shelf} feed: not RSS (Goodreads may have returned an error page)`,
		);
	}
	return parseFeed(xml, shelf);
}

function requireEnv(name: string): string {
	const value = process.env[name];
	if (!value) throw new Error(`${name} is not set`);
	return value;
}

/** How many covers to measure at once — small enough to stay polite to the CDN. */
const COVER_CONCURRENCY = 8;

/**
 * Measured widths for the feed covers `mergeSyncedBook` needs to judge (#69), keyed
 * by item id. Only covers the sync hasn't already evaluated are fetched: a book
 * records the URL it was measured against in `metadata.goodreads_cover`, so an
 * unchanged cover costs nothing. The first run measures the whole window; steady
 * state measures only books whose art actually changed.
 */
async function measureCovers(
	books: Map<string, RssBook>,
	existing: Map<string, Item>,
): Promise<Map<string, number>> {
	const pending = [...books].filter(([id, rss]) => {
		const prev = existing.get(id);
		if (!rss.coverLarge || !prev) return false; // new books take it unconditionally
		return (prev.metadata as BookMetadata).goodreads_cover !== rss.coverLarge;
	});

	const widths = new Map<string, number>();
	for (let i = 0; i < pending.length; i += COVER_CONCURRENCY) {
		const batch = pending.slice(i, i + COVER_CONCURRENCY);
		const measured = await Promise.all(
			batch.map(
				async ([id, rss]) => [id, await coverWidth(rss.coverLarge!)] as const,
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
 * App-created twins for the feed books that have no Goodreads document yet,
 * keyed by the id the sync is about to create (#105).
 *
 * A book added through the app's search is keyed by its Google Books volume id,
 * so shelving it on Goodreads afterwards would mint a *second* document and leave
 * the first — the one holding the owner's notes — orphaned and never refreshed
 * again. Rather than create alongside it, the sync absorbs it: the user-owned
 * fields move onto the new Goodreads document and the twin is deleted.
 *
 * Only runs when the feed actually holds a book we've never seen, so the steady
 * state (no new books) costs nothing. Candidates exclude anything already keyed by
 * Goodreads: two Goodreads documents for one book is a duplicate on the *shelf*,
 * which is the owner's to resolve there, not ours to merge away silently.
 */
async function findTwins(
	books: Map<string, RssBook>,
	existing: Map<string, Item>,
): Promise<Map<string, Item>> {
	const unseen = [...books].filter(([id]) => !existing.has(id));
	const twins = new Map<string, Item>();
	if (unseen.length === 0) return twins;

	const candidates = (await readBooks()).filter(
		(book) => !book.id.startsWith('book-goodreads-'),
	);
	if (candidates.length === 0) return twins;

	for (const [id, rss] of unseen) {
		const match = findBookTwin(candidates, newBookSkeleton(rss));
		if (match.kind === 'ambiguous') {
			console.log(
				`  ? ${rss.title}: ${match.candidates.length} possible twins ` +
					`(${match.candidates.map((c) => c.id).join(', ')}) — left alone`,
			);
			continue;
		}
		if (match.kind !== 'none') twins.set(id, match.twin);
	}
	return twins;
}

async function main(): Promise<void> {
	const dryRun = process.argv.includes('--dry-run');

	// All feeds first: if any fetch/parse fails the whole run aborts before a
	// single write, so partial/garbage state is never committed.
	const feeds = await Promise.all(SHELVES.map(fetchShelf));

	// Key by the Goodreads document id. The exclusive shelves don't overlap, so
	// no book appears twice.
	const books = new Map<string, RssBook>();
	for (const feed of feeds) {
		for (const book of feed) {
			books.set(makeBookId('goodreads', book.bookId), book);
		}
	}

	const existing = await readItems([...books.keys()]);

	// A book the app already holds under a Google Books id must be absorbed, not
	// duplicated. Found before the merge so its owner-typed fields ride along into
	// the new document. (#105)
	const twins = await findTwins(books, existing);

	// Goodreads' cover only beats a stored Google one when it's actually high-res,
	// which takes a real measurement — done here so `mergeSyncedBook` stays pure.
	const coverWidths = await measureCovers(books, existing);

	// Merge every book first, so the supplemental Hardcover enrichment below can
	// run before the change diff — enriching a book that was otherwise unchanged
	// (imported before it had a hardcover_id) turns it into a write.
	const merged = [...books].map(([id, rss]) => {
		const item = mergeSyncedBook(existing.get(id), rss, coverWidths.get(id));
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

	// Populate community tags for books lacking a hardcover_id. Rating stays
	// Goodreads (only an absent one is filled). Best-effort: a Hardcover failure
	// is logged, never fatal — the books simply retry on the next run.
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

	// Resolve a Google Books volume for books that have no `google_books_id` — the
	// handle "Refresh metadata" needs, and the only route to a day-level release
	// date, since the feed's `book_published` is year-only by design. Narrow on
	// purpose: id and date only, never fields the feed or Hardcover own. (#98)
	const googleBooks = await enrichBooksWithGoogleBooks(
		merged.map((m) => m.item),
	);
	if (googleBooks.matched > 0 || googleBooks.unmatched > 0) {
		console.log(
			`Google Books: matched ${googleBooks.matched} (${googleBooks.dated} gained a full date), ` +
				`unmatched ${googleBooks.unmatched}, errors ${googleBooks.errors}`,
		);
	}

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
		`Goodreads sync: ${books.size} books across ${SHELVES.length} shelves`,
	);
	const absorbed = [...twins.values()].map((twin) => twin.id);
	if (dryRun) {
		console.log('--dry-run: no writes.');
		for (const item of toWrite.slice(0, 5)) {
			console.log(
				`  • ${existing.has(item.id) ? 'update' : 'create'}  ${item.title} — ${item.status}, rating ${item.my_rating ?? '—'}, community ${item.community_rating ?? '—'}`,
			);
		}
	} else {
		// Write the absorbing document before dropping the twin, so an interruption
		// between the two leaves a harmless duplicate rather than losing the notes.
		await writeItems(toWrite);
		await deleteItems(absorbed);
	}

	console.log(
		`created ${created}, updated ${updated}, unchanged ${unchanged}` +
			(absorbed.length > 0 ? `, absorbed ${absorbed.length}` : ''),
	);
}

main().catch((error: unknown) => {
	console.error('Goodreads sync failed:', error);
	process.exit(1);
});
