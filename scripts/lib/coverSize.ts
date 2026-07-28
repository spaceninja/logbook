/**
 * Remote image dimensions without downloading the image (#69). The Goodreads sync
 * only prefers the feed's cover when it's genuinely high-res, and there's no way to
 * know that from the URL: Goodreads serves art off Amazon's CDN, where the
 * `._SX640_` directive is a ceiling rather than a target — ask for 640 from a
 * 313×500 original and you get 313×500 back. The directive is present on large and
 * small originals alike, so the width has to be measured.
 *
 * The CDN honors range requests, and both formats put their dimensions in a header
 * near the start of the file, so 3KB is enough to read them.
 */

/** Bytes to request — comfortably past the JPEG frame header on the covers seen. */
const HEAD_BYTES = 3072;

/** Width from a PNG's IHDR chunk, which always begins at byte 16. */
function pngWidth(buffer: Buffer): number | undefined {
	if (buffer.length < 24) return undefined;
	return buffer.readUInt32BE(16);
}

/**
 * Width from a JPEG's start-of-frame marker. Walks the segment chain (each
 * `FF xx` marker followed by a two-byte length) looking for any SOF marker.
 * `C4` (Huffman table), `C8` (JPEG extensions) and `CC` (arithmetic coding
 * conditioning) share the `C0`–`CF` range but are not frame headers.
 */
function jpegWidth(buffer: Buffer): number | undefined {
	let offset = 2; // skip the SOI marker
	while (offset + 9 < buffer.length) {
		if (buffer[offset] !== 0xff) {
			offset++;
			continue;
		}
		const marker = buffer[offset + 1]!;
		if (
			marker >= 0xc0 &&
			marker <= 0xcf &&
			marker !== 0xc4 &&
			marker !== 0xc8 &&
			marker !== 0xcc
		) {
			return buffer.readUInt16BE(offset + 7);
		}
		const length = buffer.readUInt16BE(offset + 2);
		if (length < 2) return undefined; // malformed segment; give up
		offset += 2 + length;
	}
	return undefined;
}

/**
 * The pixel width of a remote JPEG or PNG, or undefined when it can't be
 * determined — an unreachable host, a non-2xx response, an unrecognized format, or
 * a frame header past the fetched window. Callers treat undefined as "unverified"
 * and fall back rather than failing, so this never throws.
 */
export async function coverWidth(url: string): Promise<number | undefined> {
	let buffer: Buffer;
	try {
		const response = await fetch(url, {
			headers: { Range: `bytes=0-${HEAD_BYTES - 1}` },
		});
		// 206 for a served range, 200 when the server ignored it and sent the whole
		// file; anything else (404, 403, 5xx) has no image to measure.
		if (!response.ok) return undefined;
		buffer = Buffer.from(await response.arrayBuffer());
	} catch {
		return undefined;
	}

	if (buffer.length < 4) return undefined;
	if (buffer[0] === 0x89 && buffer[1] === 0x50) return pngWidth(buffer);
	if (buffer[0] === 0xff && buffer[1] === 0xd8) return jpegWidth(buffer);
	return undefined;
}
