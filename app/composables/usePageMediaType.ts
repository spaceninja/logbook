import type { MaybeRefOrGetter } from 'vue';
import type { MediaType } from '~~/shared/types/item';
import { DEFAULT_MEDIA_TYPE, parseMediaType } from '~~/app/utils/viewLinks';

/**
 * The type a page published for the layout, for pages whose type isn't in the
 * URL. Prefer `useCurrentMediaType`, which layers the route on top.
 */
function usePublishedMediaType() {
	return useState<MediaType>('published-media-type', () => DEFAULT_MEDIA_TYPE);
}

/**
 * The media type the user is currently looking at, so the layout's nav can carry
 * it into the Backlog and History links (#128).
 *
 * The route wins when it names a type, and that ordering is load-bearing rather
 * than cosmetic. The nav lives in `layouts/default.vue`, which renders *before*
 * the page's setup runs — so on a type-scoped view, reading a published value
 * would give the server the default and the client (restoring state from the
 * payload) the real type. Vue only checks attribute mismatches on hydration, it
 * doesn't repair them, so the SSR `href` would stick and the link would show one
 * destination while navigating to another. Reading the route instead means both
 * renders agree.
 *
 * The published value covers what the route can't: an item page, whose type
 * comes from the item itself. That lands *after* hydration, which is an ordinary
 * reactive update and safe.
 */
export function useCurrentMediaType() {
	const route = useRoute();
	const published = usePublishedMediaType();
	return computed<MediaType>(
		() => parseMediaType(route.query.type) ?? published.value,
	);
}

/**
 * Publishes the page's media type for the layout. Pass a ref or getter — it's
 * tracked, so an item page's type lands once its read resolves.
 *
 * Unlike `usePageBackdrop` this deliberately does *not* clear on unmount: the
 * value is navigation context, not decoration. Wandering onto a page with no
 * type of its own (`/add`, `/sync`) should leave the nav pointing at the last
 * type the user was actually looking at, not snap it back to the default.
 */
export function usePageMediaType(
	source: MaybeRefOrGetter<MediaType | undefined>,
): void {
	const published = usePublishedMediaType();
	watchEffect(() => {
		const type = toValue(source);
		if (type) published.value = type;
	});
}
