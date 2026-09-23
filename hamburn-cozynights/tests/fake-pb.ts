// tests/fake-pb.ts — a small in-memory stand-in for the PocketBase JS SDK, for
// unit tests of server code that reads and writes several collections. It
// understands the filters the app writes (`a = {:x} && b != ""`, true/false,
// quoted values), `expand` of single relations (also nested: "room.house"),
// sorting by one field and unique indexes. Everything else is out of scope:
// the real database is covered by tests/integration.

type Row = Record<string, any>;

const RELATIONS: Record<string, Record<string, string>> = {
	beds: { room: 'rooms', order: 'orders' },
	rooms: { house: 'houses' },
	special_requests: { order: 'orders' },
	guest_notify: { order: 'orders' },
	wallet_passes: { order: 'orders' },
	wallet_devices: { pass: 'wallet_passes' }
};

const UNIQUE: Record<string, string[]> = {
	special_requests: ['order']
};

let counter = 0;
function newId(): string {
	counter++;
	return `fake${String(counter).padStart(11, '0')}`;
}

function notFound(): Error {
	return Object.assign(new Error("The requested resource wasn't found."), { status: 404 });
}

function literal(raw: string): unknown {
	const value = raw.trim();
	if (value === 'true') return true;
	if (value === 'false') return false;
	if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
	return value.replace(/^(['"])(.*)\1$/, '$2');
}

function matches(row: Row, filter?: string): boolean {
	if (!filter) return true;
	return filter.split('&&').every((clause) => {
		const m = /^\s*([\w.]+)\s*(!=|=)\s*(.+?)\s*$/.exec(clause);
		if (!m) throw new Error(`fake-pb: unsupported filter clause "${clause}"`);
		const [, field, op, raw] = m;
		const want = literal(raw);
		const have = row[field] ?? (typeof want === 'boolean' ? false : '');
		return op === '=' ? have === want : have !== want;
	});
}

export class FakePb {
	tables: Record<string, Row[]> = {};
	authStore = { isValid: true };

	filter(expr: string, params: Record<string, unknown> = {}): string {
		return expr.replace(/\{:(\w+)\}/g, (_, key) => JSON.stringify(params[key] ?? ''));
	}

	/** Adds a record directly (no hooks, no uniqueness checks). */
	seed(collection: string, data: Row): Row {
		const now = new Date().toISOString().replace('T', ' ');
		const row = { id: newId(), created: now, updated: now, ...data };
		(this.tables[collection] ??= []).push(row);
		return row;
	}

	rows(collection: string): Row[] {
		return this.tables[collection] ?? [];
	}

	private expand(collection: string, row: Row, expand?: string): Row {
		if (!expand) return { ...row };
		const copy: Row = { ...row, expand: {} };
		for (const path of expand.split(',')) {
			const [first, ...rest] = path.trim().split('.');
			const target = RELATIONS[collection]?.[first];
			const related = target && this.rows(target).find((r) => r.id === row[first]);
			if (!related) continue;
			const existing = copy.expand[first] ?? this.expand(target, related);
			copy.expand[first] = rest.length
				? {
						...existing,
						expand: { ...existing.expand, ...this.expand(target, related, rest.join('.')).expand }
					}
				: existing;
		}
		return copy;
	}

	collection(name: string) {
		const self = this;
		const list = (options: Row = {}) => {
			let found = self.rows(name).filter((row) => matches(row, options.filter));
			if (options.sort) {
				const desc = String(options.sort).startsWith('-');
				const key = String(options.sort).replace(/^[-+]/, '');
				found = [...found].sort(
					(a, b) => String(a[key] ?? '').localeCompare(String(b[key] ?? '')) * (desc ? -1 : 1)
				);
			}
			return found.map((row) => self.expand(name, row, options.expand));
		};
		return {
			async getFullList(options: Row = {}) {
				return list(options);
			},
			async getList(_page: number, perPage: number, options: Row = {}) {
				const items = list(options);
				return { items: items.slice(0, perPage), totalItems: items.length };
			},
			async getFirstListItem(filter: string, options: Row = {}) {
				const [first] = list({ ...options, filter });
				if (!first) throw notFound();
				return first;
			},
			async getOne(id: string, options: Row = {}) {
				const row = self.rows(name).find((r) => r.id === id);
				if (!row) throw notFound();
				return self.expand(name, row, options.expand);
			},
			async create(data: Row) {
				for (const field of UNIQUE[name] ?? []) {
					if (self.rows(name).some((row) => row[field] === data[field])) {
						throw Object.assign(new Error('Failed to create record.'), {
							status: 400,
							response: { data: { [field]: { message: 'Value must be unique.' } } }
						});
					}
				}
				return { ...self.seed(name, data) };
			},
			async update(id: string, data: Row) {
				const row = self.rows(name).find((r) => r.id === id);
				if (!row) throw notFound();
				Object.assign(row, data, { updated: new Date().toISOString().replace('T', ' ') });
				return { ...row };
			},
			async delete(id: string) {
				const rows = self.rows(name);
				const index = rows.findIndex((r) => r.id === id);
				if (index < 0) throw notFound();
				rows.splice(index, 1);
				return true;
			}
		};
	}
}
