import type { RouteLocationRaw } from 'vue-router';
import type { MediaType } from '~~/shared/types/item';

/**
 * Every media type, in the order the views' type switcher offers them. Also the
 * allow-list for a `type` read back out of a URL, which is why it lives beside
 * the link helpers rather than in each view.
 */
export const MEDIA_TYPES: MediaType[] = ['book', 'movie', 'show', 'game'];

/** A `type` query value from a URL, or undefined when it isn't a media type. */
export function parseMediaType(raw: unknown): MediaType | undefined {
	return typeof raw === 'string' && MEDIA_TYPES.includes(raw as MediaType)
		? (raw as MediaType)
		: undefined;
}

/**
 * The media type the type-scoped views (`/`, `/history`, `/search`) show when
 * the URL says nothing. It's the codec default those views bind `type` to, so
 * `enumParam` serializes it back to *no param at all* — which means a link to
 * this type must omit `type` too, or it would produce a `?type=book` URL the
 * app itself never writes.
 */
export const DEFAULT_MEDIA_TYPE: MediaType = 'book';

/**
 * The `type` query for a type-scoped view — empty for the default, so callers
 * can spread it beside their own params without special-casing.
 */
export function mediaTypeQuery(type: MediaType): { type?: MediaType } {
	return type === DEFAULT_MEDIA_TYPE ? {} : { type };
}

/**
 * A link to a type-scoped view, carrying the media type the user is currently
 * looking at (#128). Clicking History from the game backlog should land on the
 * game history, not silently reset to books.
 */
export function viewLink(path: string, type: MediaType): RouteLocationRaw {
	return type === DEFAULT_MEDIA_TYPE ? path : { path, query: { type } };
}
