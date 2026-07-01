import { describe, expect, it } from 'vitest';
import {
	mapIgdbDraft,
	mapIgdbSearch,
	pickBackdropId,
	pickTimeToBeat,
	rankIgdbGames,
	type IgdbGame,
} from './igdb';

const game: IgdbGame = {
	id: 1020,
	name: 'Halo: Combat Evolved',
	first_release_date: 1006300800, // 2001-11-21
	summary: 'Master Chief…',
	rating: 88.5,
	cover: { image_id: 'co1n7l' },
	artworks: [{ image_id: 'ar1', artwork_type: 2, width: 1920, height: 1080 }],
	screenshots: [{ image_id: 'sc1' }],
	genres: [{ name: 'Shooter' }],
	themes: [{ name: 'Action' }, { name: 'Science fiction' }],
	involved_companies: [
		{ developer: true, company: { name: 'Bungie' } },
		{ developer: false, company: { name: 'Microsoft' } },
	],
};

describe('mapIgdbSearch', () => {
	it('normalizes a game to a search result', () => {
		const [r] = mapIgdbSearch([game]);
		expect(r).toStrictEqual({
			type: 'game',
			providerId: '1020',
			title: 'Halo: Combat Evolved',
			year: '2001',
			thumbnail:
				'https://images.igdb.com/igdb/image/upload/t_cover_small_2x/co1n7l.jpg',
			subtitle: 'Bungie',
		});
	});
});

describe('mapIgdbDraft', () => {
	it('maps a game to a draft item', () => {
		const item = mapIgdbDraft(game);
		expect(item.id).toBe('game-igdb-1020');
		expect(item.creator).toBe('Bungie'); // developer only
		expect(item.release_date).toBe('2001-11-21'); // unix → ISO
		expect(item.community_rating).toBe(8.85); // 88.5 / 10, rounded to 2dp
		expect(item.tags).toStrictEqual(['shooter', 'action', 'science fiction']);
		expect(item.cover).toBe(
			'https://images.igdb.com/igdb/image/upload/t_cover_big_2x/co1n7l.jpg',
		);
		expect(item.backdrop).toBe(
			'https://images.igdb.com/igdb/image/upload/t_1080p_2x/ar1.jpg',
		); // prefers key art
		expect(item.metadata).toStrictEqual({}); // platform is user-set
		expect(item.provider).toBe('igdb');
	});

	it('falls back to a screenshot when there is no key art', () => {
		const item = mapIgdbDraft({ ...game, artworks: [] });
		expect(item.backdrop).toBe(
			'https://images.igdb.com/igdb/image/upload/t_1080p_2x/sc1.jpg',
		);
	});

	it('omits the backdrop when there is no key art or screenshot', () => {
		const item = mapIgdbDraft({ ...game, artworks: [], screenshots: [] });
		expect(item.backdrop).toBeUndefined();
	});

	it('maps a completion time (seconds) to length in whole hours', () => {
		const item = mapIgdbDraft(game, 27000); // 7.5h → 8h
		expect(item).toHaveLength(8);
		expect(item.length_unit).toBe('hours');
	});

	it('leaves length unset when there is no completion time', () => {
		const item = mapIgdbDraft(game);
		expect(item.length).toBeUndefined();
		expect(item.length_unit).toBeUndefined();
	});

	it('leaves length unset when the completion time is zero', () => {
		const item = mapIgdbDraft(game, 0);
		expect(item.length).toBeUndefined();
	});
});

describe('pickTimeToBeat', () => {
	const h = (hours: number) => hours * 3600; // stats are stored in seconds

	it('returns the chosen stat', () => {
		expect(pickTimeToBeat({ normally: h(20) }, 'normally')).toBe(h(20));
	});

	it('returns undefined when the chosen stat is absent', () => {
		expect(pickTimeToBeat({ normally: h(20) }, 'completely')).toBeUndefined();
	});

	it('returns undefined for a missing record', () => {
		expect(pickTimeToBeat(undefined, 'normally')).toBeUndefined();
	});

	it('keeps completely within 3× normally', () => {
		// Elden Ring: 174h completely vs 121h normally — sane.
		expect(
			pickTimeToBeat({ normally: h(121), completely: h(174) }, 'completely'),
		).toBe(h(174));
	});

	it('keeps completely at exactly 3× normally (boundary)', () => {
		expect(
			pickTimeToBeat({ normally: h(40), completely: h(120) }, 'completely'),
		).toBe(h(120));
	});

	it('discards completely above 3× normally', () => {
		// Baldur's Gate III: 6141h completely vs 134h normally — garbage outlier.
		expect(
			pickTimeToBeat({ normally: h(134), completely: h(6141) }, 'completely'),
		).toBeUndefined();
	});

	it('keeps completely when normally is absent (nothing to check against)', () => {
		expect(pickTimeToBeat({ completely: h(6141) }, 'completely')).toBe(h(6141));
	});

	it('does not guard hastily or normally', () => {
		// The outlier guard is completely-only; normally is trusted as-is.
		expect(pickTimeToBeat({ normally: h(500) }, 'normally')).toBe(h(500));
		expect(
			pickTimeToBeat({ normally: h(10), hastily: h(900) }, 'hastily'),
		).toBe(h(900));
	});
});

describe('pickBackdropId', () => {
	it('prefers key art without logo over key art with logo', () => {
		const artworks = [
			{ image_id: 'withLogo', artwork_type: 3, width: 1920, height: 1080 },
			{ image_id: 'noLogo', artwork_type: 2, width: 1000, height: 700 },
		];
		expect(pickBackdropId(artworks, [{ image_id: 'sc' }])).toBe('noLogo');
	});

	it('uses key art with logo when there is no logoless key art', () => {
		const artworks = [
			{ image_id: 'withLogo', artwork_type: 3, width: 1920, height: 1080 },
		];
		expect(pickBackdropId(artworks, [{ image_id: 'sc' }])).toBe('withLogo');
	});

	it('picks the largest key art within the same type', () => {
		const artworks = [
			{ image_id: 'small', artwork_type: 2, width: 800, height: 450 },
			{ image_id: 'big', artwork_type: 2, width: 3840, height: 2160 },
		];
		expect(pickBackdropId(artworks, undefined)).toBe('big');
	});

	it('ignores logos, covers, concept art, and generic artwork', () => {
		const artworks = [
			{ image_id: 'logo', artwork_type: 7, width: 1920, height: 1080 }, // game logo (color)
			{ image_id: 'cover', artwork_type: 11, width: 2160, height: 2160 }, // square cover
			{ image_id: 'concept', artwork_type: 4, width: 1920, height: 1080 }, // concept art
			{ image_id: 'generic', artwork_type: 1, width: 1920, height: 1080 }, // generic artwork
		];
		// None are key art, so it falls through to the screenshot.
		expect(pickBackdropId(artworks, [{ image_id: 'sc' }])).toBe('sc');
	});

	it('falls back to the first screenshot, then undefined', () => {
		expect(pickBackdropId([], [{ image_id: 'sc' }])).toBe('sc');
		expect(pickBackdropId(undefined, undefined)).toBeUndefined();
		expect(pickBackdropId([], [])).toBeUndefined();
	});
});

describe('rankIgdbGames', () => {
	const named = (
		id: number,
		name: string,
		total_rating_count?: number,
	): IgdbGame => ({ id, name, total_rating_count });

	const names = (games: IgdbGame[]) => games.map((g) => g.id);

	it('breaks ties between equal-name matches by popularity', () => {
		// IGDB returns the obscure 1995 game first; popularity should reorder it.
		const games = [named(1, 'Hades', 3), named(2, 'Hades', 900)];
		expect(names(rankIgdbGames(games, 'Hades'))).toEqual([2, 1]);
	});

	it('keeps closer name matches ahead of more popular incidental ones', () => {
		// A popular sibling must not displace the exact title the user typed.
		const games = [named(1, 'Hades', 900), named(2, 'Hades II', 10)];
		expect(names(rankIgdbGames(games, 'Hades II'))).toEqual([2, 1]);
	});

	it('orders exact over prefix over substring matches', () => {
		const games = [
			named(3, 'Super Mario Odyssey'),
			named(2, 'Mario Kart'),
			named(1, 'Mario'),
		];
		expect(names(rankIgdbGames(games, 'Mario'))).toEqual([1, 2, 3]);
	});

	it('preserves IGDB order when tier and popularity are equal (stable)', () => {
		const games = [named(1, 'Doom'), named(2, 'Doom')];
		expect(names(rankIgdbGames(games, 'Doom'))).toEqual([1, 2]);
	});

	it('is case- and whitespace-insensitive on the query', () => {
		const games = [named(1, 'Halo', 5), named(2, 'Halo', 50)];
		expect(names(rankIgdbGames(games, '  hALo  '))).toEqual([2, 1]);
	});
});
