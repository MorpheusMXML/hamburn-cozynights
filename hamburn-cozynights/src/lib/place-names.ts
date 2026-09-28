// src/lib/place-names.ts
/**
 * Funny names for the houses and rooms the house generator creates
 * (docs/admin/camp-layout.md): "Snoozy Sloth Lodge", "Glitter Grotto",
 * "Wobbly Wombat Hideout". The crew renames whatever it likes afterwards;
 * a rolled name only has to be fun, fit its kind and be free in its house
 * (rooms) or camp (houses). Pure code: the generator's sidebar rolls the
 * house name in the browser, the server rolls the rooms.
 *
 * Same rule as the burner names: words, not jokes about anyone — every
 * combination has to be fine on a door. Most rolls alliterate: the adjective
 * (and the creature) start with the letter of the place word.
 */
import type { HouseKind, RoomKind } from './accommodation';

export const PLACE_WORDS = {
	adjectives: [
		'Bouncy',
		'Breezy',
		'Blinky',
		'Cozy',
		'Cuddly',
		'Cosmic',
		'Crystal',
		'Dreamy',
		'Drowsy',
		'Disco',
		'Dusty',
		'Fluffy',
		'Fuzzy',
		'Funky',
		'Glitter',
		'Golden',
		'Glowing',
		'Groovy',
		'Humming',
		'Holographic',
		'Jolly',
		'Jazzy',
		'Lazy',
		'Lunar',
		'Mellow',
		'Moonlit',
		'Midnight',
		'Misty',
		'Majestic',
		'Neon',
		'Nocturnal',
		'Pillowy',
		'Purring',
		'Plush',
		'Rainbow',
		'Snoozy',
		'Sleepy',
		'Sparkly',
		'Starry',
		'Snuggly',
		'Silver',
		'Sunrise',
		'Toasty',
		'Twinkling',
		'Velvet',
		'Wobbly',
		'Whispering',
		'Yawning',
		'Zen'
	],
	creatures: [
		'Alpaca',
		'Axolotl',
		'Badger',
		'Bumblebee',
		'Capybara',
		'Chinchilla',
		'Dormouse',
		'Dragon',
		'Firefly',
		'Flamingo',
		'Gecko',
		'Hedgehog',
		'Jellyfish',
		'Koala',
		'Lemur',
		'Llama',
		'Manatee',
		'Marmot',
		'Moth',
		'Narwhal',
		'Octopus',
		'Otter',
		'Owl',
		'Panda',
		'Penguin',
		'Platypus',
		'Quokka',
		'Raccoon',
		'Sloth',
		'Squirrel',
		'Tortoise',
		'Unicorn',
		'Walrus',
		'Wombat',
		'Yeti'
	],
	/** What a room is, by its kind (a room of a hut group is a hut). */
	rooms: {
		room: [
			'Bower',
			'Bunker',
			'Burrow',
			'Cave',
			'Chamber',
			'Cocoon',
			'Cove',
			'Cubby',
			'Den',
			'Dome',
			'Grotto',
			'Hideaway',
			'Hive',
			'Hollow',
			'Lair',
			'Loft',
			'Lounge',
			'Nest',
			'Nook',
			'Pod',
			'Parlour',
			'Quarters',
			'Retreat',
			'Roost',
			'Sanctuary',
			'Suite',
			'Snuggery',
			'Warren'
		],
		hut: [
			'Bothy',
			'Bungalow',
			'Cabin',
			'Cottage',
			'Hideout',
			'Hollow',
			'Hut',
			'Hutch',
			'Shack',
			'Shed',
			'Treehouse'
		],
		tent: ['Bell Tent', 'Bivouac', 'Canopy', 'Dome', 'Marquee', 'Pavilion', 'Pod', 'Tent', 'Yurt'],
		other: ['Base', 'Corner', 'Hideout', 'Nook', 'Outpost', 'Quarter', 'Station', 'Zone']
	} satisfies Record<RoomKind, string[]>,
	/** What a house is, by its kind. */
	houses: {
		house: [
			'Castle',
			'Chalet',
			'Citadel',
			'Embassy',
			'Fortress',
			'Hall',
			'Headquarters',
			'Lodge',
			'Manor',
			'Mansion',
			'Observatory',
			'Palace',
			'Residence',
			'Temple',
			'Tower',
			'Villa'
		],
		hut_group: [
			'Cluster',
			'Colony',
			'Commune',
			'Hamlet',
			'Hollow',
			'Huddle',
			'Settlement',
			'Village'
		],
		tent_area: ['Bazaar', 'Camp', 'Circus', 'Field', 'Glade', 'Grove', 'Meadow', 'Oasis'],
		other: ['Base', 'Corner', 'Outpost', 'Quarter', 'Station', 'Zone']
	} satisfies Record<HouseKind, string[]>
} as const;

type Random = () => number;

/** How often a roll tries to alliterate. */
const ALLITERATION = 0.75;
/** Rolls before a taken name gets a number instead. */
const TRIES = 60;

function pick<T>(list: readonly T[], random: Random): T {
	return list[Math.floor(random() * list.length) % list.length];
}

/** A word that starts like `anchor` most of the time, any word otherwise. */
function pickLike(list: readonly string[], anchor: string, random: Random): string {
	const initial = anchor.charAt(0);
	const alike = list.filter((word) => word.charAt(0) === initial);
	return alike.length > 0 && random() < ALLITERATION ? pick(alike, random) : pick(list, random);
}

/**
 * Two or three words ending in `place`: "Glitter Grotto" or "Snoozy Sloth
 * Suite"; `creatureShare` is how often the creature is in.
 */
function wordsFor(place: string, creatureShare: number, random: Random): string {
	const adjective = pickLike(PLACE_WORDS.adjectives, place, random);
	if (random() >= creatureShare) return `${adjective} ${place}`;
	return `${adjective} ${pickLike(PLACE_WORDS.creatures, place, random)} ${place}`;
}

function rollWords(places: readonly string[], creatureShare: number, random: Random): string {
	return wordsFor(pick(places, random), creatureShare, random);
}

/**
 * Rolls until the name is not in `taken` (compared without case). After
 * TRIES rolls the last one gets a number: "Glitter Grotto 2".
 */
function rollFree(roll: () => string, taken: Set<string>): string {
	let name = roll();
	for (let i = 1; i < TRIES && taken.has(name.toLowerCase()); i++) name = roll();
	if (!taken.has(name.toLowerCase())) return name;
	let n = 2;
	while (taken.has(`${name} ${n}`.toLowerCase())) n++;
	return `${name} ${n}`;
}

const lowerSet = (names: Iterable<string>) =>
	new Set([...names].map((name) => name.trim().toLowerCase()));

/** A house name for this kind (no kind: an ordinary house), not one of `taken`. */
export function rollHouseName(
	kind: HouseKind | '' = '',
	taken: Iterable<string> = [],
	random: Random = Math.random
): string {
	const places = PLACE_WORDS.houses[kind || 'house'];
	const roll = () => {
		if (random() >= 0.2) return rollWords(places, 0.45, random);
		// A lone creature in front of the building now and then: "Marmot Manor".
		const place = pick(places, random);
		return `${pickLike(PLACE_WORDS.creatures, place, random)} ${place}`;
	};
	return rollFree(roll, lowerSet(taken));
}

/**
 * `count` room names of this kind (no kind: rooms), all different and none
 * of `taken`. One roll uses every place word once before it repeats one, so
 * nine huts are not five Sheds.
 */
export function rollRoomNames(
	count: number,
	kind: RoomKind | '' = '',
	taken: Iterable<string> = [],
	random: Random = Math.random
): string[] {
	const places = PLACE_WORDS.rooms[kind || 'room'];
	const used = lowerSet(taken);
	const names: string[] = [];
	let fresh: string[] = [];
	for (let i = 0; i < count; i++) {
		if (fresh.length === 0) fresh = [...places];
		let place = '';
		const name = rollFree(() => {
			place = pick(fresh, random);
			return wordsFor(place, 0.45, random);
		}, used);
		fresh = fresh.filter((word) => word !== place);
		used.add(name.toLowerCase());
		names.push(name);
	}
	return names;
}
