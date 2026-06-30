import { useRouteQuery } from '@vueuse/router';
import type { WritableComputedRef } from 'vue';
import type { ParamCodec } from '~~/shared/utils/viewQuery';

/**
 * Binds one URL query param to a writable ref, so a view's filter/sort state is
 * reflected in (and restored from) the URL — making views bookmarkable (core
 * design §4). `@vueuse/router`'s `useRouteQuery` handles the route reactivity
 * (including back/forward); this layer adds the codec's validation and
 * default-omission, plus the push-vs-replace history `mode`.
 *
 * Reading returns the parsed value or the codec default; writing the default
 * removes the param (clean URLs). `mode: 'push'` makes a change a new browser
 * history entry (used for content type and History year); `'replace'` updates in
 * place (sort, direction, filters).
 */
export function useQueryParam<T>(
	param: string,
	codec: ParamCodec<T>,
	mode: 'push' | 'replace' = 'replace',
): WritableComputedRef<T> {
	const raw = useRouteQuery<string | string[] | null>(param, null, { mode });

	return computed<T>({
		get() {
			const value = Array.isArray(raw.value) ? raw.value[0] : raw.value;
			if (value == null) return codec.default;
			return codec.parse(value) ?? codec.default;
		},
		set(value) {
			raw.value = codec.serialize(value);
		},
	});
}
