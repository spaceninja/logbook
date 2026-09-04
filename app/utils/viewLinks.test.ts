import { describe, expect, it } from 'vitest';
import { DEFAULT_MEDIA_TYPE, mediaTypeQuery, viewLink } from './viewLinks';

describe('viewLink', () => {
	it('carries a non-default type as a query param', () => {
		expect(viewLink('/', 'game')).toStrictEqual({
			path: '/',
			query: { type: 'game' },
		});
		expect(viewLink('/history', 'show')).toStrictEqual({
			path: '/history',
			query: { type: 'show' },
		});
	});

	it('omits the default type, matching what the views write', () => {
		// `enumParam` serializes the default to null, so the app never produces a
		// `?type=book` URL — a link that did would be the odd one out.
		expect(viewLink('/', DEFAULT_MEDIA_TYPE)).toBe('/');
		expect(viewLink('/history', DEFAULT_MEDIA_TYPE)).toBe('/history');
	});
});

describe('mediaTypeQuery', () => {
	it('is spreadable beside other params', () => {
		expect({ ...mediaTypeQuery('movie'), q: 'dune' }).toStrictEqual({
			type: 'movie',
			q: 'dune',
		});
		expect({ ...mediaTypeQuery(DEFAULT_MEDIA_TYPE), q: 'dune' }).toStrictEqual({
			q: 'dune',
		});
	});
});
