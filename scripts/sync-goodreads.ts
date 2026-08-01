import 'dotenv/config';
import {
	mergeSyncedBook,
	parseFeed,
	type RssBook,
	type SyncShelf,
} from '../shared/import/goodreadsRss';
import type { BookMetadata, Item } from '../shared/types/item';
import { makeBookId } from '../shared/utils/itemId';
import { coverWidth } from './lib/coverSize';
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

	// Goodreads' cover only beats a stored Google one when it's actually high-res,
	// which takes a real measurement — done here so `mergeSyncedBook` stays pure.
	const coverWidths = await measureCovers(books, existing);

	// Merge every book first, so the supplemental Hardcover enrichment below can
	// run before the change diff — enriching a book that was otherwise unchanged
	// (imported before it had a hardcover_id) turns it into a write.
	const merged = [...books].map(([id, rss]) => ({
		prev: existing.get(id),
		item: mergeSyncedBook(existing.get(id), rss, coverWidths.get(id)),
	}));

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
