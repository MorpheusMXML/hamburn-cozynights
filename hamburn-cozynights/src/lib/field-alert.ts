/**
 * Points at the fields a form refused.
 *
 * The forms mark a refused field with aria-invalid="true", as they always did
 * for screen readers; src/routes/state.css turns that attribute into the look
 * (red border, one ping, a steady glow). This adds what CSS can't do on its
 * own, after every refused submit — by the browser's checks or the server's:
 *
 *  - the cursor lands in the first refused field, scrolled into view,
 *  - every refused field gets a short sideways nudge,
 *  - the ping plays again, so a second click on "save" is never silent.
 *
 * All motion is `transform`/`opacity`/one-off and skipped entirely with
 * prefers-reduced-motion.
 */
import { tick } from 'svelte';

const CONTROLS = 'input, select, textarea';

/** Animations the replay restarts: the field ping and the box's alert ring. */
const REPLAYED = new Set(['field-refused', 'state-alert']);

const NUDGE: Keyframe[] = [
	{ transform: 'translateX(0)' },
	{ transform: 'translateX(-5px)' },
	{ transform: 'translateX(4px)' },
	{ transform: 'translateX(-2px)' },
	{ transform: 'translateX(0)' }
];

export function prefersReducedMotion(): boolean {
	return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Everything marked as refused inside `root`, in document order: controls with
 * aria-invalid="true", and composite boxes (.field-box) in the danger state —
 * a group of checkboxes has no single control to mark.
 */
export function invalidControls(root: ParentNode): HTMLElement[] {
	return Array.from(
		root.querySelectorAll<HTMLElement>('[aria-invalid="true"], .field-box[data-state="danger"]')
	).filter((element) => element.matches(CONTROLS) || element.querySelector(CONTROLS) !== null);
}

/** What the eye should land on: the field itself, or the box it lives in. */
export function visibleBox(control: HTMLElement): HTMLElement {
	return control.closest<HTMLElement>('.field-box') ?? control;
}

/** A short sideways shake. Transform only, so it stays on the compositor. */
export function nudge(element: HTMLElement) {
	if (prefersReducedMotion() || typeof element.animate !== 'function') return;
	element.animate(NUDGE, { duration: 320, easing: 'ease-in-out' });
}

/** Restarts the CSS ping/ring of an element that was already refused before. */
export function replay(element: HTMLElement) {
	if (typeof element.getAnimations !== 'function') return;
	for (const animation of element.getAnimations({ subtree: true })) {
		const name = (animation as CSSAnimation).animationName;
		if (name && REPLAYED.has(name)) {
			animation.cancel();
			animation.play();
		}
	}
}

/**
 * After a refused submit: waits for the error markup to render, then focuses
 * the first refused field (scrolled into view) and nudges every one of them.
 * Returns the focused field, or null when nothing was marked — then the
 * form-level message is the whole story and the caller shows it.
 */
export async function revealInvalid(root: HTMLElement | null | undefined) {
	if (!root) return null;
	await tick();
	const refused = invalidControls(root);
	if (refused.length === 0) return null;

	const first = refused[0];
	const focusTarget = first.matches(CONTROLS)
		? first
		: (first.querySelector<HTMLElement>(CONTROLS) ?? first);
	focusTarget.focus({ preventScroll: true });
	visibleBox(first).scrollIntoView({
		behavior: prefersReducedMotion() ? 'auto' : 'smooth',
		block: 'nearest'
	});

	const boxes = new Set(refused.map(visibleBox));
	for (const box of boxes) {
		replay(box);
		nudge(box);
	}
	return focusTarget;
}
