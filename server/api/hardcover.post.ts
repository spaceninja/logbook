import type { HardcoverEnrichment } from '../../shared/providers/hardcover';
import {
	hardcoverEnrichByIsbns,
	hardcoverEnrichByTitle,
} from '../utils/hardcover';

interface HardcoverResponse {
	results: Record<string, HardcoverEnrichment>;
	/** True when Hardcover was unavailable/rate-limited/misconfigured. */
	error: boolean;
}

/** One title-search request from the importer, for a book with no ISBN. */
interface TitleQuery {
	key: string;
	title: string;
	author?: string;
}

/** `body.books` → the well-formed title queries in it. */
function titleQueries(value: unknown): TitleQuery[] {
	if (!Array.isArray(value)) return [];
	const queries: TitleQuery[] = [];
	for (const entry of value) {
		const { key, title, author } = (entry ?? {}) as Record<string, unknown>;
		const cleanKey = String(key ?? '').trim();
		const cleanTitle = String(title ?? '').trim();
		if (!cleanKey || !cleanTitle) continue;
		const cleanAuthor = String(author ?? '').trim();
		queries.push({
			key: cleanKey,
			title: cleanTitle,
			...(cleanAuthor ? { author: cleanAuthor } : {}),
		});
	}
	return queries;
}

/**
 * POST /api/hardcover  { isbns?: string[], books?: { key, title, author }[] }
 *   →  { results, error }
 *
 * Batched, best-effort supplemental tag/rating enrichment. The bulk importer calls
 * this for books lacking a `hardcover_id`: `isbns` for the ones Goodreads gives an
 * ISBN, `books` for the ~28% it doesn't, which resolve one at a time through
 * Hardcover's title search. Results are keyed by ISBN and by the caller's `key`
 * respectively, so one response can carry both.
 *
 * It never throws for the caller: `error: true` (with empty `results`) signals
 * Hardcover was unavailable, so the importer keeps its un-enriched books and
 * surfaces the error on the results view — enrichment is always supplemental.
 */
export default defineEventHandler(async (event): Promise<HardcoverResponse> => {
	const body = await readBody<{ isbns?: unknown; books?: unknown }>(event);
	const isbns = Array.isArray(body?.isbns)
		? body.isbns
				.map((i) =>
					String(i)
						.replace(/[^0-9Xx]/g, '')
						.toUpperCase(),
				)
				.filter((i) => i.length === 10 || i.length === 13)
		: [];
	const books = titleQueries(body?.books);
	if (isbns.length === 0 && books.length === 0) {
		return { results: {}, error: false };
	}

	try {
		const results: Record<string, HardcoverEnrichment> = {};
		if (isbns.length > 0) {
			for (const [isbn, enrichment] of await hardcoverEnrichByIsbns(isbns)) {
				results[isbn] = enrichment;
			}
		}
		// Serialized by the shared rate-limit chain in `utils/hardcover.ts`, so
		// these run one at a time regardless of how they're awaited here.
		for (const { key, title, author } of books) {
			const enrichment = await hardcoverEnrichByTitle(title, author);
			if (enrichment) results[key] = enrichment;
		}
		return { results, error: false };
	} catch {
		return { results: {}, error: true };
	}
});
