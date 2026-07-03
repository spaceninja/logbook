import { describe, expect, it } from 'vitest';
import { parseCsv, parseCsvRecords } from './csv';

describe('parseCsv', () => {
	it('parses a simple grid', () => {
		expect(parseCsv('a,b,c\n1,2,3')).toStrictEqual([
			['a', 'b', 'c'],
			['1', '2', '3'],
		]);
	});

	it('keeps commas inside quoted fields', () => {
		expect(
			parseCsv(
				'Title,Author\n"System Collapse (The Murderbot Diaries, #7)",Wells',
			),
		).toStrictEqual([
			['Title', 'Author'],
			['System Collapse (The Murderbot Diaries, #7)', 'Wells'],
		]);
	});

	it('unescapes doubled quotes', () => {
		// Goodreads writes ISBNs as the Excel text-guard `="1250826985"`.
		expect(parseCsv('ISBN\n"=""1250826985"""')).toStrictEqual([
			['ISBN'],
			['="1250826985"'],
		]);
	});

	it('preserves newlines inside a quoted field', () => {
		expect(parseCsv('Review\n"line one\nline two"')).toStrictEqual([
			['Review'],
			['line one\nline two'],
		]);
	});

	it('handles CRLF line endings', () => {
		expect(parseCsv('a,b\r\n1,2\r\n')).toStrictEqual([
			['a', 'b'],
			['1', '2'],
		]);
	});

	it('strips a leading BOM from the first cell', () => {
		expect(parseCsv('﻿a,b\n1,2')[0]).toStrictEqual(['a', 'b']);
	});

	it('does not emit a trailing empty row for a final newline', () => {
		expect(parseCsv('a\n1\n')).toStrictEqual([['a'], ['1']]);
	});
});

describe('parseCsvRecords', () => {
	it('keys each row by the header', () => {
		expect(parseCsvRecords('Name,Year\nMegamind,2010')).toStrictEqual([
			{ Name: 'Megamind', Year: '2010' },
		]);
	});

	it('returns an empty array for empty input', () => {
		expect(parseCsvRecords('')).toStrictEqual([]);
	});

	it('skips fully blank lines', () => {
		expect(parseCsvRecords('Name\nA\n\nB')).toStrictEqual([
			{ Name: 'A' },
			{ Name: 'B' },
		]);
	});

	it('fills missing trailing cells with empty strings', () => {
		expect(parseCsvRecords('a,b,c\n1,2')).toStrictEqual([
			{ a: '1', b: '2', c: '' },
		]);
	});
});
