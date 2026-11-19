import { describe, expect, it } from 'vitest';
import { parseWidget, widgetUrl } from './goodreadsWidget';

interface Entry {
	fullTitle: string;
	shortTitle?: string;
	cover: string;
	stars?: number;
	author?: string;
}

const STAR_ON =
	'https://s.gr-assets.com/images/layout/gr_flat_red_star_active.png';
const STAR_OFF =
	'https://s.gr-assets.com/images/layout/gr_flat_red_star_inactive.png';

/** One book's markup, in the shape the widget renders (widget id 77). */
function entry({ fullTitle, shortTitle, cover, stars = 0, author }: Entry) {
	const starImgs = Array.from(
		{ length: 5 },
		(_, i) => `<img src="${i < stars ? STAR_ON : STAR_OFF}" />`,
	).join('');
	return `
      <div class="gr_custom_each_container_77">
          <div class="gr_custom_book_container_77">
            <a title="${fullTitle}" rel="nofollow" href="https://www.goodreads.com/review/show/1"><img alt="x" border="0" src="${cover}" /></a>
          </div>
          <div class="gr_custom_rating_77">
            <span class=" staticStars notranslate">${starImgs}</span>
          </div>
          <div class="gr_custom_title_77">
            <a rel="nofollow" href="https://www.goodreads.com/review/show/1">${shortTitle ?? fullTitle}</a>
          </div>
          ${author ? `<div class="gr_custom_author_77">\n            by <a rel="nofollow" href="https://www.goodreads.com/author/show/1">${author}</a>\n          </div>` : ''}
      </div>`;
}

/**
 * Wrap entries in the JavaScript snippet the endpoint actually returns: the HTML
 * inside a single-quoted literal with `"`, `/` and newlines backslash-escaped.
 */
function widgetScript(...entries: string[]): string {
	const html = `<div class="gr_custom_container_77">${entries.join('')}</div>`;
	const literal = html
		.replace(/\\/g, '\\\\')
		.replace(/"/g, '\\"')
		.replace(/'/g, "\\'")
		.replace(/<\//g, '<\\/')
		.replace(/\n/g, '\\n');
	return `  var widget_code = '${literal}'\n  var widget_div = document.getElementById('gr_custom_widget_77')\n`;
}

const NOODLE = entry({
	fullTitle: 'Automatic Noodle',
	cover:
		'https://i.gr-assets.com/images/S/compressed.photo.goodreads.com/books/1731705848l/217582924._SY75_.jpg',
	stars: 4,
	author: 'Annalee Newitz',
});

describe('parseWidget', () => {
	it('takes the book id from the cover filename', () => {
		const { books } = parseWidget(widgetScript(NOODLE), 'read');
		expect(books[0]?.bookId).toBe('217582924');
	});

	it('swaps the thumbnail directive for full-size and list-size covers', () => {
		const [book] = parseWidget(widgetScript(NOODLE), 'read').books;
		expect([book?.coverLarge, book?.coverSmall]).toEqual([
			'https://i.gr-assets.com/images/S/compressed.photo.goodreads.com/books/1731705848l/217582924._SX640_.jpg',
			'https://i.gr-assets.com/images/S/compressed.photo.goodreads.com/books/1731705848l/217582924._SX180_.jpg',
		]);
	});

	it('reads the rating from the filled stars, on the 0–10 scale', () => {
		const [book] = parseWidget(widgetScript(NOODLE), 'read').books;
		expect(book?.myRating).toBe(8);
	});

	it('leaves an unrated book without a rating', () => {
		const unrated = entry({
			fullTitle: 'Unrated',
			cover: 'https://i.gr-assets.com/x/books/1l/42._SY75_.jpg',
		});
		const [book] = parseWidget(widgetScript(unrated), 'to-read').books;
		expect(book).not.toHaveProperty('myRating');
	});

	it('reads the author', () => {
		const [book] = parseWidget(widgetScript(NOODLE), 'read').books;
		expect(book?.author).toBe('Annalee Newitz');
	});

	it('collapses runs of whitespace in an author name', () => {
		const spaced = entry({
			fullTitle: 'Embers of War',
			cover: 'https://i.gr-assets.com/x/books/1l/35795950._SY75_.jpg',
			author: 'Gareth L.   Powell',
		});
		const [book] = parseWidget(widgetScript(spaced), 'read').books;
		expect(book?.author).toBe('Gareth L. Powell');
	});

	it('takes the series from the full title and decodes entities', () => {
		const series = entry({
			fullTitle: 'Bookshops &amp; Bonedust (Legends &amp; Lattes, #0)',
			shortTitle: 'Bookshops &amp; Bonedust',
			cover: 'https://i.gr-assets.com/x/books/1l/75559711._SY75_.jpg',
		});
		const [book] = parseWidget(widgetScript(series), 'read').books;
		expect([book?.title, book?.series, book?.seriesNumber]).toEqual([
			'Bookshops & Bonedust',
			'Legends & Lattes',
			0,
		]);
	});

	it('keeps an apostrophe escaped inside the script literal', () => {
		const quoted = entry({
			fullTitle: "Ender's Game",
			cover: 'https://i.gr-assets.com/x/books/1l/375802._SY75_.jpg',
		});
		const [book] = parseWidget(widgetScript(quoted), 'read').books;
		expect(book?.title).toBe("Ender's Game");
	});

	it('preserves Goodreads’ order', () => {
		const second = entry({
			fullTitle: 'Second',
			cover: 'https://i.gr-assets.com/x/books/1l/2._SY75_.jpg',
		});
		const { books } = parseWidget(widgetScript(NOODLE, second), 'read');
		expect(books.map((b) => b.bookId)).toEqual(['217582924', '2']);
	});

	it('tags each book with the shelf it came from', () => {
		const [book] = parseWidget(widgetScript(NOODLE), 'currently-reading').books;
		expect(book?.shelf).toBe('currently-reading');
	});

	it('skips a book with no cover, since it has no id', () => {
		const coverless = entry({
			fullTitle: 'Obscure Book',
			cover:
				'https://s.gr-assets.com/assets/nophoto/book/50x75-a91bf249278a81aabab721ef782c4a74.png',
		});
		expect(parseWidget(widgetScript(NOODLE, coverless), 'read')).toEqual({
			books: [expect.objectContaining({ bookId: '217582924' })],
			skipped: ['Obscure Book'],
		});
	});

	it('reads an empty shelf as no books', () => {
		expect(parseWidget(widgetScript(), 'currently-reading').books).toEqual([]);
	});

	it('throws on a response that is not a widget', () => {
		expect(() => parseWidget('<html>Page not found</html>', 'read')).toThrow(
			/no widget_code/,
		);
	});
});

describe('widgetUrl', () => {
	it('sorts the read shelf by date read, newest first', () => {
		const params = new URL(widgetUrl('123', 'read', '9')).searchParams;
		expect([params.get('sort'), params.get('order')]).toEqual([
			'date_read',
			'd',
		]);
	});

	it('passes the widget id through so each request can be unique', () => {
		const params = new URL(widgetUrl('123', 'to-read', '9')).searchParams;
		expect(params.get('widget_id')).toBe('9');
	});
});
