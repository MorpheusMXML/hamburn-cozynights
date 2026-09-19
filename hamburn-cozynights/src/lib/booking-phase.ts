/**
 * The booking phase and the booking window: one place for the rules, used by
 * the server (settings, admin actions), the Control Center and the guests'
 * countdown. pb_hooks/lib/phase.js mirrors `effectivePhase` for PocketBase.
 *
 * Stored in app_settings:
 * - the base phase: `is_booking_active` (live) or `booking_closed` (closed),
 *   otherwise staging. Only superusers set it by hand; the admin actions also
 *   write the phase the timers have reached ("materialize"), which changes
 *   nothing a guest sees.
 * - the booking window: `booking_unlock_at` (opens) and `booking_close_at`
 *   (closes), plus `booking_timer_paused`. While the timer is armed (not
 *   paused), an elapsed opening time means live and an elapsed closing time
 *   means closed, whatever the base phase says. Computed on read: no job has
 *   to run at the target time.
 */

export type BookingPhase = 'staging' | 'live' | 'closed';

export interface BookingWindow {
	/** The phase set by hand (or materialized). The timers apply on top of it. */
	basePhase: BookingPhase;
	/** ISO instant or ''. */
	opensAt: string;
	/** ISO instant or ''. */
	closesAt: string;
	/** Paused timers keep their times but don't switch anything. */
	paused: boolean;
}

export interface PhaseTransition {
	/** ISO instant of the switch. */
	at: string;
	to: 'live' | 'closed';
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** Admins (not superusers) open booking at least one day ahead … */
export const MIN_LEAD_MS = DAY_MS;
/** … and keep it open for at least one day. */
export const MIN_OPEN_MS = DAY_MS;

export const PHASE_LABELS: Record<BookingPhase, string> = {
	staging: 'Staging',
	live: 'Live Booking',
	closed: 'Closed'
};

export const PHASE_ICONS: Record<BookingPhase, string> = {
	staging: '🛠',
	live: '🎪',
	closed: '🔒'
};

/** Why a guest's booking was refused outside Live Booking. */
export function bookingRefusal(phase: BookingPhase): string {
	return phase === 'closed'
		? 'Booking has closed. Nothing was booked.'
		: 'Booking is not open yet. Nothing was booked. Come back when Live Booking starts.';
}

/** "during Live Booking" / "while booking is closed", for messages about the locked layout. */
export function lockedDuring(phase: BookingPhase): string {
	return phase === 'closed' ? 'while booking is closed' : 'during Live Booking';
}

/** What a guest reads under their own spot when they can't change it right now. */
export function ownSpotNote(phase: BookingPhase): string {
	return phase === 'closed'
		? 'Spots are final now; this one stays yours.'
		: 'It stays reserved for you. Changes are possible again once Live Booking starts.';
}

/**
 * ms since the epoch, or null for '' and anything unparsable. PocketBase
 * writes "2026-09-21 16:00:00.000Z"; older Safari only parses it with a "T".
 */
export function toMs(iso: string | null | undefined): number | null {
	if (!iso) return null;
	const ms = new Date(iso.trim().replace(' ', 'T')).getTime();
	return Number.isNaN(ms) ? null : ms;
}

/** Same instant (or both empty)? PocketBase and the browser write ISO strings differently. */
export function sameInstant(a: string, b: string): boolean {
	return toMs(a) === toMs(b);
}

export function isArmed(w: BookingWindow): boolean {
	return !w.paused && (toMs(w.opensAt) !== null || toMs(w.closesAt) !== null);
}

export function effectivePhase(w: BookingWindow, now = Date.now()): BookingPhase {
	if (!w.paused) {
		const closes = toMs(w.closesAt);
		if (closes !== null && now >= closes) return 'closed';
		const opens = toMs(w.opensAt);
		if (opens !== null && now >= opens) return 'live';
	}
	return w.basePhase;
}

/** The next switch an armed timer will make, if any. */
export function nextTransition(w: BookingWindow, now = Date.now()): PhaseTransition | null {
	if (w.paused) return null;
	const phase = effectivePhase(w, now);
	const opens = toMs(w.opensAt);
	const closes = toMs(w.closesAt);
	// An opening at or after the closing time never shows: closed wins.
	if (phase !== 'live' && opens !== null && opens > now && (closes === null || closes > opens)) {
		return { at: w.opensAt, to: 'live' };
	}
	if (phase !== 'closed' && closes !== null && closes > now) {
		return { at: w.closesAt, to: 'closed' };
	}
	return null;
}

/**
 * Which countdown guests see: until booking opens, or while it is live until
 * it closes. Independent of the clock, so server and browser agree.
 */
export function countdownKind(
	phase: BookingPhase,
	next: PhaseTransition | null | undefined
): 'opens' | 'closes' | null {
	if (!next) return null;
	if (next.to === 'closed' && phase === 'live') return 'closes';
	if (next.to === 'live' && phase !== 'live') return 'opens';
	return null;
}

/**
 * The opening time the guest map counts down to: only an ARMED window whose
 * opening is still ahead. A planned-but-paused window, or an elapsed opening
 * kept for the Control Center, shows no countdown (nothing would happen).
 */
export function openingCountdownAt(
	phase: BookingPhase,
	next: PhaseTransition | null | undefined
): string {
	return countdownKind(phase, next) === 'opens' && next ? next.at : '';
}

/**
 * Whether the slim countdown bar shows on a page. The map draws its own big
 * "IGNITION IN" countdown, but only in Staging: in Closed with a later window
 * armed, the bar is the only countdown it has.
 */
export function showCountdownBar(
	phase: BookingPhase,
	next: PhaseTransition | null | undefined,
	pathname: string
): boolean {
	const kind = countdownKind(phase, next);
	if (kind === 'closes') return true;
	return kind === 'opens' && !(phase === 'staging' && pathname === '/map');
}

/**
 * How long a page waits before it asks the server again for a phase its own
 * clock has already reached (the browser's clock may run ahead): every 5 s
 * for two minutes, then every 30 s.
 */
export function resyncDelay(attempt: number): number {
	return attempt < 24 ? 5_000 : 30_000;
}

/** The stored fields as the settings record has them. */
export interface StoredPhaseFields {
	is_booking_active?: boolean;
	booking_closed?: boolean;
	booking_unlock_at?: string;
	booking_close_at?: string;
	booking_timer_paused?: boolean;
}

export function windowFromRecord(record: StoredPhaseFields | null | undefined): BookingWindow {
	return {
		basePhase: record?.is_booking_active ? 'live' : record?.booking_closed ? 'closed' : 'staging',
		opensAt: record?.booking_unlock_at || '',
		closesAt: record?.booking_close_at || '',
		paused: !!record?.booking_timer_paused
	};
}

export function windowToRecord(w: BookingWindow): Required<StoredPhaseFields> {
	return {
		is_booking_active: w.basePhase === 'live',
		booking_closed: w.basePhase === 'closed',
		booking_unlock_at: w.opensAt,
		booking_close_at: w.closesAt,
		booking_timer_paused: w.paused
	};
}

/** The same window with the phase the timers have reached written as its base phase. */
export function materialize(w: BookingWindow, now = Date.now()): BookingWindow {
	return { ...w, basePhase: effectivePhase(w, now) };
}

/**
 * A superuser's switch "right now". It replaces the current window's timer:
 * - Live: a planned opening is dropped (it opened now), an elapsed closing
 *   time too (it would close booking again right away); a future closing
 *   time stays and closes booking as planned.
 * - Closed: the current window's closing time is dropped (it closed now).
 * - Staging: nothing switches by itself any more (the timer is paused).
 * A window planned for later (its opening still ahead) stays armed when
 * closing or going back to Staging. Times that would override the new phase
 * right away are paused, so their times stay visible.
 */
export function switchPhase(w: BookingWindow, to: BookingPhase, now = Date.now()): BookingWindow {
	const next: BookingWindow = { ...w, basePhase: to };
	const opens = toMs(next.opensAt);
	const closes = toMs(next.closesAt);
	const laterWindow = !next.paused && opens !== null && opens > now;
	if (to === 'live') {
		if (laterWindow) next.opensAt = '';
		if (closes !== null && closes <= now) next.closesAt = '';
	} else if (!laterWindow) {
		if (to === 'closed' && closes !== null && closes > now) next.closesAt = '';
		if (to === 'staging' && (opens !== null || closes !== null)) next.paused = true;
	}
	if (effectivePhase(next, now) !== to) next.paused = true;
	return next;
}

export type WindowEdit = Pick<BookingWindow, 'opensAt' | 'closesAt' | 'paused'>;

/**
 * The edit "save these times": an armed timer stays armed, a paused one
 * paused, and a window planned from scratch starts unarmed — arming is its
 * own step. Without any time the timer has nothing to do (not paused).
 */
export function saveTimesEdit(
	current: BookingWindow,
	opensAt: string,
	closesAt: string
): WindowEdit {
	const hadTimes = toMs(current.opensAt) !== null || toMs(current.closesAt) !== null;
	const hasTimes = !!opensAt || !!closesAt;
	return { opensAt, closesAt, paused: hasTimes && (current.paused || !hadTimes) };
}

const berlinFormat = new Intl.DateTimeFormat('en-GB', {
	timeZone: 'Europe/Berlin',
	hourCycle: 'h23',
	year: 'numeric',
	month: 'numeric',
	day: 'numeric',
	hour: '2-digit',
	minute: '2-digit'
});
// Own English names instead of Intl month/weekday names: those differ
// between ICU versions ("Sep" vs "Sept"), i.e. between server and browser.
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Mon 21 Sep 2026 · 18:00" in Berlin time ('' for an invalid value). */
export function formatBerlin(iso: string, { year = true } = {}): string {
	const ms = toMs(iso);
	if (ms === null) return '';
	const p: Record<string, number> = {};
	for (const part of berlinFormat.formatToParts(new Date(ms))) {
		if (part.type !== 'literal') p[part.type] = Number(part.value);
	}
	const weekday = WEEKDAYS[new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay()];
	const pad = (n: number) => String(n).padStart(2, '0');
	const date = `${weekday} ${p.day} ${MONTHS[p.month - 1]}${year ? ` ${p.year}` : ''}`;
	return `${date} · ${pad(p.hour)}:${pad(p.minute)}`;
}

export interface DurationParts {
	days: number;
	hours: number;
	minutes: number;
	seconds: number;
}

export function splitDuration(ms: number): DurationParts {
	const total = Math.max(0, Math.floor(ms / 1000));
	return {
		days: Math.floor(total / 86400),
		hours: Math.floor((total % 86400) / 3600),
		minutes: Math.floor((total % 3600) / 60),
		seconds: total % 60
	};
}

/** "6 days 5 hours", "1 day", "3 hours 20 minutes", "45 minutes" — rounded down. */
export function formatDuration(ms: number): string {
	const { days, hours, minutes } = splitDuration(ms);
	const unit = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
	if (days > 0)
		return hours > 0 ? `${unit(days, 'day')} ${unit(hours, 'hour')}` : unit(days, 'day');
	if (hours > 0)
		return minutes > 0 ? `${unit(hours, 'hour')} ${unit(minutes, 'minute')}` : unit(hours, 'hour');
	return unit(Math.max(minutes, ms > 0 ? 1 : 0), 'minute');
}

export interface EditCheck {
	/** Why the change is refused, or '' if it's fine. */
	error: string;
	/** The phase right now, before and after the change. */
	phaseBefore: BookingPhase;
	phaseAfter: BookingPhase;
	/** What will be stored (base phase materialized). */
	next: BookingWindow;
}

/**
 * Checks a change of the booking window (times and/or armed state).
 *
 * Everyone: the closing time comes after the opening time. Admins who are
 * not superusers additionally can't switch the phase right now (that is the
 * superuser's override), open booking at least MIN_LEAD_MS ahead and keep it
 * open for at least MIN_OPEN_MS. Times an armed timer already had are not
 * checked again, so editing only the closing time works even when the
 * opening is less than a day away.
 */
export function checkWindowEdit(
	current: BookingWindow,
	edit: WindowEdit,
	{ isSuperuser, now = Date.now() }: { isSuperuser: boolean; now?: number }
): EditCheck {
	const base = materialize(current, now);
	const next: BookingWindow = { ...base, ...edit };
	const phaseBefore = base.basePhase;
	const phaseAfter = effectivePhase(next, now);
	const result = (error: string): EditCheck => ({ error, phaseBefore, phaseAfter, next });

	const opens = toMs(next.opensAt);
	const closes = toMs(next.closesAt);
	if (next.opensAt && opens === null) return result('The opening time is not a valid date.');
	if (next.closesAt && closes === null) return result('The closing time is not a valid date.');
	if (opens !== null && closes !== null && closes <= opens) {
		return result('Booking has to close after it opens. Pick a later closing time.');
	}
	if (isSuperuser) return result('');

	if (phaseAfter !== phaseBefore) {
		const why =
			phaseAfter === 'live'
				? 'This would open booking right now.'
				: phaseAfter === 'closed'
					? 'This would close booking right now.'
					: 'This would switch back to Staging right now.';
		return result(
			`${why} Only a superuser can switch the phase right now; as an admin, plan it at least one day ahead.`
		);
	}
	// Nothing armed: no timer rules (arming checks them).
	if (next.paused || (opens === null && closes === null)) return result('');

	// Times the armed timer already had don't need to be ahead any more.
	const wasArmed = !current.paused;
	const opensChanged = !wasArmed || !sameInstant(next.opensAt, current.opensAt);
	const closesChanged = !wasArmed || !sameInstant(next.closesAt, current.closesAt);
	const earliestOpen = now + MIN_LEAD_MS;

	if (phaseAfter !== 'live') {
		if (opens === null) return result('Set when booking opens.');
		if (opensChanged && opens < earliestOpen) {
			return result(
				`Booking can open ${formatBerlin(new Date(earliestOpen).toISOString())} at the earliest (one day ahead). Only a superuser can open it sooner.`
			);
		}
	}
	if (closes === null) return result('Set when booking closes.');
	if (closesChanged) {
		const from = phaseAfter === 'live' || opens === null ? now : Math.max(now, opens);
		const earliestClose = from + MIN_OPEN_MS;
		if (closes < earliestClose) {
			return result(
				`Booking has to stay open for at least one day: close it ${formatBerlin(new Date(earliestClose).toISOString())} or later. Only a superuser can close it sooner.`
			);
		}
	}
	return result('');
}
