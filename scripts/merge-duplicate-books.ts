import 'dotenv/config';
import { absorbTwin, bookTitlesMatch } from '../shared/import/bookTwin';
import { authorsMatch } from '../shared/providers/helpers';
import type { Item } from '../shared/types/item';
import { deleteItems, readBooks, writeItems } from './lib/firestore-admin';

/**
 * One-off cleanup for books that exist twice: once under a Google Books volume id
 * (`book-google-books-<id>`, the shape the app's Add search mints) and once under
 * a Goodreads book id (`book-goodreads-<id>`, the shape the daily sync mints).
 *
 * The two id spaces never collide, so adding a book in the app *and* shelving it
 * on Goodreads yields two independent documents. The sync only ever reads the ids
 * it derives from the feed (`sync-goodreads.ts`), so the app-created twin is
 * invisible to it forever — it keeps whatever community rating Google Books had
 * on the day it was added, or none at all when Google carried no `averageRating`.
 *
 * The Goodreads twin is the keeper: it's the one the sync refreshes, and its tags
 * come from Hardcover rather than Google's `categories` (which are auto-derived,
 * not chosen — so they are deliberately *not* merged). But the app-created twin is
 * where the owner actually typed, so the user-owned fields move across before it
 * is deleted.
 *
 * Only pairs that agree on title *and* author are touched, and only when exactly
 * one Goodreads twin exists. Anything else — including duplicate pairs where both
 * sides are Goodreads ids — is reported for manual review, never merged.
 *
 * Run:      npm run merge:duplicate-books
 * Preview:  npm run merge:duplicate-books -- --dry-run
 *
 * Requires FIREBASE_SERVICE_ACCOUNT.
 */

/** Books naming the same work, grouped. Uses the same rules as the sync (#105). */
function groupByWork(books: Item[]): Item[][] {
	const groups: Item[][] = [];
	for (const book of books) {
		const group = groups.find(
			(g) =>
				bookTitlesMatch(g[0]!.title, book.title) &&
				authorsMatch(g[0]!.creator, book.creator),
		);
		if (group) group.push(book);
		else groups.push([book]);
	}
	return groups;
}

function describe(value: unknown): string {
	if (value === undefined) return '—';
	if (Array.isArray(value)) return value.length > 0 ? value.join(', ') : '[]';
	const text = String(value);
	return text.length > 70 ? `${text.slice(0, 67)}…` : text;
}

async function main(): Promise<void> {
	const dryRun = process.argv.includes('--dry-run');

	const books = await readBooks();
	const groups = groupByWork(books);

	const toWrite: Item[] = [];
	const toDelete: string[] = [];
	const unhandled: Item[][] = [];

	for (const group of groups) {
		if (group.length < 2) continue;

		const keepers = group.filter((b) => b.id.startsWith('book-goodreads-'));
		const losers = group.filter((b) => b.id.startsWith('book-google-books-'));
		// Only the one shape this script understands: a single Goodreads survivor
		// absorbing its app-created twins, with nothing else in the group.
		if (keepers.length !== 1 || losers.length !== group.length - 1) {
			unhandled.push(group);
			continue;
		}

		let keeper = keepers[0]!;
		console.log(`\n${keeper.title} — ${describe(keeper.creator)}`);
		console.log(
			`  keep   ${keeper.id}  (community ${describe(keeper.community_rating)})`,
		);
		for (const loser of losers) {
			console.log(
				`  delete ${loser.id}  (community ${describe(loser.community_rating)})`,
			);
			const { item, carried } = absorbTwin(keeper, loser);
			keeper = item;
			for (const { field, value } of carried) {
				console.log(`    carry ${field}: ${describe(value)}`);
			}
		}
		toWrite.push(keeper);
		toDelete.push(...losers.map((l) => l.id));
	}

	if (unhandled.length > 0) {
		console.log('\nDuplicate groups left alone (manual review):');
		for (const group of unhandled) {
			console.log(
				`  ${group[0]!.title} — ${group.map((b) => `${b.id} [${b.status}]`).join('  |  ')}`,
			);
		}
	}

	console.log(
		`\n${books.length} books scanned: ${toWrite.length} merged, ${toDelete.length} to delete, ${unhandled.length} left alone`,
	);

	if (dryRun) {
		console.log('--dry-run: no writes.');
		return;
	}
	// Write the absorbed keeper before dropping the twin, so an interruption
	// between the two leaves a harmless duplicate rather than losing the notes.
	await writeItems(toWrite);
	await deleteItems(toDelete);
	console.log('Done.');
}

main().catch((error: unknown) => {
	console.error('Merge failed:', error);
	process.exit(1);
});
