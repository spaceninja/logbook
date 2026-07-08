import { describe, expect, it } from 'vitest';
import { chooseFallbackDate, coerceIsoDay } from './dates';

describe('coerceIsoDay', () => {
	it('passes through a full ISO day', () => {
		expect(coerceIsoDay('2023-05-02')).toBe('2023-05-02');
	});

	it('fills a missing day or month with 01', () => {
		expect(coerceIsoDay('2023')).toBe('2023-01-01');
		expect(coerceIsoDay('2023-05')).toBe('2023-05-01');
	});

	it('reads the leading day from a datetime', () => {
		expect(coerceIsoDay('2023-05-02T12:00:00Z')).toBe('2023-05-02');
	});

	it('returns undefined for empty or non-year input', () => {
		expect(coerceIsoDay(undefined)).toBeUndefined();
		expect(coerceIsoDay('')).toBeUndefined();
		expect(coerceIsoDay('n/a')).toBeUndefined();
	});
});

describe('chooseFallbackDate', () => {
	const candidates = {
		added: '2024-02-01',
		updated: '2025-03-04',
		release: '1999', // year-only, like a Google Books publishedDate
	};

	it('honors the chosen source, coercing a year-only release', () => {
		expect(chooseFallbackDate(candidates, 'added')).toBe('2024-02-01');
		expect(chooseFallbackDate(candidates, 'updated')).toBe('2025-03-04');
		expect(chooseFallbackDate(candidates, 'release')).toBe('1999-01-01');
	});

	it('falls through to the next usable date when the pick is missing', () => {
		// Goodreads has no "last updated" — that pick falls to date-added.
		expect(chooseFallbackDate({ added: '2024-02-01' }, 'updated')).toBe(
			'2024-02-01',
		);
		// "Release" with no release date still yields a date rather than none.
		expect(chooseFallbackDate({ added: '2024-02-01' }, 'release')).toBe(
			'2024-02-01',
		);
	});

	it('returns undefined only when nothing usable exists', () => {
		expect(chooseFallbackDate({}, 'added')).toBeUndefined();
		expect(chooseFallbackDate({ release: 'n/a' }, 'release')).toBeUndefined();
	});
});
