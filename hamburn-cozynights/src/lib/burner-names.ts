/**
 * The burner names the app hands out. The booking dialog's slot machine and
 * the Destiny Roulette roll through this list in the browser; the server
 * picks from the same list when a booking comes without a name (room page,
 * special-needs spots). One list, so the roulette never shows a name the
 * server would not give, and the "#417" suffix is the same everywhere.
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

/** A name from the list, or the given one, with a three-digit tag: "Disco Druid #417". */
export function randomBurnerName(
	base: string = BURNER_NAMES[Math.floor(Math.random() * BURNER_NAMES.length)]
): string {
	return `${base} #${Math.floor(100 + Math.random() * 900)}`;
}
