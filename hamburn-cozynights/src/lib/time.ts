/**
 * Event-time helpers. The event runs in Europe/Berlin, and admin forms use
 * `<input type="datetime-local">`, whose value carries no timezone. These
 * helpers convert between that wall-clock value and ISO instants explicitly,
 * so neither the server's timezone (UTC in the container) nor the admin's
 * browser timezone changes the meaning of an entered time.
 */

export const EVENT_TIME_ZONE = 'Europe/Berlin';

const LOCAL_VALUE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

const wallClock = new Intl.DateTimeFormat('en-US', {
	timeZone: EVENT_TIME_ZONE,
	hourCycle: 'h23',
	year: 'numeric',
	month: '2-digit',
	day: '2-digit',
	hour: '2-digit',
	minute: '2-digit',
	second: '2-digit'
});

function wallClockParts(instant: number) {
	const parts: Record<string, number> = {};
	for (const part of wallClock.formatToParts(new Date(instant))) {
		if (part.type !== 'literal') parts[part.type] = Number(part.value);
	}
	return parts;
}

/** Offset of the event timezone from UTC at the given instant, in ms. */
function offsetAt(instant: number): number {
	const p = wallClockParts(instant);
	const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
	return asUtc - Math.floor(instant / 1000) * 1000;
}

/**
 * "2026-09-20T18:00" (Berlin wall time) -> "2026-09-20T16:00:00.000Z".
 * Returns '' for malformed input.
 */
export function berlinLocalToIso(value: string): string {
	const m = LOCAL_VALUE.exec(value.trim());
	if (!m) return '';
	const [year, month, day, hour, minute] = m.slice(1).map(Number);
	const wallAsUtc = Date.UTC(year, month - 1, day, hour, minute);
	if (Number.isNaN(wallAsUtc)) return '';
	// Date.UTC rolls impossible dates over ("2026-02-31" becomes 3 March,
	// "18:99" becomes 19:39), so a typo would silently book a different moment.
	// Only a value that survives the round trip unchanged is a real date.
	const back = new Date(wallAsUtc);
	if (
		back.getUTCFullYear() !== year ||
		back.getUTCMonth() !== month - 1 ||
		back.getUTCDate() !== day ||
		back.getUTCHours() !== hour ||
		back.getUTCMinutes() !== minute
	) {
		return '';
	}

	// Two passes settle the offset across DST transitions.
	let instant = wallAsUtc - offsetAt(wallAsUtc);
	instant = wallAsUtc - offsetAt(instant);
	return new Date(instant).toISOString();
}

/** ISO instant -> "YYYY-MM-DDTHH:mm" in Berlin wall time (for datetime-local inputs). */
export function isoToBerlinLocal(iso: string): string {
	const instant = new Date(iso).getTime();
	if (Number.isNaN(instant)) return '';
	const p = wallClockParts(instant);
	const pad = (n: number) => String(n).padStart(2, '0');
	return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

/**
 * How long ago something happened, in English and short enough for a chip:
 * "just now", "12 s ago", "4 min ago", "2 h ago", "3 days ago".
 *
 * The app is English only (see $lib/dialogs), so this deliberately does not
 * follow the browser language the way Intl.RelativeTimeFormat would.
 */
export function relativeTime(iso: string | null | undefined, now = Date.now()): string {
	if (!iso) return 'never';
	const then = new Date(iso).getTime();
	if (Number.isNaN(then)) return 'unknown';
	const seconds = Math.round((now - then) / 1000);
	if (seconds < 0) return 'just now';
	if (seconds < 5) return 'just now';
	if (seconds < 60) return `${seconds} s ago`;
	const minutes = Math.round(seconds / 60);
	if (minutes < 60) return `${minutes} min ago`;
	const hours = Math.round(minutes / 60);
	if (hours < 24) return `${hours} h ago`;
	const days = Math.round(hours / 24);
	return days === 1 ? 'yesterday' : `${days} days ago`;
}
