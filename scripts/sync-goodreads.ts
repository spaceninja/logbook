import 'dotenv/config';
import {
	mergeSyncedBook,
	parseFeed,
	type RssBook,
	type SyncShelf,
} from '../shared/import/goodreadsRss';
import type { Item } from '../shared/types/item';
import { makeBookId } from '../shared/utils/itemId';
import { itemsEqual, readItems, writeItems } from './lib/firestore-admin';
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

	// Merge every book first, so the supplemental Hardcover enrichment below can
	// run before the change diff — enriching a book that was otherwise unchanged
	// (imported before it had a hardcover_id) turns it into a write.
	const merged = [...books].map(([id, rss]) => ({
		prev: existing.get(id),
		item: mergeSyncedBook(existing.get(id), rss),
	}));

	// Populate community tags for books lacking a hardcover_id. Rating stays
	// Goodreads (only an absent one is filled). Best-effort: a Hardcover failure
	// is logged, never fatal — the books simply retry on the next run.
	const enrichment = await enrichBooksWithHardcover(
		merged.map((m) => m.item),
		process.env.HARDCOVER_TOKEN,
	);
	if (
		enrichment.enriched > 0 ||
		enrichment.errors > 0 ||
		enrichment.skipped > 0
	) {
		console.log(
			`Hardcover: enriched ${enrichment.enriched}, errors ${enrichment.errors}, skipped ${enrichment.skipped}` +
				(enrichment.skipped > 0 ? ' (HARDCOVER_TOKEN not set)' : ''),
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
	if (dryRun) {
		console.log('--dry-run: no writes.');
		for (const item of toWrite.slice(0, 5)) {
			console.log(
				`  • ${existing.has(item.id) ? 'update' : 'create'}  ${item.title} — ${item.status}, rating ${item.my_rating ?? '—'}, community ${item.community_rating ?? '—'}`,
			);
		}
	} else {
		await writeItems(toWrite);
	}

	console.log(`created ${created}, updated ${updated}, unchanged ${unchanged}`);
}

main().catch((error: unknown) => {
	console.error('Goodreads sync failed:', error);
	process.exit(1);
});
