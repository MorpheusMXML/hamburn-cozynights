/// <reference path="../../pb_data/types.d.ts" />
//
// The booking pass's QR code as a PNG, drawn inside PocketBase for the guest
// e-mails (pb_hooks/lib/notify.js): the picture travels in the mail itself, so
// it shows with remote images blocked and needs no request to the app.
//
// Same library and options as passQrPng in src/lib/server/pass.ts (the pass's
// qr.png, Telegram's photo): ecc medium, border 4, 10 pixels per module.
// tests/pass-qr-hook.test.ts keeps the two pixel-identical. The library is the
// app's own `qr`, bundled by npm run vendor:pb-qr (lib/vendor/qr.js).
//
// A 1-bit greyscale PNG like src/lib/server/png.ts, but the image data goes
// into stored (uncompressed) deflate blocks: the JSVM has no zlib. That is
// about 22 KB instead of 600 bytes, fine for one picture in an e-mail.

const QR = require(`${__hooks}/lib/vendor/qr.js`);

// A pass link on the camp's host is 41 modules wide with its border: 410 px,
// which the e-mail shows at 205 px, sharp on a retina screen.
const PASS_QR_SCALE = 10;
// Stored deflate blocks hold at most this many bytes each.
const STORED_BLOCK = 65535;
const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** UTF-8 bytes of a string; qr's default needs TextEncoder, which the JSVM lacks. */
function utf8(text) {
	const out = [];
	for (let i = 0; i < text.length; i++) {
		let c = text.charCodeAt(i);
		if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length) {
			c = 0x10000 + ((c - 0xd800) << 10) + (text.charCodeAt(++i) - 0xdc00);
		}
		if (c < 0x80) out.push(c);
		else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
		else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
		else {
			out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
		}
	}
	return new Uint8Array(out);
}

let crcTable = null;
function crc32(bytes, from, to) {
	if (!crcTable) {
		crcTable = new Uint32Array(256);
		for (let n = 0; n < 256; n++) {
			let c = n;
			for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
			crcTable[n] = c >>> 0;
		}
	}
	let c = 0xffffffff;
	for (let i = from; i < to; i++) c = crcTable[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
}

/**
 * The QR code of `url` as PNG bytes: a plain array of numbers, which is what
 * $filesystem.fileFromBytes takes. `scale`: pixels per module.
 */
function passQrPng(url, scale) {
	const s = scale || PASS_QR_SCALE;
	// one pixel per module here; the rows below draw each one s × s
	const m = QR.encodeQR(String(url), 'raw', {
		ecc: 'medium',
		border: 4,
		scale: 1,
		textEncoder: utf8
	});
	const modules = m.length;
	const w = modules * s;
	const rowBytes = Math.ceil(w / 8);
	// Every row: filter type 0, then the row packed 8 pixels per byte. In a
	// 1-bit greyscale PNG a set bit is white, so black pixels stay 0.
	const raw = new Uint8Array((rowBytes + 1) * w);
	for (let my = 0; my < modules; my++) {
		const row = m[my];
		const first = my * s * (rowBytes + 1);
		for (let mx = 0; mx < modules; mx++) {
			if (row[mx]) continue;
			for (let x = mx * s; x < (mx + 1) * s; x++) raw[first + 1 + (x >> 3)] |= 0x80 >> (x & 7);
		}
		for (let k = 1; k < s; k++) {
			raw.copyWithin(first + k * (rowBytes + 1), first, first + rowBytes + 1);
		}
	}

	// zlib stream: header, stored blocks, Adler-32 of the raw data
	const blocks = Math.max(1, Math.ceil(raw.length / STORED_BLOCK));
	const zlen = 2 + raw.length + 5 * blocks + 4;
	const out = new Uint8Array(8 + (12 + 13) + (12 + zlen) + 12);
	let p = 0;
	const u32 = (n) => {
		out[p++] = (n >>> 24) & 255;
		out[p++] = (n >>> 16) & 255;
		out[p++] = (n >>> 8) & 255;
		out[p++] = n & 255;
	};
	const ascii = (t) => {
		for (let i = 0; i < t.length; i++) out[p++] = t.charCodeAt(i);
	};
	[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].forEach((b) => (out[p++] = b));

	u32(13);
	let start = p;
	ascii('IHDR');
	u32(w);
	u32(w);
	out[p++] = 1; // bit depth
	out[p++] = 0; // greyscale
	out[p++] = 0; // deflate
	out[p++] = 0; // adaptive filtering
	out[p++] = 0; // no interlace
	u32(crc32(out, start, p));

	u32(zlen);
	start = p;
	ascii('IDAT');
	out[p++] = 0x78;
	out[p++] = 0x01;
	let a = 1;
	let b = 0;
	for (let i = 0; i < raw.length; i++) {
		a = (a + raw[i]) % 65521;
		b = (b + a) % 65521;
	}
	for (let pos = 0, n = 0; n < blocks; n++) {
		const len = Math.min(STORED_BLOCK, raw.length - pos);
		out[p++] = n === blocks - 1 ? 1 : 0; // last block?
		out[p++] = len & 255;
		out[p++] = len >> 8;
		out[p++] = ~len & 255;
		out[p++] = (~len >> 8) & 255;
		out.set(raw.subarray(pos, pos + len), p);
		p += len;
		pos += len;
	}
	u32(((b << 16) | a) >>> 0);
	u32(crc32(out, start, p));

	u32(0);
	start = p;
	ascii('IEND');
	u32(crc32(out, start, p));
	return Array.prototype.slice.call(out);
}

/**
 * "data:image/png;base64,…" for the admin preview (/admin/messages), whose
 * frame can't resolve the cid: of a real e-mail. The JSVM has no btoa.
 */
function dataUri(bytes) {
	const out = [];
	for (let i = 0; i < bytes.length; i += 3) {
		const n = (bytes[i] << 16) | ((bytes[i + 1] || 0) << 8) | (bytes[i + 2] || 0);
		out.push(
			BASE64[(n >> 18) & 63],
			BASE64[(n >> 12) & 63],
			i + 1 < bytes.length ? BASE64[(n >> 6) & 63] : '=',
			i + 2 < bytes.length ? BASE64[n & 63] : '='
		);
	}
	return 'data:image/png;base64,' + out.join('');
}

module.exports = {
	PASS_QR_SCALE: PASS_QR_SCALE,
	passQrPng: passQrPng,
	dataUri: dataUri
};
