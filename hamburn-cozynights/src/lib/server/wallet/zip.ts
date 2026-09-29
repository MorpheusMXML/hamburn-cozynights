// src/lib/server/wallet/zip.ts
/**
 * A minimal ZIP writer for Apple Wallet passes (.pkpass is a ZIP archive):
 * flat file names, deflate, no ZIP64 — a pass is a handful of small files at
 * the archive's root.
 * Node's zlib does the compression and the CRC-32.
 */
import zlib from 'zlib';

export interface ZipEntry {
	name: string;
	data: Buffer;
}

// MS-DOS date and time of 1 January 2026, 00:00 — a fixed stamp, so the same
// pass content always gives the same archive.
const DOS_TIME = 0;
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;

export function createZip(entries: ZipEntry[]): Buffer {
	const locals: Buffer[] = [];
	const centrals: Buffer[] = [];
	let offset = 0;

	for (const entry of entries) {
		// flat names only: a pass has no folders, and nothing may point outside it
		if (!/^[A-Za-z0-9_@-][A-Za-z0-9._@-]*$/.test(entry.name)) {
			throw new Error(`bad file name: ${entry.name}`);
		}
		const name = Buffer.from(entry.name, 'utf8');
		const compressed = zlib.deflateRawSync(entry.data, { level: 9 });
		const crc = zlib.crc32(entry.data);

		const local = Buffer.alloc(30);
		local.writeUInt32LE(0x04034b50, 0); // local file header
		local.writeUInt16LE(20, 4); // version needed: 2.0
		local.writeUInt16LE(0, 6); // flags
		local.writeUInt16LE(8, 8); // deflate
		local.writeUInt16LE(DOS_TIME, 10);
		local.writeUInt16LE(DOS_DATE, 12);
		local.writeUInt32LE(crc, 14);
		local.writeUInt32LE(compressed.length, 18);
		local.writeUInt32LE(entry.data.length, 22);
		local.writeUInt16LE(name.length, 26);
		local.writeUInt16LE(0, 28); // extra field length
		locals.push(local, name, compressed);

		const central = Buffer.alloc(46);
		central.writeUInt32LE(0x02014b50, 0); // central directory header
		central.writeUInt16LE(20, 4); // version made by
		central.writeUInt16LE(20, 6); // version needed
		central.writeUInt16LE(0, 8);
		central.writeUInt16LE(8, 10);
		central.writeUInt16LE(DOS_TIME, 12);
		central.writeUInt16LE(DOS_DATE, 14);
		central.writeUInt32LE(crc, 16);
		central.writeUInt32LE(compressed.length, 20);
		central.writeUInt32LE(entry.data.length, 24);
		central.writeUInt16LE(name.length, 28);
		central.writeUInt16LE(0, 30); // extra
		central.writeUInt16LE(0, 32); // comment
		central.writeUInt16LE(0, 34); // disk
		central.writeUInt16LE(0, 36); // internal attributes
		central.writeUInt32LE(0, 38); // external attributes
		central.writeUInt32LE(offset, 42);
		centrals.push(central, name);

		offset += local.length + name.length + compressed.length;
	}

	const directory = Buffer.concat(centrals);
	const end = Buffer.alloc(22);
	end.writeUInt32LE(0x06054b50, 0); // end of central directory
	end.writeUInt16LE(0, 4);
	end.writeUInt16LE(0, 6);
	end.writeUInt16LE(entries.length, 8);
	end.writeUInt16LE(entries.length, 10);
	end.writeUInt32LE(directory.length, 12);
	end.writeUInt32LE(offset, 16);
	end.writeUInt16LE(0, 20);

	return Buffer.concat([...locals, directory, end]);
}

/** The files of a ZIP written by createZip (for the tests and the smoke check). */
export function readZip(archive: Buffer): Map<string, Buffer> {
	const files = new Map<string, Buffer>();
	const endAt = archive.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
	if (endAt < 0) throw new Error('not a ZIP archive');
	const count = archive.readUInt16LE(endAt + 10);
	let at = archive.readUInt32LE(endAt + 16);
	for (let i = 0; i < count; i++) {
		if (archive.readUInt32LE(at) !== 0x02014b50) throw new Error('broken central directory');
		const method = archive.readUInt16LE(at + 10);
		const size = archive.readUInt32LE(at + 20);
		const nameLength = archive.readUInt16LE(at + 28);
		const extraLength = archive.readUInt16LE(at + 30);
		const commentLength = archive.readUInt16LE(at + 32);
		const localAt = archive.readUInt32LE(at + 42);
		const name = archive.subarray(at + 46, at + 46 + nameLength).toString('utf8');
		const localNameLength = archive.readUInt16LE(localAt + 26);
		const localExtraLength = archive.readUInt16LE(localAt + 28);
		const dataAt = localAt + 30 + localNameLength + localExtraLength;
		const data = archive.subarray(dataAt, dataAt + size);
		files.set(name, method === 8 ? zlib.inflateRawSync(data) : Buffer.from(data));
		at += 46 + nameLength + extraLength + commentLength;
	}
	return files;
}
