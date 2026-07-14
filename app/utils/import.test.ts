import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { collectFiles } from './import';

/**
 * `collectFiles` only ever touches `name`, `arrayBuffer()` and `text()`, so these
 * stand in for real `File`s without depending on jsdom's Blob implementation.
 */
function zipFile(name: string, entries: Record<string, string>): File {
	const zip = new JSZip();
	for (const [path, text] of Object.entries(entries)) zip.file(path, text);
	return {
		name,
		arrayBuffer: () => zip.generateAsync({ type: 'arraybuffer' }),
	} as unknown as File;
}

function looseFile(name: string, text: string): File {
	return { name, text: async () => text } as unknown as File;
}

function fileList(...files: File[]): FileList {
	return files as unknown as FileList;
}

describe('collectFiles', () => {
	it('keeps a nested copy from shadowing the file it shares a name with', async () => {
		// Letterboxd ships deleted/orphaned copies of diary.csv beside the real one.
		// Keyed by basename, an empty copy would silently replace every watch date.
		const files = await collectFiles(
			fileList(
				zipFile('letterboxd-2026-07-02.zip', {
					'diary.csv': 'Date,Name\n2021-12-23,Megamind',
					'deleted/diary.csv': 'Date,Name',
					'orphaned/diary.csv': 'Date,Name',
				}),
			),
		);

		expect([...files.keys()].sort()).toStrictEqual([
			'deleted/diary.csv',
			'diary.csv',
			'orphaned/diary.csv',
		]);
		expect(files.get('diary.csv')).toContain('Megamind');
	});

	it('unwraps an archive whose entries sit in one top-level folder', async () => {
		const files = await collectFiles(
			fileList(
				zipFile('export.zip', {
					'letterboxd-spaceninja/watched.csv': 'Date,Name',
					'letterboxd-spaceninja/likes/films.csv': 'Date,Name',
				}),
			),
		);

		expect([...files.keys()].sort()).toStrictEqual([
			'likes/films.csv',
			'watched.csv',
		]);
	});

	it('reads loose files under their own names', async () => {
		const files = await collectFiles(
			fileList(
				looseFile('watched.csv', 'Date,Name'),
				looseFile('diary.csv', 'Date,Name'),
			),
		);

		expect([...files.keys()].sort()).toStrictEqual([
			'diary.csv',
			'watched.csv',
		]);
	});
});
