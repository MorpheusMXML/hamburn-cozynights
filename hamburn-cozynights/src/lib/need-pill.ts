// src/lib/need-pill.ts
/**
 * How a ticked need shows as a pill in the admin area — on a request's card
 * and in the spot picker: pink for something the guest needs (pink is ♿
 * alone, src/routes/state.css), outlined and with its own icon for anything
 * else — what an art project or crew asks for, or a helper coming along.
 * Pure code without I/O, shared by the requests page and the unit tests.
 */
import { needShort } from './accommodation';
import { isProjectNeed, needLabel, type SpecialNeed } from './special-needs';

/**
 * The needs that are no health need, with their icons. `close_together` is
 * off the form (old requests still show it); a value the form doesn't know
 * (yet) never matches.
 */
const NEUTRAL_ICONS: Record<string, string> = {
	own_room: '🎨',
	close_together: '👥',
	near_project: '📍',
	helper: '🤝'
};

export interface NeedPill {
	text: string;
	/** Outlined: a project's wish or a helper, no health need. */
	neutral: boolean;
}

/**
 * @param short the few words of the spot picker ("No ladder") instead of the
 *   form's whole sentence
 */
export function needPill(need: SpecialNeed, short = false): NeedPill {
	const icon = NEUTRAL_ICONS[need];
	const neutral = isProjectNeed(need) || icon !== undefined;
	const words = short ? needShort(need) : needLabel(need);
	return { text: neutral && icon ? `${icon} ${words}` : words, neutral };
}
