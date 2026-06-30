import { describe, expect, it } from 'vitest';
import { htmlToMarkdown } from './htmlToMarkdown';

describe('htmlToMarkdown', () => {
	it('leaves plain text untouched', () => {
		expect(htmlToMarkdown('A thief who steals secrets.')).toBe(
			'A thief who steals secrets.',
		);
	});

	it('converts bold and italic', () => {
		expect(htmlToMarkdown('<b>Dune</b> is <i>great</i>')).toBe(
			'**Dune** is *great*',
		);
		expect(htmlToMarkdown('<strong>A</strong> <em>B</em>')).toBe('**A** *B*');
	});

	it('converts paragraphs and line breaks', () => {
		expect(htmlToMarkdown('<p>One</p><p>Two</p>')).toBe('One\n\nTwo');
		expect(htmlToMarkdown('Line one<br>Line two')).toBe('Line one\nLine two');
	});

	it('converts links and list items', () => {
		expect(htmlToMarkdown('<a href="https://x.com">site</a>')).toBe(
			'[site](https://x.com)',
		);
		expect(htmlToMarkdown('<ul><li>One</li><li>Two</li></ul>')).toBe(
			'- One\n- Two',
		);
	});

	it('strips tags without a markdown equivalent but keeps their text', () => {
		expect(htmlToMarkdown('<span class="x">kept</span>')).toBe('kept');
	});

	it('moves whitespace outside emphasis markers (valid markdown)', () => {
		// `*word *` is invalid emphasis; the space must sit outside the markers.
		expect(htmlToMarkdown('The <i>apocalypse </i>will end')).toBe(
			'The *apocalypse* will end',
		);
	});

	it('keeps nested italics inside bold tight', () => {
		expect(htmlToMarkdown('<b><i>X</i> Y</b>')).toBe('***X* Y**');
	});

	it('drops emphasis markers when the span contains a line break', () => {
		// Emphasis cannot span a newline; keep the text, lose the bold.
		expect(htmlToMarkdown('<b><i>Done.<br></i></b>')).toBe('*Done.*');
	});

	it('decodes HTML entities', () => {
		expect(htmlToMarkdown('Tom &amp; Jerry &#39;95 &mdash; fun')).toBe(
			"Tom & Jerry '95 — fun",
		);
	});

	it('does not mistake <body>/<img> for bold/italic', () => {
		expect(htmlToMarkdown('<body>hi <img src="x"> there</body>')).toBe(
			'hi  there',
		);
	});
});
