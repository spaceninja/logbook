/**
 * A small HTML → Markdown converter for provider descriptions (Google Books in
 * particular ships HTML). Keeps the tags with a direct Markdown equivalent
 * (bold, italic, links, list items, line/paragraph breaks), strips everything
 * else, and decodes HTML entities. Pure string ops — no DOM, so it runs the same
 * server-side, client-side, and in tests. Intentionally simple, not a full parser.
 */

const NAMED_ENTITIES: Record<string, string> = {
	amp: '&',
	lt: '<',
	gt: '>',
	quot: '"',
	apos: "'",
	nbsp: ' ',
	mdash: '—',
	ndash: '–',
	hellip: '…',
	rsquo: '’',
	lsquo: '‘',
	rdquo: '”',
	ldquo: '“',
};

function decodeEntities(text: string): string {
	return text.replace(/&(#x?[0-9a-f]+|[a-z0-9]+);/gi, (match, code: string) => {
		if (code[0] === '#') {
			const isHex = code[1]?.toLowerCase() === 'x';
			const n = isHex
				? Number.parseInt(code.slice(2), 16)
				: Number.parseInt(code.slice(1), 10);
			return Number.isNaN(n) ? match : String.fromCodePoint(n);
		}
		return NAMED_ENTITIES[code.toLowerCase()] ?? match;
	});
}

/**
 * Wrap an emphasis span's text in `marker`, keeping the markers tight against the
 * text: boundary whitespace moves outside (`word ` → `*word* `), and if the span
 * still contains a newline the markers are dropped (markdown emphasis can't span
 * line breaks). `inner` has already had its <br>/blocks turned into newlines.
 */
function emphasize(inner: string, marker: string): string {
	const [, lead = '', core = '', trail = ''] =
		inner.match(/^(\s*)([\s\S]*?)(\s*)$/) ?? [];
	if (!core) return inner; // whitespace-only span
	if (/\n/.test(core)) return `${lead}${core}${trail}`;
	return `${lead}${marker}${core}${marker}${trail}`;
}

export function htmlToMarkdown(html: string): string {
	let text = html;

	// Links: <a href="url">label</a> → [label](url)
	text = text.replace(
		/<a\b[^>]*\bhref=["']([^"']*)["'][^>]*>(.*?)<\/a>/gi,
		'[$2]($1)',
	);
	// List items
	text = text.replace(/<li\b[^>]*>/gi, '- ').replace(/<\/li>/gi, '\n');
	// Line/block breaks → newlines (before emphasis, so emphasis spans can detect
	// and avoid wrapping them).
	text = text.replace(/<br\s*\/?>/gi, '\n');
	text = text.replace(/<\/(?:p|div|h[1-6]|ul|ol|blockquote)>/gi, '\n\n');
	// Bold / italic as paired spans (outer first, so nested italics survive).
	text = text.replace(
		/<(?:strong|b)\b[^>]*>([\s\S]*?)<\/(?:strong|b)>/gi,
		(_match, inner: string) => emphasize(inner, '**'),
	);
	text = text.replace(
		/<(?:em|i)\b[^>]*>([\s\S]*?)<\/(?:em|i)>/gi,
		(_match, inner: string) => emphasize(inner, '*'),
	);
	// Strip every remaining tag
	text = text.replace(/<[^>]+>/g, '');

	text = decodeEntities(text);

	// Tidy whitespace: trailing spaces, runs of blank lines, outer trim.
	return text
		.replace(/[ \t]+\n/g, '\n')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}
