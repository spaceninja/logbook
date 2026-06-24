/**
 * Derives the `completed_years` field from `completed_dates`: the de-duplicated,
 * ascending set of calendar years. Firestore cannot extract a year from a date
 * string in a query, so the year is stored as a matchable value for the History
 * view (core design §3.2). Non-parseable dates are ignored.
 */
export function deriveCompletedYears(completedDates: string[]): number[] {
  const years = new Set<number>();

  for (const date of completedDates) {
    const year = Number.parseInt(date.slice(0, 4), 10);
    if (!Number.isNaN(year)) {
      years.add(year);
    }
  }

  return [...years].sort((a, b) => a - b);
}
