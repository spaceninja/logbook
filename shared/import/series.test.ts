import { describe, expect, it } from 'vitest';
import { parseSeriesSuffix } from './series';

describe('parseSeriesSuffix', () => {
	it('splits a Goodreads series suffix off the title', () => {
		expect(parseSeriesSuffix('Gideon the Ninth (The Locked Tomb, #1)')).toEqual(
			{
				title: 'Gideon the Ninth',
				series: 'The Locked Tomb',
				seriesNumber: 1,
			},
		);
	});

	it('keeps a title that ends in its own parenthetical', () => {
		// Two trailing parentheticals: only the series one may be taken.
		expect(
			parseSeriesSuffix('We Are Legion (We Are Bob) (Bobiverse, #1)'),
		).toEqual({
			title: 'We Are Legion (We Are Bob)',
			series: 'Bobiverse',
			seriesNumber: 1,
		});
	});

	it('leaves a trailing parenthetical that names no number', () => {
		// Without "#N" we can't tell a series from part of the title.
		expect(parseSeriesSuffix('We Are Legion (We Are Bob)')).toEqual({
			title: 'We Are Legion (We Are Bob)',
		});
		expect(parseSeriesSuffix('A Book (Discworld)')).toEqual({
			title: 'A Book (Discworld)',
		});
	});

	it('reads a fractional number, as Goodreads uses for novellas', () => {
		expect(
			parseSeriesSuffix('The Butcher of Anderson Station (The Expanse, #0.5)'),
		).toEqual({
			title: 'The Butcher of Anderson Station',
			series: 'The Expanse',
			seriesNumber: 0.5,
		});
	});

	it('accepts a series with no comma before the number', () => {
		expect(parseSeriesSuffix('Bobiverse Book (Bobiverse #2)')).toEqual({
			title: 'Bobiverse Book',
			series: 'Bobiverse',
			seriesNumber: 2,
		});
	});

	it('names the series but no number for an omnibus range', () => {
		expect(parseSeriesSuffix('Some Omnibus (Series, #1-3)')).toEqual({
			title: 'Some Omnibus',
			series: 'Series',
		});
	});

	it('leaves a title with no suffix alone', () => {
		expect(parseSeriesSuffix('The Hobbit')).toEqual({ title: 'The Hobbit' });
		expect(parseSeriesSuffix('  The Hobbit  ')).toEqual({
			title: 'The Hobbit',
		});
	});
});
