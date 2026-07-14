/**
 * The unified item schema. Every tracked thing — a book, a movie, a season of a
 * show, or a game — is one `Item` stored as a single Firestore document in the
 * `items` collection (document id = `Item.id`). See the core design doc, §3.
 */

export type MediaType = 'book' | 'movie' | 'show' | 'game';

/**
 * Current intent. Backlog view = `backlog` | `in_progress`; History view is
 * date-driven (any item with a completion date), so `complete` and `dnf` both
 * appear there when dated — `dnf` (did not finish) only differs visually.
 */
export type ItemStatus = 'backlog' | 'in_progress' | 'complete' | 'dnf';

export type LengthUnit = 'pages' | 'min' | 'episodes' | 'hours';

/**
 * Where an item's id (and usually its metadata) comes from. `letterboxd` is an
 * id-only provider: the bulk importer matches Letterboxd films to TMDB, but the
 * handful TMDB doesn't carry (miniseries Letterboxd files as films) are kept
 * under a Letterboxd id so they still import and still de-duplicate on re-import.
 */
export type Provider =
	| 'tmdb'
	| 'igdb'
	| 'goodreads'
	| 'google-books'
	| 'open-library'
	| 'letterboxd'
	| 'manual';

export interface BookMetadata {
	series?: string;
	series_number?: number;
	isbn?: string;
	/**
	 * Google Books volume id — the handle for refreshing a book's metadata or
	 * switching which edition it's sourced from. Books identify by a different
	 * provider than they enrich from (id is the Goodreads Book Id; metadata comes
	 * from Google Books), so unlike other media the refresh key can't be recovered
	 * from the item id and is stored here instead (like a show's `show_tmdb_id`).
	 */
	google_books_id?: string;
}

// Movies carry only optional series/franchise info; `creator` holds the director.
export interface MovieMetadata {
	/** Franchise/series name (e.g. "The Lord of the Rings"). */
	series?: string;
	series_number?: number;
}

export interface ShowMetadata {
	show_tmdb_id: number;
	season_number: number;
	episode_count: number;
	episode_runtime: number;
	/**
	 * The season's own name when it differs from the generic "Season N" (e.g.
	 * "Book One: Water"). Recorded for display; not used for sorting/filtering.
	 */
	season_title?: string;
}

export interface GameMetadata {
	platform?: string;
	/** Franchise/series name (e.g. "The Legend of Zelda"). */
	series?: string;
	series_number?: number;
}

export type ItemMetadata =
	BookMetadata | MovieMetadata | ShowMetadata | GameMetadata;

export interface Item {
	/** Unique id; also the Firestore document id. */
	id: string;
	type: MediaType;
	title: string;
	/** Unified author | director | created_by | developer. */
	creator?: string | string[];
	/**
	 * Surname-first sort key for the "creator" sort, since `creator` is a display
	 * string with no structured last name. Auto-derived at add/save time
	 * (see `deriveCreatorSort`) but editable so awkward names ("Le Guin", particles)
	 * can be hand-fixed. Absent on legacy docs; the comparator re-derives a fallback.
	 */
	creator_sort?: string;
	/** Large image for the detail view. */
	cover?: string;
	/** Small image for list views. */
	thumbnail?: string;
	/** Large landscape art (16:9) for the detail view. Movies/shows/games only. */
	backdrop?: string;
	/** ISO date; for shows, the season air date. */
	release_date?: string;
	description?: string;
	/** Numeric size of the work, paired with `length_unit`. */
	length?: number;
	length_unit?: LengthUnit;
	/**
	 * Aggregate rating from the provider, normalized to a 0–10 scale (matching
	 * `my_rating`). Sources are normalized at the boundary: Goodreads (0–5) ×2,
	 * TMDB (0–10) as-is, IGDB (0–100) ÷10.
	 */
	community_rating?: number;
	/** The owner's rating, on a 0–10 scale. */
	my_rating?: number;
	provider?: Provider;
	recommended_by?: string;
	/** Current intent only; History membership is driven by `completed_dates`. */
	status: ItemStatus;
	is_purchased: boolean;
	is_prioritized: boolean;
	/** One ISO date per completion. */
	completed_dates: string[];
	/** Derived from `completed_dates`; enables History year queries. */
	completed_years: number[];
	notes?: string;
	tags: string[];
	metadata: ItemMetadata;
}
