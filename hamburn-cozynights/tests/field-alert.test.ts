// tests/field-alert.test.ts — after a refused submit the form points at what
// to fix: focus on the first refused field, a nudge for each, the ping again.
// The unit suite has no DOM library, so the elements here are small fakes
// with just the methods the helper uses; the real look is covered by the
// layout suite (tests/layout, "refused" cases) in Chromium and WebKit.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { invalidControls, nudge, replay, revealInvalid, visibleBox } from '../src/lib/field-alert';

vi.mock('svelte', () => ({ tick: () => Promise.resolve() }));

interface Fake {
	tag: string;
	attrs: Record<string, string>;
	classes: string[];
	children: Fake[];
	parent: Fake | null;
	focus: ReturnType<typeof vi.fn>;
	animate: ReturnType<typeof vi.fn>;
	scrollIntoView: ReturnType<typeof vi.fn>;
	animations: { animationName: string; cancel: () => void; play: () => void }[];
}

function el(tag: string, attrs: Record<string, string> = {}, children: Fake[] = []): Fake {
	const node: Fake = {
		tag,
		attrs,
		classes: (attrs.class ?? '').split(' ').filter(Boolean),
		children,
		parent: null,
		focus: vi.fn(),
		animate: vi.fn(),
		scrollIntoView: vi.fn(),
		animations: []
	};
	for (const child of children) child.parent = node;
	return node;
}

/** Just enough CSS selector matching for the selectors field-alert uses. */
function matches(node: Fake, selector: string): boolean {
	return selector.split(',').some((part) => {
		const s = part.trim();
		if (s === 'input' || s === 'select' || s === 'textarea') return node.tag === s;
		if (s === '[aria-invalid="true"]') return node.attrs['aria-invalid'] === 'true';
		if (s === '.field-box') return node.classes.includes('field-box');
		if (s === '.field-box[data-state="danger"]')
			return node.classes.includes('field-box') && node.attrs['data-state'] === 'danger';
		throw new Error(`fake matcher cannot read ${s}`);
	});
}

function descendants(node: Fake): Fake[] {
	return node.children.flatMap((child) => [child, ...descendants(child)]);
}

/**
 * Wraps a fake tree in the DOM methods field-alert calls. One wrapper per
 * node, like the real DOM hands out the same element every time — the helper
 * relies on that to nudge a box only once.
 */
const wrappers = new WeakMap<Fake, any>();
function dom(node: Fake): HTMLElement {
	const wrap = (n: Fake): any => {
		if (!wrappers.has(n)) wrappers.set(n, build(n));
		return wrappers.get(n);
	};
	const build = (n: Fake): any => ({
		fake: n,
		matches: (selector: string) => matches(n, selector),
		querySelector: (selector: string) => {
			const found = descendants(n).find((d) => matches(d, selector));
			return found ? wrap(found) : null;
		},
		querySelectorAll: (selector: string) =>
			descendants(n)
				.filter((d) => matches(d, selector))
				.map(wrap),
		closest: (selector: string) => {
			for (let at: Fake | null = n; at; at = at.parent) if (matches(at, selector)) return wrap(at);
			return null;
		},
		focus: n.focus,
		animate: n.animate,
		scrollIntoView: n.scrollIntoView,
		getAnimations: () => n.animations
	});
	return wrap(node);
}

const unwrap = (element: HTMLElement | null) => (element as unknown as { fake: Fake } | null)?.fake;

afterEach(() => vi.unstubAllGlobals());

describe('finding what was refused', () => {
	it('finds refused controls and refused boxes, in document order, and nothing else', () => {
		const name = el('input', { 'aria-invalid': 'true' });
		const fine = el('input', { 'aria-invalid': 'false' });
		const consent = el('input', { type: 'checkbox' });
		const box = el('label', { class: 'field-box', 'data-state': 'danger' }, [consent]);
		const form = el('form', {}, [name, fine, box]);
		expect(invalidControls(dom(form)).map(unwrap)).toEqual([name, box]);
	});

	it('ignores an aria-invalid decoration that holds no field', () => {
		const badge = el('span', { 'aria-invalid': 'true' });
		expect(invalidControls(dom(el('form', {}, [badge])))).toEqual([]);
	});

	it('looks at the box a field lives in, not at the bare field', () => {
		const input = el('input', { 'aria-invalid': 'true' });
		const box = el('form', { class: 'field-box' }, [input]);
		el('main', {}, [box]);
		expect(unwrap(visibleBox(dom(input)))).toBe(box);
		const alone = el('input', { 'aria-invalid': 'true' });
		el('form', {}, [alone]);
		expect(unwrap(visibleBox(dom(alone)))).toBe(alone);
	});
});

describe('revealInvalid', () => {
	it('focuses the first refused field and nudges every refused one once', async () => {
		const first = el('input', { 'aria-invalid': 'true' });
		const second = el('textarea', { 'aria-invalid': 'true' });
		const form = el('form', {}, [el('input'), first, second]);

		const focused = await revealInvalid(dom(form));

		expect(unwrap(focused)).toBe(first);
		expect(first.focus).toHaveBeenCalledWith({ preventScroll: true });
		expect(second.focus).not.toHaveBeenCalled();
		expect(first.scrollIntoView).toHaveBeenCalledOnce();
		expect(first.animate).toHaveBeenCalledOnce();
		expect(second.animate).toHaveBeenCalledOnce();
	});

	it('puts the cursor into a refused box and nudges the box, once', async () => {
		const input = el('input', { 'aria-invalid': 'true' });
		const box = el('form', { class: 'field-box', 'data-state': 'danger' }, [input]);
		const page = el('main', {}, [box]);

		await revealInvalid(dom(page));

		expect(input.focus).toHaveBeenCalledOnce();
		// Marked twice (the box and the field in it), nudged once: the box.
		expect(box.animate).toHaveBeenCalledOnce();
		expect(input.animate).not.toHaveBeenCalled();
	});

	it('does nothing and says so when nothing is marked', async () => {
		const input = el('input');
		expect(await revealInvalid(dom(el('form', {}, [input])))).toBeNull();
		expect(input.focus).not.toHaveBeenCalled();
		expect(await revealInvalid(null)).toBeNull();
	});

	it('keeps still for people who asked for less motion', async () => {
		vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduce') }));
		const input = el('input', { 'aria-invalid': 'true' });
		await revealInvalid(dom(el('form', {}, [input])));
		expect(input.focus).toHaveBeenCalledOnce();
		expect(input.animate).not.toHaveBeenCalled();
		expect(input.scrollIntoView).toHaveBeenCalledWith({ behavior: 'auto', block: 'nearest' });
	});
});

describe('replay', () => {
	it('restarts the ping and the alert ring, and leaves other animations alone', () => {
		const input = el('input');
		const restart = (animationName: string) => ({
			animationName,
			cancel: vi.fn(),
			play: vi.fn()
		});
		const ping = restart('field-refused');
		const ring = restart('state-alert');
		const breathe = restart('state-breathe');
		input.animations = [ping, ring, breathe];

		replay(dom(input));

		for (const animation of [ping, ring]) {
			expect(animation.cancel).toHaveBeenCalledOnce();
			expect(animation.play).toHaveBeenCalledOnce();
		}
		expect(breathe.cancel).not.toHaveBeenCalled();
	});
});

describe('nudge', () => {
	it('shakes sideways only, so it stays on the compositor', () => {
		const input = el('input');
		nudge(dom(input));
		const [frames, timing] = input.animate.mock.calls[0];
		expect(frames.every((frame: Keyframe) => Object.keys(frame).join() === 'transform')).toBe(true);
		expect(timing.duration).toBeLessThanOrEqual(400);
	});
});
