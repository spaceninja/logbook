import type { MaybeRefOrGetter } from 'vue';

/**
 * A page's backdrop image, shared with the layout so `<main>` can paint it.
 *
 * The `<main>` element lives in `layouts/default.vue`, not in the page, so a page
 * can't set the property directly. Instead the page publishes a URL here and
 * `layouts/default.vue` binds it as the `--backdrop` custom property on
 * `<main>`; CSS elsewhere decides what (if anything) to do with it.
 */
export function useBackdrop() {
	return useState<string | null>('page-backdrop', () => null);
}

/**
 * Publishes a page's backdrop image URL for the layout. Pass a ref or getter —
 * it's tracked, so the backdrop lands whenever the source resolves (item data is
 * read client-side). The value is a ready-to-use CSS `url()`, or `null` when the
 * page has no backdrop.
 */
export function usePageBackdrop(
	source: MaybeRefOrGetter<string | null | undefined>,
): void {
	const backdrop = useBackdrop();
	let published: string | null = null;

	watchEffect(() => {
		const url = toValue(source);
		// Quotes, backslashes, and whitespace are all percent-encoded by encodeURI,
		// so the URL can't break out of the quoted url() token.
		published = url ? `url("${encodeURI(url)}")` : null;
		backdrop.value = published;
	});

	// Leaving the page drops the backdrop — but only if the incoming page hasn't
	// already set its own, since its setup runs before this one unmounts.
	onScopeDispose(() => {
		if (backdrop.value === published) backdrop.value = null;
	});
}
