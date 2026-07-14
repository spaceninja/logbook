import { describe, expect, it } from 'vitest';
import { pickMovieMatch, pickMovieVariantMatch } from './match';
import type { SearchResult } from '../types/search';

function hit(providerId: string, title: string, year?: string): SearchResult {
	return { type: 'movie', providerId, title, ...(year ? { year } : {}) };
}

describe('pickMovieMatch', () => {
	it('picks the result whose title and year both match', () => {
		const results = [
			hit('1', 'Dune: Part Two', '2024'),
			hit('2', 'Dune', '2021'),
		];
		expect(pickMovieMatch(results, 'Dune', '2021')).toBe('2');
	});

	it('picks by year between remakes sharing a title', () => {
		const results = [hit('1', 'Dune', '2021'), hit('2', 'Dune', '1984')];
		expect(pickMovieMatch(results, 'Dune', '1984')).toBe('2');
	});

	it('accepts a year off by one (a festival run dated against a release)', () => {
		const results = [hit('9', 'The Lighthouse', '2019')];
		expect(pickMovieMatch(results, 'The Lighthouse', '2018')).toBe('9');
	});

	it('accepts a lone same-titled film whose year is further off', () => {
		// Letterboxd dated this 2018, TMDB 2020; nothing else shares the title.
		const results = [hit('7', 'Seven Stages to Achieve Eternal Bliss', '2020')];
		expect(
			pickMovieMatch(results, 'Seven Stages to Achieve Eternal Bliss', '2018'),
		).toBe('7');
	});

	it('refuses to guess between same-titled films when no year is close', () => {
		const results = [hit('1', 'Dune', '2021'), hit('2', 'Dune', '1984')];
		expect(pickMovieMatch(results, 'Dune', '2005')).toBeNull();
	});

	it('rejects a title that merely starts the same', () => {
		// The trap a prefix match would fall into: these are different films.
		const results = [hit('1', 'Dune: Part Two', '2024')];
		expect(pickMovieMatch(results, 'Dune', '2024')).toBeNull();
	});

	it('matches through punctuation and diacritics', () => {
		const results = [hit('4', 'WALL·E', '2008'), hit('5', 'Amélie', '2001')];
		expect(pickMovieMatch(results, 'WALL-E', '2008')).toBe('4');
		expect(pickMovieMatch(results, 'Amelie', '2001')).toBe('5');
	});

	it("takes TMDB's top same-titled result when the export has no year", () => {
		const results = [
			hit('1', 'The Thing', '2011'),
			hit('2', 'The Thing', '1982'),
		];
		expect(pickMovieMatch(results, 'The Thing')).toBe('1');
	});

	it('returns null when the title matches nothing (TMDB has no such film)', () => {
		// A miniseries Letterboxd files as a film: TMDB's movie index has no entry.
		const results = [hit('1', "Frank Herbert's Dune: The Lure of Spice")];
		expect(pickMovieMatch(results, "Frank Herbert's Dune", '2000')).toBeNull();
		expect(pickMovieMatch([], 'The Colour of Magic', '2008')).toBeNull();
	});

	it('tolerates a result with no year', () => {
		const results = [hit('3', 'Bando Stone and The New World')];
		expect(pickMovieMatch(results, 'Bando Stone and The New World')).toBe('3');
	});
});

describe('pickMovieVariantMatch — same film under a longer or shorter title', () => {
	it("reaches TMDB's title through a leading article", () => {
		const results = [
			hit('1', 'The School of Rock', '2003'),
			hit('2', 'School of Rock: The Musical', '2015'),
		];
		expect(pickMovieVariantMatch(results, 'School of Rock', '2003')).toBe('1');
	});

	it('matches a film whose TMDB title carries a subtitle', () => {
		const results = [hit('1', 'Glass Onion: A Knives Out Mystery', '2022')];
		expect(pickMovieVariantMatch(results, 'Glass Onion', '2022')).toBe('1');
	});

	it('matches a film whose export title carries the longer name', () => {
		const results = [hit('1', '2010', '1984')];
		expect(
			pickMovieVariantMatch(results, '2010: The Year We Make Contact', '1984'),
		).toBe('1');
	});

	it('will not stretch across a different year', () => {
		// The Making of… is a different film, and a year out.
		const results = [
			hit('1', "The Making of Dr. Horrible's Sing-Along Blog", '2007'),
		];
		expect(
			pickMovieVariantMatch(results, "Dr. Horrible's Sing-Along Blog", '2008'),
		).toBeNull();
	});

	it('will not choose between several near-titles from the same year', () => {
		const results = [
			hit('1', 'Afro Samurai Pilot', '2007'),
			hit('2', 'Afro Samurai the Movie', '2007'),
		];
		expect(pickMovieVariantMatch(results, 'Afro Samurai', '2007')).toBeNull();
	});

	it('requires the extra text to start at a word boundary', () => {
		// "Drunken Master III" is not "Drunken Master II" with a subtitle.
		const results = [hit('1', 'Drunken Master III', '1994')];
		expect(
			pickMovieVariantMatch(results, 'Drunken Master II', '1994'),
		).toBeNull();
	});

	it('stands down when TMDB carries the title outright, in any year', () => {
		// The veto that makes the loose pass safe: TMDB has films called exactly
		// "Dune", so "Dune" is a real title and this just isn't one of those films.
		// Never reach past that for the sequel, however well the year lines up.
		const results = [
			hit('1', 'Dune: Part Two', '2024'),
			hit('2', 'Dune', '2021'),
			hit('3', 'Dune', '1984'),
		];
		expect(pickMovieVariantMatch(results, 'Dune', '2024')).toBeNull();
	});
});
