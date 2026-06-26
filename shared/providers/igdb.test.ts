import { describe, expect, it } from 'vitest';
import { mapIgdbDraft, mapIgdbSearch, type IgdbGame } from './igdb';

const game: IgdbGame = {
  id: 1020,
  name: 'Halo: Combat Evolved',
  first_release_date: 1006300800, // 2001-11-21
  summary: 'Master Chief…',
  rating: 88.5,
  cover: { image_id: 'co1n7l' },
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
      thumbnail: 'https://images.igdb.com/igdb/image/upload/t_thumb/co1n7l.jpg',
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
      'https://images.igdb.com/igdb/image/upload/t_cover_big/co1n7l.jpg',
    );
    expect(item.metadata).toStrictEqual({}); // platform is user-set
    expect(item.provider).toBe('igdb');
  });
});
