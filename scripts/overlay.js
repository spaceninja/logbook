// Pure, deterministic "lived-in" overlay applied on top of a real provider draft
// (see docs/specs/2026-06-27-representative-sample-dataset.md §4). All randomness
// is seeded by the item id so regeneration is stable across runs.

export const TODAY = '2026-06-27';
const RECENT_YEARS = [2024, 2025, 2026];

/** Deterministic PRNG seeded by a string (cyrb53 hash → mulberry32). */
export function makeRng(seedStr) {
  let h1 = 0xdeadbeef ^ seedStr.length;
  let h2 = 0x41c6ce57 ^ seedStr.length;
  for (let i = 0; i < seedStr.length; i++) {
    const ch = seedStr.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 =
    Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^
    Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 =
    Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^
    Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  let seed = (h2 >>> 0) ^ (h1 >>> 0);
  return function rng() {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pad = (n) => String(n).padStart(2, '0');
const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];

/** Random YYYY-MM-DD within `year`, clamped to [minDate, maxDate] inclusive. */
export function randomDateInYear(rng, year, { minDate, maxDate } = {}) {
  let lo = Date.UTC(year, 0, 1);
  let hi = Date.UTC(year, 11, 31);
  if (minDate) lo = Math.max(lo, Date.parse(minDate));
  if (maxDate) hi = Math.min(hi, Date.parse(maxDate));
  if (hi < lo) hi = lo;
  const d = new Date(lo + Math.floor(rng() * (hi - lo + 1)));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** De-duplicated ascending years from ISO date strings (mirrors deriveCompletedYears). */
export function deriveYears(dates) {
  return [...new Set(dates.map((d) => Number.parseInt(d.slice(0, 4), 10)))]
    .filter((y) => !Number.isNaN(y))
    .sort((a, b) => a - b);
}

/** Completion year for a completed/repeat item under the hybrid model (§4.1). */
export function completionYearFor(releaseYear, rng) {
  if (releaseYear >= 2024 && releaseYear <= 2025) return releaseYear;
  if (releaseYear <= 2023) {
    // A minority keep their original release year, giving the per-type year
    // switcher divergent tails instead of a uniform 2024–2026 for everyone.
    if (rng() < 0.18) return releaseYear;
    return pick(rng, RECENT_YEARS);
  }
  return 2026; // future releases shouldn't be completed; safety fallback
}

/** Default state from release year when the manifest doesn't force one. */
export function deriveState(releaseYear) {
  if (releaseYear === undefined || releaseYear >= 2026) return 'backlog';
  return 'complete';
}

const NAMES = [
  'Priya',
  'Sam',
  'Tariq',
  'Chuck',
  'Mara',
  'Devin',
  'Lena',
  'Marcus',
  'Jo',
  'Renee',
];
const BACKLOG_NOTES = [
  'Everyone keeps telling me to get to this one.',
  'Bought it ages ago and still haven’t started.',
  'Saving this for a long weekend.',
  'Need to finish the previous one first.',
  'Heard the payoff is worth it.',
];
const DONE_NOTES = [
  'Better than I expected.',
  'Stuck with me for weeks.',
  'Would happily revisit this.',
  'A bit overhyped, but I enjoyed it.',
  'Instant favorite.',
];
const DNF_NOTES = [
  'Not for me — bailed partway.',
  'Couldn’t get into it.',
  'Gave it a fair shot and stopped.',
];

/**
 * Build the user-state fields for an item. Returns a partial Item to merge over
 * the provider draft. `state` is one of backlog | in_progress | complete | dnf |
 * repeat (repeat = finished but flagged to revisit, so it lands in both views).
 */
export function buildOverlay(draft, entry, rng) {
  const releaseYear = draft.release_date
    ? Number.parseInt(draft.release_date.slice(0, 4), 10)
    : undefined;
  const state = entry.state ?? deriveState(releaseYear);
  const minDate = draft.release_date;

  const out = {
    is_purchased: false,
    is_prioritized: false,
    completed_dates: [],
    completed_years: [],
  };

  const completedDates = () => {
    const year = completionYearFor(releaseYear ?? 2023, rng);
    const dates = [randomDateInYear(rng, year, { minDate, maxDate: TODAY })];
    // A few items were finished more than once.
    if (rng() < 0.12 && year > 2024) {
      dates.unshift(
        randomDateInYear(rng, year - 1, { minDate, maxDate: TODAY }),
      );
    }
    return dates.sort();
  };

  if (state === 'complete' || state === 'repeat') {
    out.completed_dates = completedDates();
    out.completed_years = deriveYears(out.completed_dates);
    out.my_rating = pick(rng, [8, 9, 10]);
    out.status =
      state === 'repeat'
        ? rng() < 0.5
          ? 'backlog'
          : 'in_progress'
        : 'complete';
  } else if (state === 'dnf') {
    const year = completionYearFor(releaseYear ?? 2023, rng);
    out.completed_dates = [
      randomDateInYear(rng, year, { minDate, maxDate: TODAY }),
    ];
    out.completed_years = deriveYears(out.completed_dates);
    out.status = 'dnf';
  } else if (state === 'in_progress') {
    out.status = 'in_progress';
  } else {
    out.status = 'backlog';
  }

  const inBacklog = out.status === 'backlog' || out.status === 'in_progress';
  out.is_purchased = rng() < (inBacklog ? 0.45 : 0.5);
  out.is_prioritized = inBacklog && rng() < 0.35;

  // Notes / recommended_by: manifest wins, else a seeded scatter.
  if (entry.recommended_by) out.recommended_by = entry.recommended_by;
  else if (inBacklog && rng() < 0.22) out.recommended_by = pick(rng, NAMES);

  if (entry.notes) out.notes = entry.notes;
  else if (rng() < 0.2) {
    if (out.status === 'dnf') out.notes = pick(rng, DNF_NOTES);
    else if (inBacklog) out.notes = pick(rng, BACKLOG_NOTES);
    else out.notes = pick(rng, DONE_NOTES);
  }

  // Series metadata from the manifest (franchises) when the draft lacks it.
  if (entry.series) {
    out.metadata = { ...draft.metadata };
    out.metadata.series = entry.series;
    if (entry.series_number !== undefined) {
      out.metadata.series_number = entry.series_number;
    }
  }

  return out;
}
