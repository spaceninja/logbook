import { describe, expect, it } from 'vitest';
import { deriveCreatorSort } from './creatorSort';

describe('deriveCreatorSort', () => {
	it('returns undefined for no creator', () => {
		expect(deriveCreatorSort(undefined, 'book')).toBeUndefined();
		expect(deriveCreatorSort('', 'book')).toBeUndefined();
		expect(deriveCreatorSort('   ', 'book')).toBeUndefined();
	});

	it('moves the last token to the front for a person', () => {
		expect(deriveCreatorSort('George R. R. Martin', 'book')).toBe(
			'Martin George R. R.',
		);
		expect(deriveCreatorSort('Andy Weir', 'movie')).toBe('Weir Andy');
	});

	it('leaves a single-token name unchanged', () => {
		expect(deriveCreatorSort('Liu', 'book')).toBe('Liu');
	});

	it('uses the first creator when given an array', () => {
		expect(deriveCreatorSort(['Joel Coen', 'Ethan Coen'], 'movie')).toBe(
			'Coen Joel',
		);
	});

	it('returns a game studio name as-is (not a person)', () => {
		expect(deriveCreatorSort('Supergiant Games', 'game')).toBe(
			'Supergiant Games',
		);
	});

	it('trims surrounding whitespace', () => {
		expect(deriveCreatorSort('  Andy Weir  ', 'book')).toBe('Weir Andy');
	});
});
