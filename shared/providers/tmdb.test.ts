import { describe, expect, it } from 'vitest';
import {
	mapTmdbMovieDraft,
	mapTmdbMovieSearch,
	mapTmdbSeasonDraft,
	mapTmdbSeasons,
	type TmdbMovieDetails,
	type TmdbSeasonDetails,
	type TmdbShowDetails,
} from './tmdb';

describe('mapTmdbMovieSearch', () => {
	it('normalizes movie hits', () => {
		const [r] = mapTmdbMovieSearch([
			{
				id: 27205,
				title: 'Inception',
				release_date: '2010-07-16',
				poster_path: '/p.jpg',
			},
		]);
		expect(r).toStrictEqual({
			type: 'movie',
			providerId: '27205',
			title: 'Inception',
			year: '2010',
			thumbnail: 'https://image.tmdb.org/t/p/w185/p.jpg',
		});
	});
});

describe('mapTmdbMovieDraft', () => {
	const details: TmdbMovieDetails = {
		id: 27205,
		title: 'Inception',
		release_date: '2010-07-16',
		overview: 'A thief…',
		runtime: 148,
		vote_average: 8.4,
		poster_path: '/p.jpg',
		backdrop_path: '/bd.jpg',
		genres: [{ name: 'Action' }, { name: 'Science Fiction' }],
		credits: {
			crew: [
				{ job: 'Director', name: 'Christopher Nolan' },
				{ job: 'Editor', name: 'Lee Smith' },
			],
		},
	};

	it('maps details to a draft item', () => {
		const item = mapTmdbMovieDraft(details);
		expect(item.id).toBe('movie-tmdb-27205');
		expect(item.type).toBe('movie');
		expect(item.creator).toBe('Christopher Nolan');
		const runtime = item.length;
		expect(runtime).toBe(148);
		expect(item.length_unit).toBe('min');
		expect(item.community_rating).toBe(8.4);
		expect(item.cover).toBe('https://image.tmdb.org/t/p/w500/p.jpg');
		expect(item.backdrop).toBe('https://image.tmdb.org/t/p/w1280/bd.jpg');
		expect(item.tags).toStrictEqual(['action', 'science fiction']);
		expect(item.provider).toBe('tmdb');
		expect(item.status).toBe('backlog');
	});

	it('omits runtime/rating when zero/absent', () => {
		const item = mapTmdbMovieDraft({
			id: 1,
			title: 'X',
			runtime: 0,
			vote_average: 0,
		});
		expect(item.length).toBeUndefined();
		expect(item.community_rating).toBeUndefined();
		expect(item.creator).toBeUndefined();
		expect(item.backdrop).toBeUndefined();
	});
});

describe('show seasons', () => {
	const show: TmdbShowDetails = {
		id: 95396,
		name: 'Severance',
		overview: 'Work you…',
		vote_average: 8.7,
		poster_path: '/show.jpg',
		backdrop_path: '/showbd.jpg',
		genres: [{ name: 'Mystery' }],
		created_by: [{ name: 'Dan Erickson' }],
		seasons: [
			{ season_number: 0, name: 'Specials', air_date: null, episode_count: 2 },
			{
				season_number: 1,
				name: 'Season 1',
				air_date: '2022-02-18',
				episode_count: 9,
				poster_path: '/s1.jpg',
			},
		],
	};

	it('lists seasons (incl. specials; UI hides them)', () => {
		expect(mapTmdbSeasons(show)).toStrictEqual([
			{ season_number: 0, name: 'Specials', year: undefined, episode_count: 2 },
			{ season_number: 1, name: 'Season 1', year: '2022', episode_count: 9 },
		]);
	});

	it('builds a season draft with summed runtime and per-season poster', () => {
		const season: TmdbSeasonDetails = {
			air_date: '2022-02-18',
			poster_path: '/s1.jpg',
			episodes: [{ runtime: 50 }, { runtime: 60 }, { runtime: null }],
		};
		const item = mapTmdbSeasonDraft(show, season, 1);
		expect(item.id).toBe('show-tmdb-95396-s1');
		expect(item.title).toBe('Severance');
		expect(item.creator).toBe('Dan Erickson');
		const seasonLength = item.length;
		expect(seasonLength).toBe(110); // 50 + 60, null skipped
		expect(item.community_rating).toBe(8.7); // show-level proxy
		expect(item.cover).toBe('https://image.tmdb.org/t/p/w500/s1.jpg');
		// Season has no backdrop of its own; uses the show's.
		expect(item.backdrop).toBe('https://image.tmdb.org/t/p/w1280/showbd.jpg');
		expect(item.metadata).toStrictEqual({
			show_tmdb_id: 95396,
			season_number: 1,
			episode_count: 9,
			episode_runtime: 55, // mean of 50 & 60
		});
	});
});
