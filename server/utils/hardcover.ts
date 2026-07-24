// Plain ofetch $fetch (see googleBooks.ts) — avoids internal-route type matching.
import { $fetch } from 'ofetch';
import {
	applyHardcoverEnrichment,
	enrichmentsByIsbn,
	HARDCOVER_BOOK_QUERY,
	HARDCOVER_ISBN_QUERY,
	HARDCOVER_SEARCH_QUERY,
	mapHardcoverBook,
	type HardcoverEdition,
	type HardcoverEnrichment,
} from '../../shared/providers/hardcover';
import type { BookMetadata, Item } from '../../shared/types/item';

const ENDPOINT = 'https://api.hardcover.app/v1/graphql';

// Hardcover allows 60 requests/minute. Serialize every call through one chain
// spaced by just over a second — the same guard googleBooks.ts uses — so bursts
// (a manual refresh during an import) can't exceed the limit, retrying the rare
// 429 with backoff. A 401 (the token expires yearly on Jan 1) is NOT retried; it
// surfaces so the failure is legible as "rotate the token", not a transient blip.
const MIN_INTERVAL_MS = 1100;
const MAX_RETRIES = 3;

// Keep ISBN batches well under any Hasura row cap (one edition row per ISBN).
const ISBN_BATCH_SIZE = 50;

let chain: Promise<unknown> = Promise.resolve();

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function statusOf(error: unknown): number | undefined {
	const e = error as { status?: number; response?: { status?: number } };
	return e?.status ?? e?.response?.status;
}

/** Queue a call onto the Hardcover chain so calls never overlap or exceed the rate. */
function schedule<T>(task: () => Promise<T>): Promise<T> {
	const result = chain.then(task, task);
	const settle = () => sleep(MIN_INTERVAL_MS);
	chain = result.then(settle, settle);
	return result;
}

/** The Authorization header value — the token already carries "Bearer " in .env, but tolerate either. */
function authHeader(token: string): string {
	return token.startsWith('Bearer ') ? token : `Bearer ${token}`;
}

/** A rate-limited, 429-retrying GraphQL POST. Throws on a configured-token miss or a 401. */
function hardcoverGql<T>(
	query: string,
	variables: Record<string, unknown>,
): Promise<T> {
	const { hardcoverToken } = useRuntimeConfig();
	if (!hardcoverToken) throw new Error('HARDCOVER_TOKEN is not configured');
	return schedule(async () => {
		for (let attempt = 0; ; attempt++) {
			try {
				const res = await $fetch<{ data?: T; errors?: { message: string }[] }>(
					ENDPOINT,
					{
						method: 'POST',
						headers: { authorization: authHeader(hardcoverToken) },
						body: { query, variables },
					},
				);
				if (res.errors?.length) {
					throw new Error(`Hardcover GraphQL: ${res.errors[0]!.message}`);
				}
				return res.data as T;
			} catch (error) {
				if (attempt < MAX_RETRIES && statusOf(error) === 429) {
					await sleep(MIN_INTERVAL_MS * 2 ** attempt);
					continue;
				}
				throw error;
			}
		}
	});
}

/** Split a list into fixed-size chunks. */
function chunk<T>(items: T[], size: number): T[][] {
	const out: T[][] = [];
	for (let i = 0; i < items.length; i += size)
		out.push(items.slice(i, i + size));
	return out;
}

/**
 * Batched ISBN → enrichment lookup. Returns a map keyed by every matched ISBN
 * (13 and 10). Throws if any batch fails, so callers can report an enrichment
 * error while still keeping the un-enriched items (enrichment is supplemental).
 */
export async function hardcoverEnrichByIsbns(
	isbns: string[],
): Promise<Map<string, HardcoverEnrichment>> {
	const unique = [...new Set(isbns.filter(Boolean))];
	const merged = new Map<string, HardcoverEnrichment>();
	for (const batch of chunk(unique, ISBN_BATCH_SIZE)) {
		const data = await hardcoverGql<{ editions: HardcoverEdition[] }>(
			HARDCOVER_ISBN_QUERY,
			{ isbns: batch },
		);
		for (const [isbn, enrichment] of enrichmentsByIsbn(data.editions ?? [])) {
			merged.set(isbn, enrichment);
		}
	}
	return merged;
}

/** Enrichment for a single book by ISBN, or undefined when Hardcover has no match. */
export async function hardcoverEnrichByIsbn(
	isbn: string,
): Promise<HardcoverEnrichment | undefined> {
	return (await hardcoverEnrichByIsbns([isbn])).get(isbn);
}

interface SearchResults {
	search: { results?: { hits?: { document?: { id?: string | number } }[] } };
}

/**
 * Enrichment for a single book by title (+ author), the no-ISBN manual fallback.
 * Resolves the best match via the Typesense `search`, then fetches that book's
 * canonical enrichment fields by id. Undefined when nothing matches.
 */
export async function hardcoverEnrichByTitle(
	title: string,
	author?: string,
): Promise<HardcoverEnrichment | undefined> {
	const q = [title, author].filter(Boolean).join(' ');
	const found = await hardcoverGql<SearchResults>(HARDCOVER_SEARCH_QUERY, {
		q,
	});
	const id = Number(found.search?.results?.hits?.[0]?.document?.id);
	if (!Number.isFinite(id) || id <= 0) return undefined;
	const data = await hardcoverGql<{
		books_by_pk: Parameters<typeof mapHardcoverBook>[0];
	}>(HARDCOVER_BOOK_QUERY, { id });
	return mapHardcoverBook(data.books_by_pk);
}

/** First author from a `creator`, for a title+author search. */
function firstAuthor(creator: Item['creator']): string | undefined {
	return Array.isArray(creator) ? creator[0] : creator;
}

/**
 * Layer Hardcover tags/id (and a gap-filling rating) onto a single book draft —
 * the manual add / refresh / choose-edition path, where one extra Hardcover call
 * is cheap. Matches by the draft's ISBN, falling back to title+author. Always
 * best-effort: any failure returns the Google Books draft untouched, so the
 * interactive flow never breaks on a Hardcover hiccup.
 */
export async function enrichBookItemWithHardcover(item: Item): Promise<Item> {
	if (item.type !== 'book') return item;
	const isbn = (item.metadata as BookMetadata).isbn;
	try {
		const enrichment = isbn
			? await hardcoverEnrichByIsbn(isbn)
			: await hardcoverEnrichByTitle(item.title, firstAuthor(item.creator));
		return enrichment ? applyHardcoverEnrichment(item, enrichment) : item;
	} catch {
		return item;
	}
}
