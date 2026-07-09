/**
 * Goodreads appends its series to the exported title: "Gideon the Ninth (The
 * Locked Tomb, #1)". Only a trailing parenthetical carrying "#<number>" is a
 * series suffix — a title may legitimately end in parentheses ("We Are Legion
 * (We Are Bob)"), and a series named without a number ("(Discworld)") is left
 * alone rather than risk truncating a real title. Omnibus ranges ("#1-3") name
 * the series but have no single number, so they yield no `seriesNumber`.
 *
 * Google Books exposes no series data at all, so this suffix is the only
 * machine-readable series information available and is parsed rather than
 * discarded. `seriesNumber` may be fractional: Goodreads numbers novellas as
 * point entries ("The Expanse, #0.5"), which `itemSort` already handles.
 */
const SERIES_SUFFIX =
	/\s*\(([^)]*?)[,\s]+#\s*([\d.]+(?:\s*-\s*[\d.]+)?)\s*\)\s*$/;

export interface ParsedTitle {
	title: string;
	series?: string;
	seriesNumber?: number;
}

/** Split a Goodreads title into its own title and any series it names. */
export function parseSeriesSuffix(raw: string): ParsedTitle {
	const match = raw.match(SERIES_SUFFIX);
	if (!match) return { title: raw.trim() };
	const title = raw.slice(0, match.index).trim();
	const series = match[1]!.trim();
	const seriesNumber = Number(match[2]);
	return Number.isFinite(seriesNumber)
		? { title, series, seriesNumber }
		: { title, series };
}
