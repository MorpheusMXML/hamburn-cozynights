// tests/tickets.test.ts — the ticket list in the admin area: reading the shop's
// CSV, checking rows, comparing with the stored tickets (src/lib/tickets.ts)
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import {
	GUEST_EMAIL_PATTERN,
	TICKET_CODE_PATTERN,
	TICKET_CSV_COLUMNS,
	TICKET_LIMITS,
	candidateColumns,
	checkRosterRows,
	defaultRosterSelection,
	defaultTicketName,
	detectColumns,
	diffRoster,
	displayTicketName,
	holderName,
	maskTicketCode,
	maskedTicketLabel,
	parseCsv,
	parseRoster,
	readRosterFile,
	type RosterRow,
	type StoredTicket
} from '../src/lib/tickets';
import { loadHookModule } from './hook-module';

const ZWSP = String.fromCharCode(0x200b);
const BOM = String.fromCharCode(0xfeff);

const stored = (code: string, extra: Partial<StoredTicket> = {}): StoredTicket => ({
	id: `id-${code}`,
	code,
	email: '',
	name: defaultTicketName(code),
	hasSpot: false,
	telegram: false,
	...extra
});

function entries(text: string) {
	const result = parseRoster(text);
	if (!result.ok) throw new Error(result.error);
	return result;
}

describe('parseCsv', () => {
	it('takes the delimiter from the header line: comma, semicolon or tab', () => {
		expect(parseCsv('code,email\nA,a@x.de')).toEqual([
			['code', 'email'],
			['A', 'a@x.de']
		]);
		expect(parseCsv('code;email\nA;a@x.de')[1]).toEqual(['A', 'a@x.de']);
		expect(parseCsv('code\temail\nA\ta@x.de')[1]).toEqual(['A', 'a@x.de']);
		// a comma inside the data doesn't matter when the header uses semicolons
		expect(parseCsv('code;name\nA;Lovelace, Ada')[1]).toEqual(['A', 'Lovelace, Ada']);
	});

	it('reads quoted fields with delimiters, doubled quotes and line breaks', () => {
		const rows = parseCsv('code,name\n"A,1","Ada ""The Countess"" L."\nB,"two\nlines"');
		expect(rows[1]).toEqual(['A,1', 'Ada "The Countess" L.']);
		expect(rows[2]).toEqual(['B', 'two\nlines']);
	});

	it('treats a quote inside a field as a character, so it cannot swallow rows', () => {
		const rows = parseCsv(
			'code,email,name\nHB-1,a@b.de,Max "Mad\nHB-2,c@d.de,Eva\nHB-3,e@f.de,Ina'
		);
		expect(rows).toHaveLength(4);
		expect(rows[1]).toEqual(['HB-1', 'a@b.de', 'Max "Mad']);
		expect(rows[3]).toEqual(['HB-3', 'e@f.de', 'Ina']);
	});

	it('takes the delimiter from the first line with content, or from a sep= line', () => {
		expect(parseCsv('\n\ncode;email\nA;a@x.de')[3]).toEqual(['A', 'a@x.de']);
		const excel = parseCsv('sep=;\ncode;email\nA;a@x.de');
		expect(excel[0]).toEqual(['']);
		expect(excel[1]).toEqual(['code', 'email']);
		expect(excel[2]).toEqual(['A', 'a@x.de']);
		expect(parseCsv('"sep=|"\ncode|email\nA|a@x.de')[2]).toEqual(['A', 'a@x.de']);
	});

	it('copes with Windows line ends and a byte order mark', () => {
		expect(parseCsv(`${BOM}code,email\r\nA,a@x.de\r\n`)).toEqual([
			['code', 'email'],
			['A', 'a@x.de']
		]);
	});
});

describe('column detection', () => {
	it('knows the usual names of the ticket shop exports', () => {
		expect(detectColumns(['Order code', 'E-Mail', 'Attendee name'])).toEqual({
			code: 0,
			email: 1,
			name: 2
		});
		expect(detectColumns(['ticket_code', 'email_address', 'full name'])).toEqual({
			code: 0,
			email: 1,
			name: 2
		});
		expect(detectColumns(['Secret', 'Something else'])).toEqual({ code: 0, email: -1, name: -1 });
	});

	it('lists every column that could hold a field', () => {
		expect(candidateColumns(['Order code', 'E-mail', 'Secret', 'Attendee email'], 'code')).toEqual([
			0, 2
		]);
		expect(candidateColumns(['Order code', 'E-mail', 'Secret', 'Attendee email'], 'email')).toEqual(
			[1, 3]
		);
	});
});

describe('readRosterFile (in the browser)', () => {
	it('keeps only the three columns that matter, with spreadsheet row numbers', () => {
		const file = readRosterFile(
			'Street,Order code,E-Mail,Phone,Attendee name\nMain 1,HB-1,Ada@Example.org,0123,Ada\n\nMain 2,HB-2,,0456,\n'
		);
		if (!file.ok) throw new Error(file.error);
		expect(file.columns).toEqual({ code: 1, email: 2, name: 4 });
		expect(file.rows).toEqual([
			{ line: 2, code: 'HB-1', email: 'Ada@Example.org', name: 'Ada' },
			// the blank line 3 is skipped but still counted
			{ line: 4, code: 'HB-2', email: '', name: '' }
		]);
		// nothing of the other columns
		expect(JSON.stringify(file.rows)).not.toContain('Main');
		expect(JSON.stringify(file.rows)).not.toContain('0123');
	});

	it('uses the columns the admin picked, including none for e-mail or name', () => {
		const text = 'code,email,attendee email\nA,order@x.de,guest@x.de';
		const picked = readRosterFile(text, { email: 2 });
		const none = readRosterFile(text, { email: -1 });
		if (!picked.ok || !none.ok) throw new Error('expected both to read');
		expect(picked.rows[0].email).toBe('guest@x.de');
		expect(none.rows[0].email).toBe('');
		// the code column can't be "none"
		const noCode = readRosterFile(text, { code: -1 });
		expect(noCode.ok && noCode.columns.code).toBe(0);
	});

	it('refuses files it can not use, with a reason', () => {
		const refused = (text: string) => {
			const result = readRosterFile(text);
			if (result.ok) throw new Error('expected a refusal');
			return result.error;
		};
		expect(refused('')).toMatch(/empty/);
		expect(refused('  \n \n')).toMatch(/empty/);
		expect(refused('code,email\n')).toMatch(/no tickets/);
		expect(refused('Street,City\nMain 1,Berlin')).toMatch(/No ticket code column/);
		expect(refused(`PK${String.fromCharCode(3, 4)}binary`)).toMatch(/not a text file/);
		const tooMany =
			'code\n' + Array.from({ length: TICKET_LIMITS.rows + 1 }, (_, i) => `T${i}`).join('\n');
		expect(refused(tooMany)).toMatch(/limit/);
	});
});

describe('checkRosterRows', () => {
	const row = (line: number, code: string, email = '', name = ''): RosterRow => ({
		line,
		code,
		email,
		name
	});

	it('cleans codes and addresses', () => {
		const { entries, problems } = checkRosterRows([
			row(2, ` ${ZWSP}HB-1${ZWSP} `, ' Ada@Example.ORG ', '  Ada  ')
		]);
		expect(problems).toEqual([]);
		expect(entries).toEqual([{ line: 2, code: 'HB-1', email: 'ada@example.org', name: 'Ada' }]);
	});

	it('refuses a cell that spans several lines (an unclosed quote swallowed rows)', () => {
		const file = parseRoster('code,email,name\nHB-1,a@b.de,"Max Mad\nHB-2,c@d.de,Eva');
		if (!file.ok) throw new Error(file.error);
		expect(file.entries).toEqual([]);
		expect(file.problems).toHaveLength(1);
		expect(file.problems[0]).toMatchObject({ line: 2, code: 'HB-1' });
		expect(file.problems[0].message).toContain('several lines');
	});

	it('lists broken rows as problems and keeps the rest', () => {
		const { entries, problems } = checkRosterRows([
			row(2, 'GOOD-1', 'a@x.de'),
			row(3, '', 'b@x.de'),
			row(4, 'HB 2', 'c@x.de'),
			row(5, 'HB-3', 'not-an-address'),
			row(6, 'HB-4', 'd@x.de', 'x'.repeat(TICKET_LIMITS.nameLength + 1)),
			row(7, 'good-1', 'e@x.de'),
			row(8, 'GOOD-2')
		]);
		expect(entries.map((e) => e.code)).toEqual(['GOOD-1', 'GOOD-2']);
		expect(problems.map((p) => [p.line, p.message.split(' ')[0]])).toEqual([
			[3, 'no'],
			[4, 'invalid'],
			[5, 'invalid'],
			[6, 'name'],
			[7, 'the']
		]);
		expect(problems[4].message).toContain('row 2');
	});
});

describe('diffRoster', () => {
	it('sorts the file into new, changed and unchanged tickets', () => {
		const file = entries(
			'code;email;name\nHB-1;ada@example.org;Ada\nHB-2;grace@example.org;Grace\nHB-3;linus@example.org;\nHB-4;;'
		);
		const diff = diffRoster(
			file.entries,
			[
				stored('HB-1', { email: 'ada@example.org', name: 'Ada' }),
				stored('HB-2', { email: 'old@example.org', name: 'Grace' }),
				stored('HB-4', { email: 'keep@example.org', name: 'Keep' }),
				stored('HB-9', { hasSpot: true })
			],
			file.problems
		);
		expect(diff.changes.map((c) => [c.code, c.kind])).toEqual([
			['HB-2', 'changed'],
			['HB-3', 'new']
		]);
		const changed = diff.changes[0];
		expect(changed).toMatchObject({
			id: 'id-HB-2',
			email: 'grace@example.org',
			before: { email: 'old@example.org', name: 'Grace' },
			emailChanged: true,
			nameChanged: false
		});
		const created = diff.changes[1];
		expect(created).toMatchObject({ id: null, name: 'Ticket HB-3', email: 'linus@example.org' });
		// empty cells keep what is stored
		expect(diff.unchanged.map((u) => u.code)).toEqual(['HB-1', 'HB-4']);
		expect(diff.notInFile).toEqual([{ code: 'HB-9', hasSpot: true }]);
	});

	it('treats an address that differs only in case as unchanged', () => {
		const diff = diffRoster(entries('code,email\nHB-1,ada@example.org').entries, [
			stored('HB-1', { email: 'Ada@Example.org' })
		]);
		expect(diff.changes).toEqual([]);
		expect(diff.unchanged).toHaveLength(1);
	});

	it('refuses codes that differ from a stored one only in case, and duplicated stored codes', () => {
		const diff = diffRoster(entries('code,email\nhb-1,a@x.de\nHB-2,b@x.de').entries, [
			stored('HB-1'),
			stored('HB-2'),
			{ ...stored('HB-2'), id: 'twin' }
		]);
		expect(diff.changes).toEqual([]);
		expect(diff.problems.map((p) => p.code)).toEqual(['hb-1', 'HB-2']);
		expect(diff.problems[0].message).toContain('upper/lower case');
		expect(diff.problems[1].message).toContain('2 tickets in the database');
	});

	it('offers "passed on" only where the old holder left something, and suggests it for transfers', () => {
		const diff = diffRoster(
			entries(
				'code,email,name\nA-1,new@x.de,New Person\nA-2,new2@x.de,Same Name\nA-3,first@x.de,Named\nA-4,new4@x.de,Other'
			).entries,
			[
				stored('A-1', { email: 'old@x.de', name: 'Old Person', hasSpot: true }),
				stored('A-2', { email: 'old2@x.de', name: 'Same Name', telegram: true }),
				// first address ever: nothing of an old holder to forget
				stored('A-3', { email: '', hasSpot: true }),
				// no spot, no Telegram: nothing to hand over
				stored('A-4', { email: 'old4@x.de', name: 'Someone' })
			]
		);
		const byCode = Object.fromEntries(diff.changes.map((c) => [c.code, c]));
		expect(byCode['A-1']).toMatchObject({ canBeNewHolder: true, suggestNewHolder: true });
		expect(byCode['A-2']).toMatchObject({ canBeNewHolder: true, suggestNewHolder: false });
		expect(byCode['A-3']).toMatchObject({ canBeNewHolder: false, suggestNewHolder: false });
		expect(byCode['A-4']).toMatchObject({ canBeNewHolder: false, suggestNewHolder: false });

		expect(defaultRosterSelection(diff)).toEqual({
			selected: ['a-1', 'a-2', 'a-3', 'a-4'],
			newHolders: ['a-1']
		});
	});

	it('does not suggest a new holder when the stored name was only the default label', () => {
		const diff = diffRoster(entries('code,email,name\nB-1,new@x.de,Real Name').entries, [
			stored('B-1', { email: 'old@x.de', hasSpot: true })
		]);
		expect(diff.changes[0]).toMatchObject({ canBeNewHolder: true, suggestNewHolder: false });
	});

	it('points out addresses that belong to several tickets of the file', () => {
		const diff = diffRoster(
			entries('code,email\nC-1,friend@x.de\nC-2,friend@x.de\nC-3,other@x.de').entries,
			[]
		);
		expect(diff.sharedEmails).toEqual([{ email: 'friend@x.de', codes: ['C-1', 'C-2'] }]);
	});
});

describe('maskTicketCode', () => {
	it('shows at most a third of a code, and only the first character of a short one', () => {
		expect(maskTicketCode('Q7ZQ2')).toBe('Q•••'); // a pretix order code
		expect(maskTicketCode('HB-1001')).toBe('H•••');
		expect(maskTicketCode('HB-1001-XYZ')).toBe('HB•••Z');
		expect(maskTicketCode('q7x2k9m4p8w3r6t5')).toBe('q7x•••t5'); // a pretix ticket secret
		expect(maskTicketCode('')).toBe('');
		for (const code of ['A', 'AB12345', 'ABCDEFGH1', 'ABCDEFGHIJKLMNO', 'x'.repeat(64)]) {
			const shown = maskTicketCode(code).replace('•••', '').length;
			expect(shown).toBeLessThanOrEqual(Math.max(1, Math.floor(code.length / 3)));
		}
	});
});

describe('same rules as the server CLI (pb_hooks/cozy_admin.pb.js)', () => {
	const source = readFileSync(new URL('../pb_hooks/cozy_admin.pb.js', import.meta.url), 'utf8');
	const constant = (name: string) => {
		const match = new RegExp(`const ${name} =\\s*([\\s\\S]*?);\\n`).exec(source);
		if (!match) throw new Error(`${name} not found in cozy_admin.pb.js`);
		return vm.runInNewContext(`(${match[1]})`);
	};

	it('accepts the same ticket codes and e-mail addresses', () => {
		expect(String(constant('TICKET_CODE_PATTERN'))).toBe(String(TICKET_CODE_PATTERN));
		expect(String(constant('GUEST_EMAIL_PATTERN'))).toBe(String(GUEST_EMAIL_PATTERN));
	});

	it('knows the same column names', () => {
		expect(constant('CSV_COLUMNS')).toEqual(TICKET_CSV_COLUMNS);
	});
});

describe('how a ticket is named', () => {
	const pb = loadHookModule('lib/tickets.js');

	it('shows the holder, but nothing that carries the ticket code', () => {
		const code = 'HB-1001';
		expect(holderName({ customer_name: 'Ada Lovelace', order_number: code })).toBe('Ada Lovelace');
		// the label of a ticket without a name, and anything else with the code in it
		expect(holderName({ customer_name: defaultTicketName(code), order_number: code })).toBe('');
		expect(holderName({ customer_name: 'Ada (HB-1001)', order_number: code })).toBe('');
		expect(holderName({ customer_name: '   ', order_number: code })).toBe('');
		expect(holderName({ customer_name: 'Ada Lovelace' })).toBe('Ada Lovelace');
		expect(holderName({})).toBe('');
	});

	it('names a ticket without a holder by its masked code', () => {
		expect(maskedTicketLabel('HB-1001')).toBe('Ticket H•••');
		expect(maskedTicketLabel('')).toBe('');
		expect(displayTicketName({ customer_name: 'Ticket HB-1001', order_number: 'HB-1001' })).toBe(
			'Ticket H•••'
		);
		expect(displayTicketName({ customer_name: 'Ada Lovelace', order_number: 'HB-1001' })).toBe(
			'Ada Lovelace'
		);
	});

	it('is the same rule in PocketBase (pb_hooks/lib/tickets.js)', () => {
		const cases: [string, string][] = [
			['Ada Lovelace', 'HB-1001'],
			['Ticket HB-1001', 'HB-1001'],
			['Ada (HB-1001)', 'HB-1001'],
			['', 'Q7ZQ2'],
			['   ', 'HB-1001'],
			['Ada Lovelace', ''],
			['Ticket q7x2k9m4p8w3r6t5', 'q7x2k9m4p8w3r6t5']
		];
		for (const [name, code] of cases) {
			const order = { customer_name: name, order_number: code };
			expect(pb.holderName(name, code)).toBe(holderName(order));
			expect(pb.displayTicketName(name, code)).toBe(displayTicketName(order));
			expect(pb.maskedTicketLabel(code)).toBe(maskedTicketLabel(code));
			expect(pb.maskTicketCode(code)).toBe(maskTicketCode(code));
			expect(pb.defaultTicketName(code)).toBe(defaultTicketName(code));
		}
	});
});
