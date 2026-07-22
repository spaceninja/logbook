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

	const toWrite: Item[] = [];
	let created = 0;
	let updated = 0;
	let unchanged = 0;
	for (const [id, rss] of books) {
		const prev = existing.get(id);
		const merged = mergeSyncedBook(prev, rss);
		if (!prev) {
			toWrite.push(merged);
			created++;
		} else if (!itemsEqual(prev, merged)) {
			toWrite.push(merged);
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
