// tests/template.test.ts — layout template format: parsing, validation, export building
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
	TEMPLATE_LIMITS,
	buildTemplate,
	compareNatural,
	parseTemplate,
	stringifyTemplate,
	summarizeTemplate
} from '../src/lib/template';
import { MAP_HEIGHT, MAP_IMAGE, MAP_WIDTH } from '../src/lib/map-geometry';

const bed = (label: string, extra: object = {}) => ({ label, ...extra });
const room = (
	name: string,
	room_number: number | undefined,
	beds: unknown,
	extra: object = {}
) => ({
	name,
	room_number,
	beds,
	...extra
});
const house = (name: string, x: unknown, y: unknown, rooms: unknown = []) => ({
	name,
	x,
	y,
	rooms
});
const v2 = (houses: unknown, extra: object = {}) => ({
	format: 'cozynights-layout',
	version: '2.0',
	name: 'Test layout',
	houses,
	...extra
});

const goodHouse = () =>
	house('Haus 1', 100, 200, [
		room('Main', 1, [bed('B1', { enabled: true, is_locked: false }), bed('B2')])
	]);

function parse(data: unknown) {
	return parseTemplate(JSON.stringify(data));
}

function errorsOf(data: unknown): string[] {
	const result = parse(data);
	if (result.ok) throw new Error('expected the template to be refused');
	return result.errors;
}

function accepted(data: unknown) {
	const result = parse(data);
	if (!result.ok) throw new Error(`expected a valid template, got: ${result.errors.join(' | ')}`);
	return result;
}

describe('parseTemplate: accepted files', () => {
	it('round-trips a version 2.0 template through export text and back', () => {
		const original = accepted(
			v2([
				house('Haus 1', 333, 444, [
					room('Main', 1, [
						bed('B1', { enabled: true, is_locked: false }),
						bed('B2', { enabled: true, is_locked: true }),
						bed('Sofa "Ä" <b>&', { enabled: false, is_locked: false })
					]),
					room('Attic', 2, [])
				]),
				house('Bungalow 7', 700, 420, [])
			])
		);

		const again = parseTemplate(stringifyTemplate(original.template));
		expect(again.ok).toBe(true);
		if (!again.ok) return;
		expect(again.template).toEqual(original.template);
		expect(again.summary).toEqual(original.summary);
		expect(again.template.map).toEqual({ image: MAP_IMAGE, width: MAP_WIDTH, height: MAP_HEIGHT });
	});

	it('fills in the defaults: spots are active and unlocked', () => {
		const { template, summary, warnings } = accepted(v2([goodHouse()]));
		expect(template.houses[0].rooms[0].beds).toEqual([
			{ label: 'B1', enabled: true, is_locked: false },
			{ label: 'B2', enabled: true, is_locked: false }
		]);
		expect(summary.activeBeds).toBe(2);
		expect(warnings).toEqual([]);
	});

	it('normalises a version 1.0 export', () => {
		const { template, summary } = accepted({
			name: 'Burn Location Template',
			exported_at: '2026-09-17T15:04:05.000Z',
			version: '1.0',
			houses: [
				house('Neon Cave', 412, 268, [
					room(
						'Bunk Room',
						1,
						[
							bed('B1', { enabled: true, is_locked: false }),
							bed('B2', { enabled: true, is_locked: true }),
							bed('B3', { enabled: false, is_locked: false })
						],
						{ amount_beds: 99 }
					)
				])
			]
		});
		expect(template.format).toBe('cozynights-layout');
		expect(template.version).toBe('2.0');
		expect(template.name).toBe('Burn Location Template');
		expect(template.exported_at).toBe('2026-09-17T15:04:05.000Z');
		// amount_beds is derived from the spots that are listed, never the other way round.
		expect(template.houses[0].rooms[0]).not.toHaveProperty('amount_beds');
		expect(summary).toEqual({
			houses: 1,
			rooms: 1,
			beds: 3,
			activeBeds: 1,
			lockedBeds: 1,
			specialBeds: 0,
			deactivatedBeds: 1
		});
	});

	it('creates B1..Bn for a version 1.0 room that only has amount_beds', () => {
		const { template, warnings } = accepted({
			version: '1.0',
			houses: [house('AmountOnly', 50, 50, [{ name: 'R', room_number: 1, amount_beds: 3 }])]
		});
		expect(template.houses[0].rooms[0].beds).toEqual([
			{ label: 'B1', enabled: true, is_locked: false },
			{ label: 'B2', enabled: true, is_locked: false },
			{ label: 'B3', enabled: true, is_locked: false }
		]);
		expect(warnings.join('\n')).toContain('3 active spots labelled B1 to B3');
	});

	it('ignores unknown keys, including ids and booking state', () => {
		const { template } = accepted(
			v2(
				[
					{
						...house('Extra', 50, 50, [
							room('R', 1, [bed('B1', { occupied: true, order: '5zabs2rkwjaxy1y' })])
						]),
						id: 'aaaaaaaaaaaaaaa',
						occupied: true
					}
				],
				{ comment: 'hello' }
			)
		);
		expect(template.houses[0]).toEqual({
			name: 'Extra',
			x: 50,
			y: 50,
			rooms: [
				{ name: 'R', room_number: 1, beds: [{ label: 'B1', enabled: true, is_locked: false }] }
			]
		});
	});

	it('accepts a file that starts with a byte order mark', () => {
		expect(parseTemplate(String.fromCharCode(0xfeff) + JSON.stringify(v2([goodHouse()]))).ok).toBe(
			true
		);
	});

	it('trims names and rounds positions to whole map units', () => {
		const { template } = accepted(v2([house('  Haus 1 ', 333.5, 444.25, [])]));
		expect(template.houses[0]).toMatchObject({ name: 'Haus 1', x: 334, y: 444 });
	});

	it('accepts the limits exactly', () => {
		const beds = Array.from({ length: TEMPLATE_LIMITS.bedsPerRoom }, (_, i) => bed(`B${i + 1}`));
		const rooms = Array.from({ length: TEMPLATE_LIMITS.roomsPerHouse }, (_, i) =>
			room(`Room ${i + 1}`, i + 1, i === 0 ? beds : [bed('B1')])
		);
		const houses = Array.from({ length: TEMPLATE_LIMITS.houses }, (_, i) =>
			house(`House ${i + 1}`, (i % 20) * 50, Math.floor(i / 20) * 50, i === 0 ? rooms : [])
		);
		expect(accepted(v2(houses)).summary.houses).toBe(TEMPLATE_LIMITS.houses);
	});

	it('ships a starter template that is valid and in the export format', () => {
		const text = readFileSync('static/templates/brahmsee-starter.json', 'utf8');
		const result = parseTemplate(text);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.warnings).toEqual([]);
		expect(result.summary.houses).toBeGreaterThanOrEqual(3);
		expect(result.summary.activeBeds).toBeGreaterThan(0);
		expect(stringifyTemplate(result.template)).toBe(text.trimEnd());
	});
});

describe('parseTemplate: refused files', () => {
	const refused: [string, string, RegExp][] = [
		['an empty file', '', /The file is empty/],
		['malformed JSON', '{"houses": [ {"name": "X", }', /not valid JSON/],
		[
			'binary data',
			'\x89PNG\r\n\x1a\n not json at all',
			/not valid JSON, so it can't be read \([\x20-\x7e]+\)\. Export/
		],
		['null', 'null', /one JSON object .* contains null/],
		['a list', '[1, 2, 3]', /one JSON object .* contains a list/],
		['a number', '42', /one JSON object .* contains a number/]
	];
	it.each(refused)('refuses %s', (_, text, message) => {
		const result = parseTemplate(text);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.errors.join('\n')).toMatch(message);
	});

	const longName = 'x'.repeat(TEMPLATE_LIMITS.houseNameLength + 1);
	const longLabel = 'x'.repeat(TEMPLATE_LIMITS.bedLabelLength + 1);
	const many = (count: number, make: (i: number) => unknown) =>
		Array.from({ length: count }, (_, i) => make(i));

	const rules: [string, unknown, RegExp][] = [
		[
			'a missing version',
			{ houses: [goodHouse()] },
			/^version: is missing\. Add "version": "2\.0"/
		],
		['an unknown version', v2([goodHouse()], { version: '99.0' }), /^version: .* got "99.0"/],
		[
			'a foreign format',
			v2([goodHouse()], { format: 'something-else' }),
			/^format: must be "cozynights-layout"/
		],
		[
			'version 2.0 without format',
			{ version: '2.0', houses: [goodHouse()] },
			/^format: is missing/
		],
		['missing houses', { version: '1.0' }, /^houses: is missing/],
		['houses that are not a list', v2({ a: 1 }), /^houses: must be a list/],
		[
			'an empty houses list',
			v2([]),
			/^houses: the list is empty\. A template needs at least one house/
		],
		[
			'too many houses',
			v2(many(201, (i) => house(`H${i}`, i, i))),
			/^houses: 201 houses are too many, the limit is 200/
		],
		['a house that is null', v2([null]), /^houses\[0\]: must be an object .* \(got null\)/],
		['a house without name', v2([{ x: 1, y: 1 }]), /^houses\[0\]: name is missing/],
		['an empty house name', v2([house('   ', 1, 1)]), /^houses\[0\]: name must not be empty/],
		[
			'a numeric house name',
			v2([house(7 as never, 1, 1)]),
			/^houses\[0\]: name must be text in quotes \(got 7\)/
		],
		[
			'a house name that is too long',
			v2([house(longName, 1, 1)]),
			/name is too long \(101 characters, the limit is 100\)/
		],
		[
			'duplicate house names, ignoring case',
			v2([house('Twin', 10, 10), house('TWIN', 200, 200)]),
			/^houses\[1\] "TWIN": the name is already used by houses\[0\] "Twin"/
		],
		[
			'missing coordinates',
			v2([{ name: 'NoCoords', rooms: [] }]),
			/^houses\[0\] "NoCoords": x must be a number between 0 and 1000 \(got nothing\)/
		],
		[
			'x right of the map',
			v2([house('Far away', 5000, 10)]),
			/"Far away": x must be a number between 0 and 1000 \(got 5000\)/
		],
		[
			'y above the map',
			v2([house('Far away', 10, -300)]),
			/"Far away": y must be a number between 0 and 700 \(got -300\)/
		],
		[
			'a numeric string as coordinate',
			v2([house('Strings', '412', 10)]),
			/x must be a number .* \(got "412"\)\. Write the number without quotes/
		],
		[
			'a word as coordinate',
			v2([house('Haus 3', 10, 'abc')]),
			/^houses\[0\] "Haus 3": y must be a number between 0 and 700 \(got "abc"\)\.$/
		],
		[
			'rooms that are not a list',
			v2([house('H', 1, 1, 'two')]),
			/^houses\[0\] "H": rooms must be a list/
		],
		[
			'too many rooms',
			v2([
				house(
					'H',
					1,
					1,
					many(51, (i) => room(`R${i}`, i + 1, []))
				)
			]),
			/51 rooms are too many, the limit is 50 per house/
		],
		[
			'a room that is a string',
			v2([house('H', 1, 1, ['Attic'])]),
			/^houses\[0\] "H" > rooms\[0\]: must be an object/
		],
		[
			'a room without name',
			v2([house('H', 1, 1, [room('', 1, [])])]),
			/^houses\[0\] "H" > rooms\[0\]: name must not be empty/
		],
		[
			'a room number in quotes',
			v2([house('H', 1, 1, [room('R', '2b' as never, [])])]),
			/rooms\[0\] "R": room_number must be a whole number from 1 to 9999, without quotes \(got "2b"\)/
		],
		[
			'room number zero',
			v2([house('H', 1, 1, [room('R', 0, [])])]),
			/room_number must be a whole number from 1/
		],
		[
			'a fractional room number',
			v2([house('H', 1, 1, [room('R', 1.5, [])])]),
			/room_number must be a whole number/
		],
		[
			'duplicate room numbers in one house',
			v2([house('H', 1, 1, [room('A', 1, []), room('B', 1, [])])]),
			/rooms\[1\] "B": room_number 1 is already used by rooms\[0\] "A"/
		],
		[
			'beds that are not a list',
			v2([house('H', 1, 1, [room('R', 1, 4)])]),
			/rooms\[0\] "R": beds must be a list \(got 4\)/
		],
		[
			'too many spots',
			v2([
				house('H', 1, 1, [
					room(
						'R',
						1,
						many(51, (i) => bed(`B${i}`))
					)
				])
			]),
			/51 spots are too many, the limit is 50 per room/
		],
		[
			'a spot that is a string',
			v2([house('H', 1, 1, [room('R', 1, ['B1'])])]),
			/beds\[0\]: must be an object like/
		],
		[
			'a spot without label',
			v2([house('H', 1, 1, [room('R', 1, [{}])])]),
			/beds\[0\]: label is missing/
		],
		[
			'a numeric label',
			v2([house('H', 1, 1, [room('R', 1, [bed(7 as never)])])]),
			/beds\[0\]: label must be text in quotes \(got 7\)/
		],
		[
			'a label that is too long',
			v2([house('H', 1, 1, [room('R', 1, [bed(longLabel)])])]),
			/label is too long \(51 characters, the limit is 50\)/
		],
		[
			'duplicate labels in one room',
			v2([house('H', 1, 1, [room('R', 1, [bed('B1'), bed('b1')])])]),
			/beds\[1\] "b1": the label is already used by beds\[0\] "B1" in the same room/
		],
		[
			'enabled in quotes',
			v2([house('H', 1, 1, [room('R', 1, [bed('B1', { enabled: 'false' })])])]),
			/beds\[0\] "B1": enabled must be true or false, without quotes \(got "false"\)/
		],
		[
			'is_locked as a word',
			v2([house('H', 1, 1, [room('R', 1, [bed('B1', { is_locked: 'yes' })])])]),
			/is_locked must be true or false/
		],
		[
			'a bad amount_beds without beds',
			{
				version: '1.0',
				houses: [house('H', 1, 1, [{ name: 'R', room_number: 1, amount_beds: '3' }])]
			},
			/amount_beds must be a whole number from 0 to 50 \(got "3"\)/
		]
	];
	it.each(rules)('refuses %s', (_, data, message) => {
		expect(errorsOf(data).some((line) => message.test(line))).toBe(true);
	});

	it('reports every problem at once, each with its path', () => {
		const errors = errorsOf(
			v2([
				house('Strings', '412', 'abc', [
					room('R', '2b' as never, [bed(7 as never, { enabled: 'false', is_locked: 'yes' })])
				]),
				house('Far away', 5000, -300)
			])
		);
		expect(errors).toHaveLength(8);
		expect(errors.every((line) => line.startsWith('houses['))).toBe(true);
	});

	it('cuts a very long list of problems short', () => {
		const errors = errorsOf(v2(Array.from({ length: 80 }, (_, i) => house(`H${i}`, -1, 1))));
		expect(errors).toHaveLength(51);
		expect(errors[50]).toMatch(/and 30 more/);
	});

	it('allows the same label in different rooms and the same room number in different houses', () => {
		const result = accepted(
			v2([
				house('A', 100, 100, [room('R', 1, [bed('B1')]), room('S', 2, [bed('B1')])]),
				house('B', 300, 300, [room('R', 1, [bed('B1')])])
			])
		);
		expect(result.summary.beds).toBe(3);
	});
});

describe('parseTemplate: warnings', () => {
	it('warns about houses without rooms and rooms without spots', () => {
		const { warnings } = accepted(
			v2([house('Empty', 10, 10, []), house('Bare', 300, 300, [room('R', 1, [])])])
		);
		expect(warnings).toEqual([
			'houses[0] "Empty": has no rooms, so there is nothing to book in this house.',
			'houses[1] "Bare" > rooms[0] "R": has no spots.'
		]);
	});

	it('numbers rooms without room_number in file order, around the numbers that are taken', () => {
		const { template, warnings } = accepted(
			v2([
				house('H', 10, 10, [
					room('First', undefined, [bed('B1')]),
					room('Second', 1, [bed('B1')]),
					room('Third', undefined, [bed('B1')])
				])
			])
		);
		expect(template.houses[0].rooms.map((r) => [r.name, r.room_number])).toEqual([
			['First', 2],
			['Second', 1],
			['Third', 3]
		]);
		expect(warnings).toEqual([
			'houses[0] "H": 2 of 3 rooms have no room_number. They get the next free numbers in file order.'
		]);
	});

	it('warns when two houses would overlap on the map, without refusing', () => {
		const { warnings } = accepted(
			v2([
				house('A', 100, 100, [room('R', 1, [bed('B1')])]),
				house('B', 110, 100, [room('R', 1, [bed('B1')])])
			])
		);
		expect(warnings).toHaveLength(1);
		expect(warnings[0]).toMatch(/^houses\[1\] "B": is only 10 map units away from houses\[0\] "A"/);
	});

	it('warns when the layout was made for a different map', () => {
		const otherSize = accepted(
			v2([goodHouse()], { map: { image: MAP_IMAGE, width: 2000, height: 700 } })
		);
		expect(otherSize.warnings.join('\n')).toMatch(/made for a 2000 × 700 map/);
		const otherImage = accepted(
			v2([goodHouse()], { map: { image: '/other.jpg', width: 1000, height: 700 } })
		);
		expect(otherImage.warnings.join('\n')).toMatch(/made for the map image "\/other.jpg"/);
	});

	it('warns when no spot would be bookable', () => {
		const { warnings } = accepted(
			v2([
				house('H', 1, 1, [
					room('R', 1, [bed('B1', { enabled: false }), bed('B2', { is_locked: true })])
				])
			])
		);
		expect(warnings.join('\n')).toMatch(/No spot in this template is bookable/);
	});
});

describe('summarizeTemplate', () => {
	it('counts every spot exactly once', () => {
		const { template } = accepted(
			v2([
				house('A', 100, 100, [
					room('R1', 1, [
						bed('B1'),
						bed('B2', { is_locked: true }),
						bed('B3', { enabled: false }),
						bed('B4', { enabled: false, is_locked: true })
					]),
					room('R2', 2, [bed('B1')])
				]),
				house('B', 300, 300, [])
			])
		);
		const summary = summarizeTemplate(template.houses);
		expect(summary).toEqual({
			houses: 2,
			rooms: 2,
			beds: 5,
			activeBeds: 2,
			lockedBeds: 1,
			specialBeds: 0,
			deactivatedBeds: 2
		});
		expect(summary.activeBeds + summary.lockedBeds + summary.deactivatedBeds).toBe(summary.beds);
	});
});

describe('compareNatural', () => {
	it('sorts B2 before B10', () => {
		const labels = ['B10', 'B2', 'B1', 'Sofa', 'B11', 'A9', 'B3'];
		expect([...labels].sort(compareNatural)).toEqual([
			'A9',
			'B1',
			'B2',
			'B3',
			'B10',
			'B11',
			'Sofa'
		]);
	});
});

describe('buildTemplate', () => {
	const records = {
		houses: [
			{ id: 'h2', name: 'Haus 10', x: 10, y: 20 },
			{ id: 'h1', name: 'Haus 2', x: 333.5, y: 444.25 }
		],
		rooms: [
			{ id: 'r2', house: 'h1', name: 'Attic', room_number: 2 },
			{ id: 'r1', house: 'h1', name: 'Main', room_number: 1 },
			{ id: 'r3', house: 'gone', name: 'Orphan', room_number: 1 }
		],
		beds: [
			{ room: 'r1', label: 'B10', enabled: true, is_locked: false },
			{ room: 'r1', label: 'B2', enabled: false, is_locked: false },
			{ room: 'r1', label: 'B1', enabled: true, is_locked: true },
			{ room: 'nowhere', label: 'Lost', enabled: true, is_locked: false }
		]
	};

	it('builds a sorted version 2.0 template and leaves out orphans', () => {
		const template = buildTemplate(records, new Date('2026-09-17T12:00:00.000Z'));
		expect(template).toEqual({
			format: 'cozynights-layout',
			version: '2.0',
			name: 'CozyNights camp layout',
			exported_at: '2026-09-17T12:00:00.000Z',
			map: { image: MAP_IMAGE, width: MAP_WIDTH, height: MAP_HEIGHT },
			houses: [
				{
					name: 'Haus 2',
					x: 333.5,
					y: 444.25,
					rooms: [
						{
							name: 'Main',
							room_number: 1,
							beds: [
								{ label: 'B1', enabled: true, is_locked: true },
								{ label: 'B2', enabled: false, is_locked: false },
								{ label: 'B10', enabled: true, is_locked: false }
							]
						},
						{ name: 'Attic', room_number: 2, beds: [] }
					]
				},
				{ name: 'Haus 10', x: 10, y: 20, rooms: [] }
			]
		});
	});

	it('exports text that the import accepts again', () => {
		const text = stringifyTemplate(buildTemplate(records));
		expect(JSON.parse(text)).toEqual(
			JSON.parse(JSON.stringify(buildTemplate(records, new Date(JSON.parse(text).exported_at))))
		);
		// One line per spot keeps a big camp editable by hand.
		expect(text).toContain('\t\t\t\t\t\t{ "label": "B1", "enabled": true, "is_locked": true },\n');
		const result = parseTemplate(text);
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.summary).toMatchObject({ houses: 2, rooms: 2, beds: 3 });
	});
});
