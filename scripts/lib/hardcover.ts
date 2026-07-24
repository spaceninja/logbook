import {
	applyHardcoverEnrichment,
	enrichmentsByIsbn,
	HARDCOVER_ISBN_QUERY,
	type HardcoverEdition,
} from '../../shared/providers/hardcover';
import type { BookMetadata, Item } from '../../shared/types/item';

/**
 * Node-side (non-Nitro) Hardcover enrichment for the Goodreads RSS sync. Mirrors
 * `server/utils/hardcover.ts` but reads the token from an argument (the script
 * sources `HARDCOVER_TOKEN` via dotenv) and uses global `fetch`. Enriches book
 * items lacking a `hardcover_id` in batched, best-effort fashion — a failure
 * leaves them for a later run rather than aborting the sync.
 */

const ENDPOINT = 'https://api.hardcover.app/v1/graphql';
const ISBN_BATCH_SIZE = 50;
const SPACING_MS = 1100; // just over the 60 req/min limit

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

/**
 * Enrich the given items in place (via `applyHardcoverEnrichment`). Only books
 * with an ISBN and no `hardcover_id` are touched. On a 401 (the token expires
 * yearly on Jan 1) it stops early — every remaining batch would fail the same
 * way — so the caller can flag "rotate the token".
 */
export async function enrichBooksWithHardcover(
	items: Item[],
	token: string | undefined,
): Promise<HardcoverSyncResult> {
	const targets = items.filter(
		(it) =>
			it.type === 'book' &&
			!(it.metadata as BookMetadata).hardcover_id &&
			!!normalizeIsbn((it.metadata as BookMetadata).isbn),
	);
	if (targets.length === 0) return { enriched: 0, errors: 0, skipped: 0 };
	if (!token) return { enriched: 0, errors: 0, skipped: targets.length };

	let enriched = 0;
	let errors = 0;
	for (let i = 0; i < targets.length; i += ISBN_BATCH_SIZE) {
		const chunk = targets.slice(i, i + ISBN_BATCH_SIZE);
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
			if (i + ISBN_BATCH_SIZE < targets.length) await sleep(SPACING_MS);
		} catch (error) {
			errors += chunk.length;
			if ((error as { status?: number }).status === 401) break; // expired token
		}
	}
	return { enriched, errors, skipped: 0 };
}
