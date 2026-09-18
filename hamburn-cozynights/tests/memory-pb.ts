// tests/memory-pb.ts — a small in-memory stand-in for the PocketBase SDK, for
// unit tests of server code that reads and writes several collections. It
// understands the filters this app writes (field = value, !=, ~, && and ||
// with {:params}) — not PocketBase's full syntax. Real PocketBase behaviour
// (rules, hooks, cascades) is covered by tests/integration.
import { ClientResponseError } from 'pocketbase';

type Row = Record<string, any>;

export interface MemoryPb {
	data: Record<string, Row[]>;
	/** Every write, in order: "create beds", "update orders/abc", … */
	log: string[];
	/** Every read with a filter, as it would go into the request URL. */
	queries: string[];
	backups: string[];
	/** Makes the next matching write fail: (collection, action, data) => true. */
	failWhen: ((collection: string, action: string, data: Row) => boolean) | null;
	pb: any;
}

function notFound() {
	return new ClientResponseError({ status: 404, response: { message: 'not found' } });
}

let nextId = 1;

/** Evaluates `a = {:x} && b != "" || c ~ {:y}` against a record. */
function matches(row: Row, filter: string, params: Row): boolean {
	if (!filter) return true;
	return filter.split(' || ').some((part) =>
		part.split(' && ').every((clause) => {
			const match = /^\s*([\w.]+)\s*(!=|=|~)\s*(.+?)\s*$/.exec(clause);
			if (!match) throw new Error(`memory-pb: unsupported filter clause "${clause}"`);
			const [, field, op, raw] = match;
			let value: unknown;
			if (raw.startsWith('{:')) value = params[raw.slice(2, -1)];
			else if (raw === 'true' || raw === 'false') value = raw === 'true';
			else value = raw.replace(/^["']|["']$/g, '');
			const actual = row[field] ?? (typeof value === 'boolean' ? false : '');
			if (op === '=') return actual === value;
			if (op === '!=') return actual !== value;
			return String(actual).toLowerCase().includes(String(value).toLowerCase());
		})
	);
}

export function memoryPb(seed: Record<string, Row[]> = {}): MemoryPb {
	const state: MemoryPb = {
		data: Object.fromEntries(
			Object.entries(seed).map(([k, rows]) => [k, rows.map((r) => ({ ...r }))])
		),
		log: [],
		queries: [],
		backups: [],
		failWhen: null,
		pb: null
	};
	const table = (name: string) => (state.data[name] ??= []);

	const decode = (filter: unknown): { expr: string; params: Row } => {
		if (!filter) return { expr: '', params: {} };
		if (typeof filter === 'string') {
			try {
				const parsed = JSON.parse(filter);
				if (parsed && typeof parsed.expr === 'string') return parsed;
			} catch {
				/* a plain filter string */
			}
			return { expr: filter, params: {} };
		}
		return filter as { expr: string; params: Row };
	};

	const expand = (name: string, row: Row, spec?: string) => {
		if (!spec) return row;
		// only "room.house" (beds) is needed here
		if (name === 'beds' && spec === 'room.house') {
			const room = table('rooms').find((r) => r.id === row.room);
			const house = room && table('houses').find((h) => h.id === room.house);
			return { ...row, expand: room ? { room: { ...room, expand: house ? { house } : {} } } : {} };
		}
		return row;
	};

	const check = (collection: string, action: string, data: Row) => {
		if (state.failWhen?.(collection, action, data)) {
			state.failWhen = null;
			throw new ClientResponseError({
				status: 400,
				response: { message: 'Failed to save.', data: { name: { message: 'refused by test' } } }
			});
		}
	};

	const service = (name: string) => ({
		async getFullList(options: Row = {}) {
			const { expr, params } = decode(options.filter);
			if (expr) state.queries.push(`${name}: ${expr} ${JSON.stringify(params)}`);
			return table(name)
				.filter((row) => matches(row, expr, params))
				.map((row) => expand(name, { ...row }, options.expand));
		},
		async getList(page: number, perPage: number, options: Row = {}) {
			const items = await this.getFullList(options);
			return { page, perPage, totalItems: items.length, items: items.slice(0, perPage) };
		},
		async getFirstListItem(filter: unknown) {
			const { expr, params } = decode(filter);
			state.queries.push(`${name}: ${expr} ${JSON.stringify(params)}`);
			const row = table(name).find((r) => matches(r, expr, params));
			if (!row) throw notFound();
			return { ...row };
		},
		async getOne(id: string) {
			const row = table(name).find((r) => r.id === id);
			if (!row) throw notFound();
			return { ...row };
		},
		async create(data: Row) {
			check(name, 'create', data);
			const row = { id: `${name}-${nextId++}`, ...data };
			table(name).push(row);
			state.log.push(`create ${name}`);
			return { ...row };
		},
		async update(id: string, data: Row) {
			const row = table(name).find((r) => r.id === id);
			if (!row) throw notFound();
			check(name, 'update', data);
			Object.assign(row, data);
			state.log.push(`update ${name}/${id}`);
			return { ...row };
		},
		async delete(id: string) {
			const rows = table(name);
			const index = rows.findIndex((r) => r.id === id);
			if (index < 0) throw notFound();
			check(name, 'delete', rows[index]);
			rows.splice(index, 1);
			state.log.push(`delete ${name}/${id}`);
			return true;
		}
	});

	state.pb = {
		collection: (name: string) => service(name),
		filter: (expr: string, params: Row) => JSON.stringify({ expr, params }),
		backups: {
			async create(key: string) {
				state.backups.push(key);
				state.log.push(`backup ${key}`);
			},
			async getFullList() {
				return state.backups.map((key) => ({ key }));
			},
			async delete(key: string) {
				state.backups = state.backups.filter((k) => k !== key);
			}
		}
	};
	return state;
}
