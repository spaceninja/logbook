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

export function htmlToMarkdown(html: string): string {
  let text = html;

  // Links: <a href="url">label</a> → [label](url)
  text = text.replace(
    /<a\b[^>]*\bhref=["']([^"']*)["'][^>]*>(.*?)<\/a>/gi,
    '[$2]($1)',
  );
  // Bold / italic (open and close → the same marker)
  text = text.replace(/<\/?(?:strong|b)\b[^>]*>/gi, '**');
  text = text.replace(/<\/?(?:em|i)\b[^>]*>/gi, '*');
  // List items
  text = text.replace(/<li\b[^>]*>/gi, '- ').replace(/<\/li>/gi, '\n');
  // Line breaks and block boundaries
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<\/(?:p|div|h[1-6]|ul|ol|blockquote)>/gi, '\n\n');
  // Strip every remaining tag
  text = text.replace(/<[^>]+>/g, '');

  text = decodeEntities(text);

  // Tidy whitespace: trailing spaces, runs of blank lines, outer trim.
  return text
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
