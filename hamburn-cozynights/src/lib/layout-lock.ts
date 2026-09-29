/**
 * The locked camp layout, as the admin pages show it.
 *
 * During Live Booking and after booking closed the server refuses every
 * structural change — adding, moving, renaming and deleting houses, rooms and
 * spots, (de)activating spots, marking them taken (isLayoutLocked in
 * $lib/server/settings, the actions, pb_hooks/cozy_layout.pb.js). That stays
 * the rule. The pages don't hide those controls either: they keep them where
 * they are, greyed out with a padlock, and a click, Enter or a typed key
 * answers with a short hint next to the control instead of doing nothing.
 *
 * A control opts in by spreading `lockAttrs(hint)`; a field also gets
 * `readonly`. The attributes are rendered on the server, so a locked page
 * never flashes up as editable. One listener for the whole admin area
 * (LockHintHost, in the admin layout) catches the tries; the look lives in
 * src/routes/state.css ("Locked controls").
 */
import { writable } from 'svelte/store';
import { lockedDuring, type BookingPhase } from '$lib/booking-phase';

export interface LockHint {
	/** "Locked during Live Booking" */
	title: string;
	/** Why, and who can lift the lock. */
	text: string;
	/** Another way to reach the goal right now, if there is one. */
	tip?: string;
}

/** The hint for one kind of change: `lock('move houses')`. */
export type LockFor = (change: string, tip?: string) => LockHint;

/**
 * Hints for the current phase and person. `change` completes "To …", e.g.
 * "delete spots"; superusers are told where to switch, admins who can.
 */
export function layoutLock(phase: BookingPhase, isSuperuser: boolean): LockFor {
	const title = `Locked ${lockedDuring(phase)}`;
	return (change, tip) => ({
		title,
		text: isSuperuser
			? `The camp layout holds the guests' bookings. To ${change}, switch back to Staging Mode in 🎟 BOOKING WINDOW first.`
			: `The camp layout holds the guests' bookings. To ${change}, a superuser has to switch back to Staging Mode first.`,
		...(tip ? { tip } : {})
	});
}

/** For the spot actions that are locked: locking a spot works in every phase. */
export const LOCK_SPOT_TIP =
	'To keep guests off a spot right now, lock it 🔒 instead: that works in every phase.';

export interface LockAttrs {
	'aria-disabled'?: 'true';
	title?: string;
	'data-locked'?: '';
	'data-lock-title'?: string;
	'data-lock-text'?: string;
	'data-lock-tip'?: string;
}

/**
 * The attributes of a locked control, or none: spread them on the button or
 * field, `<button {...lockAttrs(lock?.('delete spots'))}>` — after its own
 * `title`, which the lock's title replaces (hover tooltip; screen readers read
 * it as the reason). Not `disabled`: a disabled button can't be focused or
 * clicked, so it could never say why.
 */
export function lockAttrs(hint: LockHint | null | undefined | false): LockAttrs {
	if (!hint) return {};
	return {
		'aria-disabled': 'true',
		title: hint.title,
		'data-locked': '',
		'data-lock-title': hint.title,
		'data-lock-text': hint.text,
		...(hint.tip ? { 'data-lock-tip': hint.tip } : {})
	};
}

/** The hint a locked control carries (see lockAttrs). */
export function hintOf(element: { dataset: DOMStringMap }): LockHint {
	const { lockTitle = '', lockText = '', lockTip } = element.dataset;
	return { title: lockTitle, text: lockText, ...(lockTip ? { tip: lockTip } : {}) };
}

/**
 * A key that would type, delete or submit in a field — not Tab, the arrows or
 * a shortcut. Ctrl+Alt is AltGr (the @ on a German keyboard), and Alt alone
 * types on a Mac, so both count as typing.
 */
export function isEditingKey(event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey'>) {
	if (event.metaKey || (event.ctrlKey && !event.altKey)) return false;
	return (
		event.key.length === 1 ||
		event.key === 'Backspace' ||
		event.key === 'Delete' ||
		event.key === 'Enter'
	);
}

/** What the hint points at: a control, a spot on the map, or nothing (bottom centre). */
export type HintAnchor = Element | { x: number; y: number } | null;

export interface ShownLockHint extends LockHint {
	id: number;
	anchor: HintAnchor;
}

/** The hint on screen; LockHintHost draws it. One at a time. */
export const shownLockHint = writable<ShownLockHint | null>(null);

let nextId = 1;

export function showLockHint(anchor: HintAnchor, hint: LockHint) {
	shownLockHint.set({ ...hint, anchor, id: nextId++ });
}

export function dismissLockHint() {
	shownLockHint.set(null);
}

export interface Box {
	top: number;
	left: number;
	width: number;
	height: number;
}

export interface HintPlacement {
	top: number;
	left: number;
	/** Where the arrow sits, from the bubble's left edge. */
	arrowX: number;
	side: 'above' | 'below';
}

const GAP = 10;
const MARGIN = 8;
const ARROW_INSET = 16;

/**
 * Where the bubble goes: above the anchor, or below it when there is no room
 * above (under the sticky header, whose bottom edge is `safeTop`); centred on
 * the anchor, but always inside the viewport; the arrow points at the anchor.
 */
export function placeLockHint(
	anchor: Box,
	bubble: { width: number; height: number },
	viewport: { width: number; height: number },
	safeTop = 0
): HintPlacement {
	const centerX = anchor.left + anchor.width / 2;
	const maxLeft = Math.max(MARGIN, viewport.width - MARGIN - bubble.width);
	const left = Math.min(maxLeft, Math.max(MARGIN, centerX - bubble.width / 2));

	const minTop = safeTop + MARGIN;
	const maxTop = Math.max(minTop, viewport.height - MARGIN - bubble.height);
	const above = anchor.top - GAP - bubble.height;
	const below = anchor.top + anchor.height + GAP;
	const roomAbove = above >= minTop;
	const roomBelow = below <= maxTop;
	const side =
		roomAbove || (!roomBelow && anchor.top - minTop > viewport.height - below) ? 'above' : 'below';
	const top = side === 'above' ? Math.max(minTop, above) : Math.min(maxTop, below);

	const arrowX = Math.min(
		Math.max(ARROW_INSET, bubble.width - ARROW_INSET),
		Math.max(ARROW_INSET, centerX - left)
	);
	return { top, left, arrowX, side };
}
