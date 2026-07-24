import type { HardcoverEnrichment } from '../../shared/providers/hardcover';
import { hardcoverEnrichByIsbns } from '../utils/hardcover';

interface HardcoverResponse {
	results: Record<string, HardcoverEnrichment>;
	/** True when Hardcover was unavailable/rate-limited/misconfigured. */
	error: boolean;
}

/**
 * POST /api/hardcover  { isbns: string[] }  →  { results, error }
 *
 * Batched, best-effort supplemental tag/rating enrichment keyed by ISBN. The
 * bulk importer calls this in batches for books lacking a `hardcover_id`. It
 * never throws for the caller: `error: true` (with empty `results`) signals
 * Hardcover was unavailable, so the importer keeps its un-enriched books and
 * surfaces the error on the results view — enrichment is always supplemental.
 */
export default defineEventHandler(async (event): Promise<HardcoverResponse> => {
	const body = await readBody<{ isbns?: unknown }>(event);
	const isbns = Array.isArray(body?.isbns)
		? body.isbns
				.map((i) =>
					String(i)
						.replace(/[^0-9Xx]/g, '')
						.toUpperCase(),
				)
				.filter((i) => i.length === 10 || i.length === 13)
		: [];
	if (isbns.length === 0) return { results: {}, error: false };

	try {
		const map = await hardcoverEnrichByIsbns(isbns);
		return { results: Object.fromEntries(map), error: false };
	} catch {
		return { results: {}, error: true };
	}
});
