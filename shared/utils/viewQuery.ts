/**
 * Parse/serialize codecs for single URL query params, used by `useViewQuery` to
 * bind a view's filter/sort state to the query string (core design §4). Each
 * codec validates on parse (unknown/invalid → `undefined`, so the default is
 * used) and omits the param when the value equals its default (`serialize`
 * returns `null`) to keep URLs clean.
 */
export interface ParamCodec<T> {
	/** Value when the param is absent or invalid. */
	default: T;
	/** Raw query string → typed value, or `undefined` when invalid. */
	parse: (raw: string) => T | undefined;
	/** Typed value → query string, or `null` to omit the param. */
	serialize: (value: T) => string | null;
}

/** One of a fixed set of string values (e.g. media type, sort key, filter state). */
export function enumParam<T extends string>(
	allowed: readonly T[],
	def: T,
): ParamCodec<T> {
	return {
		default: def,
		parse: (raw) => (allowed.includes(raw as T) ? (raw as T) : undefined),
		serialize: (value) => (value === def ? null : value),
	};
}

/** A boolean flag encoded as `1` (true) / absent (false by default). */
export function flagParam(def = false): ParamCodec<boolean> {
	return {
		default: def,
		parse: (raw) => (raw === '1' ? true : raw === '0' ? false : undefined),
		serialize: (value) => (value === def ? null : value ? '1' : '0'),
	};
}

/**
 * A calendar year, or `null` when absent. Unlike the others its "default" is not
 * a concrete year — absence means "use the newest available" (resolved by the
 * page), so the default is `null` and any positive integer is valid.
 */
export function yearParam(): ParamCodec<number | null> {
	return {
		default: null,
		parse: (raw) => {
			const n = Number(raw);
			return Number.isInteger(n) && n > 0 ? n : undefined;
		},
		serialize: (value) => (value == null ? null : String(value)),
	};
}
