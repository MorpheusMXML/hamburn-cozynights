import zlib from 'zlib';

/**
 * A black-and-white PNG from a pixel matrix (true = black), one bit per pixel.
 * Enough for QR codes: the Telegram bot sends the booking pass's QR code as a
 * photo, and Telegram takes PNG and JPEG, not the GIF the pass page offers.
 */
export function encodeMonochromePng(pixels: boolean[][]): Buffer {
	const height = pixels.length;
	const width = height > 0 ? pixels[0].length : 0;
	if (width === 0 || height === 0) throw new Error('empty image');

	// Every row: filter type 0, then the row packed 8 pixels per byte. In a
	// 1-bit greyscale PNG a set bit is white, so black pixels stay 0.
	const rowBytes = Math.ceil(width / 8);
	const raw = Buffer.alloc((rowBytes + 1) * height);
	for (let y = 0; y < height; y++) {
		const row = pixels[y];
		const offset = y * (rowBytes + 1) + 1;
		for (let x = 0; x < width; x++) {
			if (!row[x]) raw[offset + (x >> 3)] |= 0x80 >> (x & 7);
		}
	}

	const header = Buffer.alloc(13);
	header.writeUInt32BE(width, 0);
	header.writeUInt32BE(height, 4);
	header[8] = 1; // bit depth
	header[9] = 0; // greyscale
	header[10] = 0; // deflate
	header[11] = 0; // adaptive filtering
	header[12] = 0; // no interlace

	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk('IHDR', header),
		chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
		chunk('IEND', Buffer.alloc(0))
	]);
}

function chunk(type: string, data: Buffer): Buffer {
	const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
	const length = Buffer.alloc(4);
	length.writeUInt32BE(data.length, 0);
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(zlib.crc32(typeAndData), 0);
	return Buffer.concat([length, typeAndData, crc]);
}
