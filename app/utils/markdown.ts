import MarkdownIt from 'markdown-it';

// `html: false` escapes any raw HTML in the source rather than passing it
// through, so rendering the result with v-html is XSS-safe. `breaks` turns
// single newlines into <br> (our descriptions use them); `linkify` auto-links
// bare URLs. `typographer` does smart quotes/dashes.
const md = new MarkdownIt({
  html: false,
  breaks: true,
  linkify: true,
  typographer: true,
});

/** Render a markdown string to a safe HTML string (no raw HTML passthrough). */
export function renderMarkdown(text: string): string {
  return md.render(text);
}
