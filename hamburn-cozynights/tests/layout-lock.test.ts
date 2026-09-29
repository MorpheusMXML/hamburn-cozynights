// tests/layout-lock.test.ts — the locked camp layout as the admin pages show
// it: the hint texts, the attributes a locked control carries, which keys
// count as a try, and where the hint bubble goes. The look and the listener
// itself are covered by the layout suite (tests/layout, "locked" cases) and the
// map's e2e test.
import { describe, it, expect } from 'vitest';
import { get } from 'svelte/store';
import {
	LOCK_SPOT_TIP,
	dismissLockHint,
	hintOf,
	isEditingKey,
	layoutLock,
	lockAttrs,
	placeLockHint,
	showLockHint,
	shownLockHint
} from '../src/lib/layout-lock';

describe('layoutLock', () => {
	it('names the phase and tells an admin who can lift the lock', () => {
		const hint = layoutLock('live', false)('move houses');
		expect(hint.title).toBe('Locked during Live Booking');
		expect(hint.text).toBe(
			"The camp layout holds the guests' bookings. To move houses, a superuser has to switch back to Staging Mode first."
		);
		expect(hint).not.toHaveProperty('tip');
	});

	it('tells a superuser where to switch', () => {
		const hint = layoutLock('closed', true)('delete spots');
		expect(hint.title).toBe('Locked while booking is closed');
		expect(hint.text).toContain('To delete spots, switch back to Staging Mode in 🎟 BOOKING WINDOW');
	});

	it('carries a tip when there is another way', () => {
		const hint = layoutLock('live', false)('activate or deactivate spots', LOCK_SPOT_TIP);
		expect(hint.tip).toBe(LOCK_SPOT_TIP);
		expect(LOCK_SPOT_TIP).toContain('works in every phase');
	});
});

describe('lockAttrs', () => {
	it('adds nothing while the layout can be changed', () => {
		expect(lockAttrs(null)).toEqual({});
		expect(lockAttrs(undefined)).toEqual({});
		expect(lockAttrs(false)).toEqual({});
	});

	it('marks a locked control: focusable, disabled for assistive tech, with its hint', () => {
		const attrs = lockAttrs(layoutLock('live', false)('add rooms'));
		expect(attrs).toEqual({
			'aria-disabled': 'true',
			title: 'Locked during Live Booking',
			'data-locked': '',
			'data-lock-title': 'Locked during Live Booking',
			'data-lock-text':
				"The camp layout holds the guests' bookings. To add rooms, a superuser has to switch back to Staging Mode first."
		});
		// Never the real `disabled`: that would swallow the click that explains it.
		expect(attrs).not.toHaveProperty('disabled');
	});

	it('passes the tip along, and hintOf reads everything back', () => {
		const hint = layoutLock('live', true)('delete spots', LOCK_SPOT_TIP);
		const attrs = lockAttrs(hint);
		expect(attrs['data-lock-tip']).toBe(LOCK_SPOT_TIP);
		// What the element's dataset looks like after rendering these attributes.
		const dataset = {
			locked: attrs['data-locked'],
			lockTitle: attrs['data-lock-title'],
			lockText: attrs['data-lock-text'],
			lockTip: attrs['data-lock-tip']
		};
		expect(hintOf({ dataset })).toEqual(hint);
		expect(hintOf({ dataset: { lockTitle: 'T', lockText: 'X' } })).toEqual({
			title: 'T',
			text: 'X'
		});
	});
});

describe('isEditingKey', () => {
	const key = (
		k: string,
		mods: Partial<Record<'ctrlKey' | 'metaKey' | 'altKey', boolean>> = {}
	) => ({
		key: k,
		ctrlKey: false,
		metaKey: false,
		altKey: false,
		...mods
	});

	it('counts what would type, delete or submit', () => {
		for (const k of ['a', 'Z', '7', ' ', '-', 'Backspace', 'Delete', 'Enter']) {
			expect(isEditingKey(key(k)), k).toBe(true);
		}
	});

	it('leaves moving around and shortcuts alone', () => {
		for (const k of ['Tab', 'ArrowLeft', 'ArrowDown', 'Home', 'Escape', 'Shift', 'F5']) {
			expect(isEditingKey(key(k)), k).toBe(false);
		}
		expect(isEditingKey(key('c', { metaKey: true }))).toBe(false);
		expect(isEditingKey(key('a', { ctrlKey: true }))).toBe(false);
	});

	it('knows that AltGr and the Mac Option key type characters', () => {
		// AltGr+Q on a German Windows keyboard, Option+L on a German Mac: "@"
		expect(isEditingKey(key('@', { ctrlKey: true, altKey: true }))).toBe(true);
		expect(isEditingKey(key('@', { altKey: true }))).toBe(true);
	});
});

describe('placeLockHint', () => {
	const viewport = { width: 1280, height: 900 };
	const bubble = { width: 300, height: 100 };

	it('sits above the control, centred, the arrow on the control', () => {
		const anchor = { left: 600, top: 500, width: 80, height: 40 };
		const place = placeLockHint(anchor, bubble, viewport);
		expect(place.side).toBe('above');
		expect(place.top).toBe(500 - 10 - 100);
		expect(place.left).toBe(640 - 150);
		expect(place.arrowX).toBe(150);
	});

	it('goes below when the sticky header leaves no room above', () => {
		const anchor = { left: 600, top: 150, width: 80, height: 40 };
		const place = placeLockHint(anchor, bubble, viewport, 120);
		expect(place.side).toBe('below');
		expect(place.top).toBe(150 + 40 + 10);
	});

	it('stays inside the screen at the edges, the arrow still on the control', () => {
		const left = placeLockHint({ left: 4, top: 500, width: 40, height: 40 }, bubble, viewport);
		expect(left.left).toBe(8);
		expect(left.arrowX).toBe(16);

		// The control's centre is at 1260; the arrow stops at the bubble's rounded corner.
		const right = placeLockHint({ left: 1250, top: 500, width: 20, height: 40 }, bubble, viewport);
		expect(right.left).toBe(1280 - 8 - 300);
		expect(right.arrowX).toBe(300 - 16);
	});

	it('on a narrow phone the bubble keeps its margins', () => {
		const phone = { width: 320, height: 640 };
		const place = placeLockHint(
			{ left: 250, top: 400, width: 60, height: 44 },
			{ width: 304, height: 120 },
			phone
		);
		expect(place.left).toBe(8);
		expect(place.left + 304).toBeLessThanOrEqual(320 - 8);
	});

	it('picks the side with more room when neither fits', () => {
		const tall = { width: 300, height: 500 };
		const nearBottom = placeLockHint(
			{ left: 600, top: 700, width: 80, height: 40 },
			tall,
			viewport
		);
		expect(nearBottom.side).toBe('above');
		const nearTop = placeLockHint({ left: 600, top: 150, width: 80, height: 40 }, tall, viewport);
		expect(nearTop.side).toBe('below');
		// Never above the top margin, never below the bottom one.
		expect(nearBottom.top).toBeGreaterThanOrEqual(8);
		expect(nearTop.top + tall.height).toBeLessThanOrEqual(900 - 8);
	});
});

describe('the shown hint', () => {
	it('is one at a time, and every new one is a new one', () => {
		const hint = layoutLock('live', false)('move houses');
		showLockHint({ x: 10, y: 20 }, hint);
		const first = get(shownLockHint);
		expect(first).toMatchObject({ ...hint, anchor: { x: 10, y: 20 } });
		showLockHint(null, hint);
		const second = get(shownLockHint);
		expect(second?.id).not.toBe(first?.id);
		expect(second?.anchor).toBeNull();
		dismissLockHint();
		expect(get(shownLockHint)).toBeNull();
	});
});
