import {
	applyHardcoverEnrichment,
	enrichmentsByIsbn,
	HARDCOVER_BOOK_QUERY,
	HARDCOVER_ISBN_QUERY,
	HARDCOVER_SEARCH_QUERY,
	mapHardcoverBook,
	type HardcoverEdition,
} from '../../shared/providers/hardcover';
import type { BookMetadata, Item } from '../../shared/types/item';

/**
 * Node-side (non-Nitro) Hardcover enrichment for the Goodreads RSS sync. Mirrors
 * `server/utils/hardcover.ts` but reads the token from an argument (the script
 * sources `NUXT_HARDCOVER_TOKEN` via dotenv) and uses global `fetch`. Enriches book
 * items lacking a `hardcover_id` in batched, best-effort fashion — a failure
 * leaves them for a later run rather than aborting the sync.
 *
 * Books are matched by ISBN in batches, then — for the ~28% of the library
 * Goodreads carries no ISBN for — one at a time by title, mirroring the manual
 * path's `hardcoverEnrichByTitle`. Without that fallback those books silently got
 * no tags at all. (#69)
 */

const ENDPOINT = 'https://api.hardcover.app/v1/graphql';
const ISBN_BATCH_SIZE = 50;
const SPACING_MS = 1100; // just over the 60 req/min limit

/**
 * How many books to title-search per run. A title search is two serialized calls
 * (search, then fetch by id) against a 60 req/min limit, and a book Hardcover has
 * no match for is retried every run — nothing stamps a `hardcover_id` for it. The
 * cap keeps a growing pile of permanent no-matches from stretching the run.
 */
const TITLE_FALLBACK_LIMIT = 25;

export interface HardcoverSyncResult {
	/** Books that got tags/id from Hardcover. */
	enriched: number;
	/** Books left un-enriched by a failed batch (rate limit / outage / expired token). */
	errors: number;
	/** Books skipped because no token was configured. */
	skipped: number;
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeIsbn(isbn: string | undefined): string | undefined {
	const digits = (isbn ?? '').replace(/[^0-9Xx]/g, '').toUpperCase();
	return digits.length === 10 || digits.length === 13 ? digits : undefined;
}

function authHeader(token: string): string {
	return token.startsWith('Bearer ') ? token : `Bearer ${token}`;
}

async function gql<T>(
	token: string,
	query: string,
	variables: Record<string, unknown>,
): Promise<T> {
	const res = await fetch(ENDPOINT, {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			authorization: authHeader(token),
		},
		body: JSON.stringify({ query, variables }),
	});
	if (!res.ok) {
		const error = new Error(`Hardcover HTTP ${res.status}`) as Error & {
			status: number;
		};
		error.status = res.status;
		throw error;
	}
	const json = (await res.json()) as {
		data?: T;
		errors?: { message: string }[];
	};
	if (json.errors?.length) {
		throw new Error(`Hardcover GraphQL: ${json.errors[0]!.message}`);
	}
	return json.data as T;
}

/** First author from a `creator`, for a title+author search. */
function firstAuthor(creator: Item['creator']): string | undefined {
	return Array.isArray(creator) ? creator[0] : creator;
}

/** Whether a book still needs matching against Hardcover. */
function needsEnrichment(item: Item): boolean {
	return item.type === 'book' && !(item.metadata as BookMetadata).hardcover_id;
}

interface SearchResults {
	search: { results?: { hits?: { document?: { id?: string | number } }[] } };
}

/**
 * Resolve one book by title (+ author) via the Typesense-backed search, then fetch
 * that book's enrichment fields by id. Undefined when nothing matches.
 */
async function enrichOneByTitle(token: string, item: Item) {
	const q = [item.title, firstAuthor(item.creator)].filter(Boolean).join(' ');
	const found = await gql<SearchResults>(token, HARDCOVER_SEARCH_QUERY, { q });
	const id = Number(found.search?.results?.hits?.[0]?.document?.id);
	if (!Number.isFinite(id) || id <= 0) return undefined;
	await sleep(SPACING_MS);
	const data = await gql<{
		books_by_pk: Parameters<typeof mapHardcoverBook>[0];
	}>(token, HARDCOVER_BOOK_QUERY, { id });
	return mapHardcoverBook(data.books_by_pk);
}

/**
 * Enrich the given items in place (via `applyHardcoverEnrichment`). Only books
 * with no `hardcover_id` are touched: those with an ISBN go through batched ISBN
 * lookups, and whatever remains falls back to a capped title search. On a 401 (the
 * token expires yearly on Jan 1) it stops early — every remaining call would fail
 * the same way — so the caller can flag "rotate the token".
 */
export async function enrichBooksWithHardcover(
	items: Item[],
	token: string | undefined,
): Promise<HardcoverSyncResult> {
	const targets = items.filter(needsEnrichment);
	if (targets.length === 0) return { enriched: 0, errors: 0, skipped: 0 };
	if (!token) return { enriched: 0, errors: 0, skipped: targets.length };

	const withIsbn = targets.filter(
		(it) => !!normalizeIsbn((it.metadata as BookMetadata).isbn),
	);

	let enriched = 0;
	let errors = 0;
	let tokenExpired = false;
	// Books whose ISBN batch errored, rather than simply finding no match. A title
	// search could resolve them to a different record than their ISBN would, so
	// they're left for the next run to retry by ISBN.
	const isbnLookupFailed = new Set<string>();
	for (let i = 0; i < withIsbn.length; i += ISBN_BATCH_SIZE) {
		const chunk = withIsbn.slice(i, i + ISBN_BATCH_SIZE);
		const isbns = chunk
			.map((it) => normalizeIsbn((it.metadata as BookMetadata).isbn)!)
			.filter(Boolean);
		try {
			const data = await gql<{ editions: HardcoverEdition[] }>(
				token,
				HARDCOVER_ISBN_QUERY,
				{ isbns },
			);
			const byIsbn = enrichmentsByIsbn(data.editions ?? []);
			for (const it of chunk) {
				const isbn = normalizeIsbn((it.metadata as BookMetadata).isbn);
				const enrichment = isbn ? byIsbn.get(isbn) : undefined;
				if (enrichment) {
					Object.assign(it, applyHardcoverEnrichment(it, enrichment));
					enriched++;
				}
			}
			await sleep(SPACING_MS);
		} catch (error) {
			errors += chunk.length;
			for (const it of chunk) isbnLookupFailed.add(it.id);
			if ((error as { status?: number }).status === 401) {
				tokenExpired = true;
				break;
			}
		}
	}

	// Anything the ISBN pass didn't resolve — books Goodreads has no ISBN for, plus
	// ISBNs Hardcover doesn't carry — gets one title search each, up to the cap.
	if (tokenExpired) return { enriched, errors, skipped: 0 };
	const remaining = targets
		.filter((it) => needsEnrichment(it) && !isbnLookupFailed.has(it.id))
		.slice(0, TITLE_FALLBACK_LIMIT);
	for (const item of remaining) {
		try {
			const enrichment = await enrichOneByTitle(token, item);
			if (enrichment) {
				Object.assign(item, applyHardcoverEnrichment(item, enrichment));
				enriched++;
			}
			await sleep(SPACING_MS);
		} catch (error) {
			errors++;
			if ((error as { status?: number }).status === 401) break; // expired token
		}
	}

	return { enriched, errors, skipped: 0 };
}
