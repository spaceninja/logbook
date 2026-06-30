import { describe, expect, it } from 'vitest';
import {
	mapIgdbDraft,
	mapIgdbSearch,
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
	artworks: [{ image_id: 'ar1' }],
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
		); // prefers artwork
		expect(item.metadata).toStrictEqual({}); // platform is user-set
		expect(item.provider).toBe('igdb');
	});

	it('falls back to a screenshot when there is no artwork', () => {
		const item = mapIgdbDraft({ ...game, artworks: [] });
		expect(item.backdrop).toBe(
			'https://images.igdb.com/igdb/image/upload/t_1080p_2x/sc1.jpg',
		);
	});

	it('omits the backdrop when there is no artwork or screenshot', () => {
		const item = mapIgdbDraft({ ...game, artworks: [], screenshots: [] });
		expect(item.backdrop).toBeUndefined();
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
