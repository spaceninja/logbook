import JSZip from 'jszip';
import { parseInfiniteBacklog } from '~~/shared/import/infiniteBacklog';
import type { ImportFileMap, ServiceParser } from '~~/shared/import/types';

/**
 * Registered service parsers, in menu order. Adding a service to the importer is
 * just dropping its parser here (issue #20).
 */
export const IMPORT_SERVICES: ServiceParser[] = [
	{
		source: 'infinite-backlog',
		label: 'Infinite Backlog',
		parse: parseInfiniteBacklog,
	},
];

/**
 * Expand an upload selection into `basename → text`. `.zip` archives (Letterboxd,
 * Trakt) are unzipped in-browser; loose files (Goodreads, IB) are read directly.
 * Keyed by basename so parsers match files the same way regardless of source.
 */
export async function collectFiles(fileList: FileList): Promise<ImportFileMap> {
	const files: ImportFileMap = new Map();
	for (const file of Array.from(fileList)) {
		if (file.name.toLowerCase().endsWith('.zip')) {
			const zip = await JSZip.loadAsync(await file.arrayBuffer());
			for (const entry of Object.values(zip.files)) {
				if (entry.dir) continue;
				const base = entry.name.split('/').pop();
				if (base) files.set(base, await entry.async('string'));
			}
		} else {
			files.set(file.name, await file.text());
		}
	}
	return files;
}
