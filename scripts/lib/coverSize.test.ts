import { afterEach, describe, expect, it, vi } from 'vitest';
import { coverWidth } from './coverSize';

/** A minimal PNG head: signature, IHDR length/type, then width and height. */
function png(width: number, height: number): Buffer {
	const buffer = Buffer.alloc(24);
	buffer.writeUInt32BE(0x89504e47, 0);
	buffer.writeUInt32BE(0x0d0a1a0a, 4);
	buffer.writeUInt32BE(13, 8);
	buffer.write('IHDR', 12, 'ascii');
	buffer.writeUInt32BE(width, 16);
	buffer.writeUInt32BE(height, 20);
	return buffer;
}

/**
 * A minimal JPEG head: SOI, then the given segments, each `FF <marker>` with a
 * two-byte length. An SOF segment's payload is precision, height, width.
 */
function jpeg(segments: { marker: number; payload: Buffer }[]): Buffer {
	const parts = [Buffer.from([0xff, 0xd8])];
	for (const { marker, payload } of segments) {
		const header = Buffer.alloc(4);
		header.writeUInt8(0xff, 0);
		header.writeUInt8(marker, 1);
		header.writeUInt16BE(payload.length + 2, 2);
		parts.push(header, payload);
	}
	return Buffer.concat(parts);
}

/** An SOF payload for the given dimensions (1 precision byte, height, width). */
function frame(width: number, height: number): Buffer {
	const payload = Buffer.alloc(6);
	payload.writeUInt8(8, 0);
	payload.writeUInt16BE(height, 1);
	payload.writeUInt16BE(width, 3);
	return payload;
}

/** Stub `fetch` with one response carrying the given body. */
function stubFetch(body: Buffer, ok = true): void {
	vi.stubGlobal(
		'fetch',
		vi.fn().mockResolvedValue({
			ok,
			arrayBuffer: () =>
				Promise.resolve(
					body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
				),
		}),
	);
}

describe('coverWidth', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('reads the width from a PNG IHDR', async () => {
		stubFetch(png(1125, 1787));
		expect(await coverWidth('https://example/cover.png')).toBe(1125);
	});

	it('reads the width from a JPEG start-of-frame', async () => {
		stubFetch(jpeg([{ marker: 0xc0, payload: frame(640, 1017) }]));
		expect(await coverWidth('https://example/cover.jpg')).toBe(640);
	});

	it('skips preceding segments to find the frame header', async () => {
		stubFetch(
			jpeg([
				{ marker: 0xe0, payload: Buffer.alloc(14) }, // JFIF APP0
				{ marker: 0xdb, payload: Buffer.alloc(65) }, // quantization table
				{ marker: 0xc0, payload: frame(313, 500) },
			]),
		);
		expect(await coverWidth('https://example/small.jpg')).toBe(313);
	});

	it('does not mistake a Huffman table for a frame header', async () => {
		stubFetch(
			jpeg([
				{ marker: 0xc4, payload: Buffer.alloc(30) }, // DHT, inside C0-CF
				{ marker: 0xc2, payload: frame(938, 1500) }, // progressive SOF2
			]),
		);
		expect(await coverWidth('https://example/progressive.jpg')).toBe(938);
	});

	it('requests only the first 3KB', async () => {
		stubFetch(jpeg([{ marker: 0xc0, payload: frame(640, 960) }]));
		await coverWidth('https://example/cover.jpg');
		expect(fetch).toHaveBeenCalledWith('https://example/cover.jpg', {
			headers: { Range: 'bytes=0-3071' },
		});
	});

	it('returns undefined for a non-2xx response', async () => {
		stubFetch(Buffer.alloc(0), false);
		expect(await coverWidth('https://example/missing.jpg')).toBeUndefined();
	});

	it('returns undefined for an unrecognized format', async () => {
		stubFetch(Buffer.from('GIF89a...'));
		expect(await coverWidth('https://example/cover.gif')).toBeUndefined();
	});

	it('returns undefined when no frame header fits in the window', async () => {
		stubFetch(jpeg([{ marker: 0xe0, payload: Buffer.alloc(4000) }]));
		expect(await coverWidth('https://example/huge-exif.jpg')).toBeUndefined();
	});

	it('returns undefined rather than throwing when the fetch fails', async () => {
		vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ENOTFOUND')));
		expect(await coverWidth('https://example/gone.jpg')).toBeUndefined();
	});
});
