/**
 * A small RFC 4180-style CSV parser. Service exports (Goodreads, Letterboxd,
 * Infinite Backlog) quote fields that contain commas, quotes, or newlines — so a
 * naive `split(',')` corrupts titles like `System Collapse (The Murderbot
 * Diaries, #7)`. This handles quoted fields, `""` escapes, embedded newlines, a
 * leading BOM, and both LF and CRLF line endings.
 */

/** Parse CSV text into rows of raw string cells (header row included). */
export function parseCsv(text: string): string[][] {
	// Strip a UTF-8 BOM so it doesn't contaminate the first header cell.
	if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

	const rows: string[][] = [];
	let row: string[] = [];
	let field = '';
	let inQuotes = false;
	let i = 0;

	while (i < text.length) {
		const ch = text[i];

		if (inQuotes) {
			if (ch === '"') {
				// A doubled quote inside a quoted field is a literal quote.
				if (text[i + 1] === '"') {
					field += '"';
					i += 2;
					continue;
				}
				inQuotes = false;
				i++;
				continue;
			}
			field += ch;
			i++;
			continue;
		}

		if (ch === '"') {
			inQuotes = true;
			i++;
		} else if (ch === ',') {
			row.push(field);
			field = '';
			i++;
		} else if (ch === '\r') {
			// Swallow CR; the following LF ends the row (CRLF endings).
			i++;
		} else if (ch === '\n') {
			row.push(field);
			rows.push(row);
			row = [];
			field = '';
			i++;
		} else {
			field += ch;
			i++;
		}
	}

	// Flush a trailing field/row when the file doesn't end in a newline.
	if (field !== '' || row.length > 0) {
		row.push(field);
		rows.push(row);
	}

	return rows;
}

/**
 * Parse CSV text into records keyed by the header row. Fully blank lines are
 * skipped. Missing trailing cells become empty strings so every record has the
 * full header key set.
 */
export function parseCsvRecords(text: string): Record<string, string>[] {
	const rows = parseCsv(text);
	const header = rows[0];
	if (!header) return [];
	return rows
		.slice(1)
		.filter((row) => !(row.length === 1 && row[0] === ''))
		.map((row) => {
			const record: Record<string, string> = {};
			header.forEach((key, index) => {
				record[key] = row[index] ?? '';
			});
			return record;
		});
}
