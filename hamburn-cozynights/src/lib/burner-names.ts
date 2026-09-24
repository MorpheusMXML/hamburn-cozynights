/**
 * The burner names the app hands out. The booking dialog's slot machine and
 * the Destiny Roulette roll through them in the browser; the server draws
 * from the same source when a booking comes without a name (room page,
 * special-needs spots). One module, so the roulette never shows a name the
 * server would not give, and the "#417" suffix is the same everywhere.
 *
 * A rolled name is either one of the classics below or a fresh mix of an
 * adjective, a creature and, now and then, an epithet (BURNER_SPICE): "Dusty
 * Unicorn, Keeper of the Moop #417". The mix keeps names from repeating
 * across a camp of three hundred guests; the classics keep the flavour.
 */
export const BURNER_NAMES: readonly string[] = [
	'Bass Beast',
	'Cactus Jack',
	'Cosmic Coyote',
	'Cyber Cipher',
	'Desert Rose',
	'Disco Druid',
	'Dust Bunny',
	'Dusty Nomad',
	'Fire Starter',
	'Fire Weaver',
	'Gifting Goblin',
	'Glow Worm',
	'Infinite Improviser',
	'Laser Lynx',
	'LED Lizard',
	'Midnight Muse',
	'Mirage Maker',
	'Moop Master',
	'Neon Lizard',
	'Neon Nebula',
	'Neon Shaman',
	'Oasis Owl',
	'Plasma Puma',
	'Prism Pilot',
	'Quantum Quokka',
	'Quartz Queen',
	'Radical Robot',
	'Silver Streak',
	'Solar Flare',
	'Solar Sprite',
	'Spark Plug',
	'Sparkle Pony',
	'Stardust Scout',
	'Temple Guardian',
	'Thunder Thistle',
	'Vortex Voyager',
	'Zenith Zephyr'
];

/** What a fresh name is mixed from. Words, not jokes about anyone: every combination has to be fine on a bed. */
export const BURNER_SPICE = {
	adjectives: [
		'Barefoot',
		'Bass-Heavy',
		'Caffeinated',
		'Chrome',
		'Cosmic',
		'Disco',
		'Dusty',
		'Electric',
		'Feral',
		'Fluffy',
		'Fuzzy',
		'Glitter',
		'Glowing',
		'Holographic',
		'Hydrated',
		'Laser',
		'Majestic',
		'Midnight',
		'Moop-Free',
		'Neon',
		'Playa',
		'Radical',
		'Sequined',
		'Sparkly',
		'Sunrise',
		'Thunderous',
		'Tutu-Clad',
		'Unicorn-Adjacent',
		'Velvet',
		'Wobbly'
	],
	creatures: [
		'Alpaca',
		'Astronaut',
		'Cactus',
		'Capybara',
		'Disco Ball',
		'Dragon',
		'Fairy',
		'Flamingo',
		'Goblin',
		'Hedgehog',
		'Jellyfish',
		'Kraken',
		'Llama',
		'Mermaid',
		'Moth',
		'Mushroom',
		'Narwhal',
		'Octopus',
		'Otter',
		'Owl',
		'Panda',
		'Phoenix',
		'Pirate',
		'Raccoon',
		'Robot',
		'Sasquatch',
		'Sloth',
		'Space Cadet',
		'Unicorn',
		'Wizard',
		'Wombat',
		'Yeti'
	],
	// "of …" and "from …" follow the creature directly, a title comes after a comma.
	epithets: [
		'of the Dust',
		'from Planet Glitter',
		'of Camp Cuddle',
		'the Slightly Feral',
		'the Unreasonable',
		'Keeper of the Moop',
		'Supreme Snack Officer',
		'Minister of Sparkle',
		'Chief of Naps',
		'Certified Tutu Pilot',
		'Bringer of Blinky Lights',
		'First of Their Name',
		'PhD in Hugs',
		'Late for Sunrise',
		'Esq.'
	]
} as const;

/** The longest a burner name may be; the booking form and the server cut at the same place. */
export const BURNER_NAME_MAX = 80;

type Random = () => number;

function pick<T>(list: readonly T[], random: Random): T {
	return list[Math.floor(random() * list.length)];
}

function epithetJoin(epithet: string): string {
	return /^(of|from|the) /.test(epithet) ? ` ${epithet}` : `, ${epithet}`;
}

/**
 * A name without its tag: one of the classics, or a fresh mix. `random` is
 * only there for the tests; the app rolls with Math.random.
 */
export function burnerNameBase(random: Random = Math.random): string {
	if (random() < 0.3) return pick(BURNER_NAMES, random);
	let base = `${pick(BURNER_SPICE.adjectives, random)} ${pick(BURNER_SPICE.creatures, random)}`;
	if (random() < 0.3) base += epithetJoin(pick(BURNER_SPICE.epithets, random));
	return base;
}

/** Whether a base could have come out of burnerNameBase(): a classic, or adjective + creature (+ epithet). */
export function isRolledBurnerName(base: string): boolean {
	if (BURNER_NAMES.includes(base)) return true;
	let core = base;
	for (const epithet of BURNER_SPICE.epithets) {
		const tail = epithetJoin(epithet);
		if (core.endsWith(tail)) {
			core = core.slice(0, -tail.length);
			break;
		}
	}
	return BURNER_SPICE.adjectives.some(
		(adjective) =>
			core.startsWith(`${adjective} `) &&
			(BURNER_SPICE.creatures as readonly string[]).includes(core.slice(adjective.length + 1))
	);
}

/** A rolled name, or the given base, with a three-digit tag: "Disco Druid #417". */
export function randomBurnerName(base: string = burnerNameBase()): string {
	return `${base} #${Math.floor(100 + Math.random() * 900)}`;
}
