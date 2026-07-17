import JSZip from 'jszip';
import { parseGoodreads } from '~~/shared/import/goodreads';
import { parseInfiniteBacklog } from '~~/shared/import/infiniteBacklog';
import { parseLetterboxd } from '~~/shared/import/letterboxd';
import { parseTrakt } from '~~/shared/import/trakt';
import type { ImportFileMap, ServiceParser } from '~~/shared/import/types';

/**
 * Registered service parsers, in menu order. Adding a service to the importer is
 * just dropping its parser here (issue #20).
 */
export const IMPORT_SERVICES: ServiceParser[] = [
	{
		source: 'goodreads',
		label: 'Goodreads',
		parse: parseGoodreads,
	},
	{
		source: 'letterboxd',
		label: 'Letterboxd',
		parse: parseLetterboxd,
		// Most watched films were never diaried, and a Letterboxd account usually
		// opens with one big backfill — so "date added" would stamp thousands of
		// films with the same day. Each film's release date at least spreads them.
		defaultDateFallback: 'release',
	},
	{
		source: 'trakt',
		label: 'Trakt',
		parse: parseTrakt,
	},
	{
		source: 'infinite-backlog',
		label: 'Infinite Backlog',
		parse: parseInfiniteBacklog,
	},
];

/**
 * Expand an upload selection into `path → text`. `.zip` archives (Letterboxd,
 * Trakt) are unzipped in-browser; loose files (Goodreads, IB) are read directly
 * under their own name.
 *
 * Keyed by path, not basename: Letterboxd's zip carries `deleted/diary.csv` and
 * `orphaned/diary.csv` alongside the real `diary.csv`, and collapsing those to a
 * basename would let a (usually empty) copy silently shadow the diary and drop
 * every watch date. Any archive folder wrapping the export is stripped first, so
 * a parser sees the same paths whether the export was zipped or uploaded loose.
 */
export async function collectFiles(fileList: FileList): Promise<ImportFileMap> {
	const files: ImportFileMap = new Map();
	for (const file of Array.from(fileList)) {
		if (file.name.toLowerCase().endsWith('.zip')) {
			const zip = await JSZip.loadAsync(await file.arrayBuffer());
			const entries = Object.values(zip.files).filter((entry) => !entry.dir);
			const root = commonRoot(entries.map((entry) => entry.name));
			for (const entry of entries) {
				files.set(entry.name.slice(root.length), await entry.async('string'));
			}
		} else {
			files.set(file.name, await file.text());
		}
	}
	return files;
}

/**
 * The single top-level folder every archive entry sits under (`""` when the
 * entries are already at the root, as Letterboxd's export is). Zips that wrap
 * their contents in one folder are unwrapped so `diary.csv` is keyed as
 * `diary.csv`, not `letterboxd-2026-07-02/diary.csv`.
 */
function commonRoot(names: string[]): string {
	const first = names[0];
	if (!first?.includes('/')) return '';
	const root = `${first.split('/')[0]}/`;
	return names.every((name) => name.startsWith(root)) ? root : '';
}
