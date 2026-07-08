import type { Item } from '../../shared/types/item';
import { googleBooksByIsbn, googleBooksByTitle } from '../utils/googleBooks';

/**
 * GET /api/book?isbn= | ?title=&author= — a prefilled draft Item for a book,
 * looked up in Google Books. Books identify by their Goodreads Book Id but enrich
 * from Google Books (which the Goodreads export can't name a volume id for), so
 * the bulk importer bridges the two by ISBN, then by a title/author search. 404
 * when nothing matches, so the importer can fall back to the export's own fields.
 */
export default defineEventHandler(async (event): Promise<Item> => {
	const { isbn, title, author } = getQuery(event);
	const isbnValue = String(isbn ?? '').replace(/[^0-9Xx]/g, '');
	const titleValue = String(title ?? '').trim();
	if (!isbnValue && !titleValue) {
		throw createError({
			statusCode: 400,
			statusMessage: 'Missing isbn or title',
		});
	}

	let draft: Item | null;
	try {
		draft = isbnValue
			? await googleBooksByIsbn(isbnValue)
			: await googleBooksByTitle(
					titleValue,
					String(author ?? '').trim() || undefined,
				);
	} catch {
		throw createError({
			statusCode: 502,
			statusMessage: 'Metadata provider failed',
		});
	}

	if (!draft)
		throw createError({ statusCode: 404, statusMessage: 'No matching book' });
	return draft;
});
