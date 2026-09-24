<!--
@component
Answers a try on a locked control (see $lib/layout-lock.ts). Mounted once in
the admin layout.

- It listens for clicks, Enter and typed keys on every `[data-locked]`
  element, in the capture phase on the document: the control's own handlers
  and the browser's default (send the form, follow the link) never run.
- The control shakes once and its padlock rattles (`data-lock-rattle`,
  styled in src/routes/state.css).
- A small bubble next to it says why and who can lift the lock. It follows
  the control while the page scrolls and fades out after a few seconds — not
  while the pointer rests on it or the control is still worked with the
  keyboard — or with Escape, a click elsewhere or the next hint. A polite
  live region reads it to screen readers.

The map calls showLockHint() itself: a pin that can't be dragged is no
locked control, it still opens its house.
-->
<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { fade } from 'svelte/transition';
	import { afterNavigate } from '$app/navigation';
	import LockGlyph from '$lib/components/LockGlyph.svelte';
	import {
		dismissLockHint,
		hintOf,
		isEditingKey,
		placeLockHint,
		showLockHint,
		shownLockHint,
		type Box,
		type HintAnchor,
		type HintPlacement
	} from '$lib/layout-lock';

	/** How long the bubble stays while nobody looks at it. */
	const SHOW_MS = 6000;
	/** A held key or a double click doesn't start the refusal again. */
	const REPEAT_MS = 700;
	const RATTLE_MS = 700;

	let bubble: HTMLElement | undefined;
	let placement: HintPlacement | null = null;
	let hovered = false;
	let announcement = '';
	let hideTimer: ReturnType<typeof setTimeout> | undefined;
	let frame = 0;
	let last: { element: Element | null; at: number } = { element: null, at: 0 };
	const rattleTimers = new WeakMap<Element, ReturnType<typeof setTimeout>>();

	$: hint = $shownLockHint;
	$: void show(hint?.id ?? null);

	async function show(id: number | null) {
		clearTimeout(hideTimer);
		placement = null;
		hovered = false;
		if (id === null || !hint) return;
		const spoken = [hint.title, hint.text, hint.tip].filter(Boolean).join('. ');
		// The same text twice in a row is only read out if it changes in between.
		announcement = '';
		await tick();
		announcement = spoken;
		place();
		arm();
	}

	function anchorBox(anchor: HintAnchor): Box | null {
		if (!anchor) {
			return { left: innerWidth / 2, top: innerHeight - 24, width: 0, height: 0 };
		}
		if (!(anchor instanceof Element)) return { left: anchor.x, top: anchor.y, width: 0, height: 0 };
		if (!anchor.isConnected) return null;
		const box = anchor.getBoundingClientRect();
		if (box.bottom < 0 || box.top > innerHeight || (box.width === 0 && box.height === 0))
			return null;
		return { left: box.left, top: box.top, width: box.width, height: box.height };
	}

	/** The bottom edge of the bars stuck to the top (admin header, countdown bar). */
	function safeTop(): number {
		let bottom = 0;
		for (const bar of document.querySelectorAll('.admin-header, .booking-bar')) {
			const box = bar.getBoundingClientRect();
			if (box.top < 120 && box.bottom > bottom) bottom = box.bottom;
		}
		return Math.min(bottom, innerHeight / 2);
	}

	function place() {
		if (!hint || !bubble) return;
		const box = anchorBox(hint.anchor);
		if (!box) {
			// The control is gone (the page reloaded its data) or scrolled away.
			dismissLockHint();
			return;
		}
		placement = placeLockHint(
			box,
			{ width: bubble.offsetWidth, height: bubble.offsetHeight },
			{ width: document.documentElement.clientWidth, height: innerHeight },
			safeTop()
		);
	}

	function follow() {
		if (!hint || frame) return;
		frame = requestAnimationFrame(() => {
			frame = 0;
			// A place on the map has no element to follow.
			if (hint?.anchor && !(hint.anchor instanceof Element)) dismissLockHint();
			else place();
		});
	}

	/**
	 * The control is being worked with the keyboard (or typed into): its hint
	 * stays. A button focused by a mouse click doesn't count — its hint fades.
	 */
	function keyboardFocused(anchor: HintAnchor): boolean {
		if (!(anchor instanceof Element) || anchor !== document.activeElement) return false;
		try {
			return anchor.matches(':focus-visible');
		} catch {
			return true; // a browser without :focus-visible
		}
	}

	function arm() {
		clearTimeout(hideTimer);
		hideTimer = setTimeout(() => {
			if (hovered || keyboardFocused(hint?.anchor ?? null)) arm();
			else dismissLockHint();
		}, SHOW_MS);
	}

	function lockedTarget(target: EventTarget | null): HTMLElement | null {
		return target instanceof Element ? target.closest<HTMLElement>('[data-locked]') : null;
	}

	function rattle(element: HTMLElement) {
		element.removeAttribute('data-lock-rattle');
		void element.offsetWidth; // a new animation, not the one already running
		element.setAttribute('data-lock-rattle', '');
		clearTimeout(rattleTimers.get(element));
		rattleTimers.set(
			element,
			setTimeout(() => element.removeAttribute('data-lock-rattle'), RATTLE_MS)
		);
	}

	function refuse(element: HTMLElement) {
		const now = Date.now();
		const again = last.element === element && now - last.at < REPEAT_MS;
		last = { element, at: now };
		if (again && hint?.anchor === element) {
			arm();
			return;
		}
		rattle(element);
		showLockHint(element, hintOf(element));
	}

	function onClick(event: MouseEvent) {
		const locked = lockedTarget(event.target);
		if (!locked) return;
		event.preventDefault();
		event.stopPropagation();
		refuse(locked);
	}

	function onKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			// One layer at a time: this Escape only closes the hint.
			if (!hint) return;
			event.stopPropagation();
			dismissLockHint();
			return;
		}
		const locked = lockedTarget(event.target);
		if (!locked) return;
		const field = locked.matches('input, textarea, select');
		if (field ? !isEditingKey(event) : event.key !== 'Enter') return;
		// Enter would send the form or press the button.
		if (event.key === 'Enter') event.preventDefault();
		event.stopPropagation();
		refuse(locked);
	}

	function onPointerdown(event: PointerEvent) {
		if (!hint) return;
		const target = event.target instanceof Node ? event.target : null;
		const anchor = hint.anchor instanceof Element ? hint.anchor : null;
		if (target && (bubble?.contains(target) || anchor?.contains(target))) return;
		dismissLockHint();
	}

	// Another page: whatever the hint pointed at is gone.
	afterNavigate(() => dismissLockHint());

	onMount(() => {
		const scroll = { capture: true, passive: true };
		document.addEventListener('click', onClick, true);
		document.addEventListener('keydown', onKeydown, true);
		document.addEventListener('pointerdown', onPointerdown, true);
		window.addEventListener('scroll', follow, scroll);
		window.addEventListener('resize', follow);
		return () => {
			document.removeEventListener('click', onClick, true);
			document.removeEventListener('keydown', onKeydown, true);
			document.removeEventListener('pointerdown', onPointerdown, true);
			window.removeEventListener('scroll', follow, scroll);
			window.removeEventListener('resize', follow);
			cancelAnimationFrame(frame);
			clearTimeout(hideTimer);
			dismissLockHint();
		};
	});
</script>

{#if hint}
	{#key hint.id}
		<!-- aria-hidden: the live region below reads it out once. -->
		<div
			class="lock-hint"
			class:ready={!!placement}
			data-side={placement?.side ?? 'above'}
			style:top={placement ? `${placement.top}px` : null}
			style:left={placement ? `${placement.left}px` : null}
			style:--arrow-x={placement ? `${placement.arrowX}px` : null}
			bind:this={bubble}
			on:pointerenter={() => (hovered = true)}
			on:pointerleave={() => (hovered = false)}
			out:fade|global={{ duration: 140 }}
			data-layout-overlay
			aria-hidden="true"
		>
			<p class="title"><LockGlyph rattle size={13} /><span>{hint.title}</span></p>
			<p class="text">{hint.text}</p>
			{#if hint.tip}<p class="tip">{hint.tip}</p>{/if}
		</div>
	{/key}
{/if}

<p class="sr-only" role="status" aria-live="polite">{announcement}</p>

<style>
	.lock-hint {
		position: fixed;
		top: 0;
		left: 0;
		z-index: 9500;
		width: max-content;
		max-width: min(300px, calc(100vw - 16px));
		box-sizing: border-box;
		padding: 0.65rem 0.85rem 0.75rem;
		border-radius: 12px;
		background: rgba(12, 12, 12, 0.97);
		border: 1px solid rgba(251, 146, 60, 0.55);
		box-shadow:
			0 14px 34px rgba(0, 0, 0, 0.65),
			0 0 22px rgba(251, 146, 60, 0.12);
		color: #e5e5e5;
		text-align: left;
		/* Measured first, shown once it knows where it goes. */
		visibility: hidden;
		--lock-glyph-hole: #0c0c0c;
	}
	.lock-hint.ready {
		visibility: visible;
		animation: lock-hint-in 0.26s cubic-bezier(0.34, 1.56, 0.64, 1) both;
	}
	/* It grows out of its arrow. */
	.lock-hint[data-side='above'] {
		--rise: 6px;
		transform-origin: var(--arrow-x, 50%) 100%;
	}
	.lock-hint[data-side='below'] {
		--rise: -6px;
		transform-origin: var(--arrow-x, 50%) 0;
	}
	@keyframes lock-hint-in {
		from {
			opacity: 0;
			transform: translateY(var(--rise)) scale(0.92);
		}
	}

	.lock-hint::after {
		content: '';
		position: absolute;
		left: calc(var(--arrow-x, 50%) - 6px);
		width: 11px;
		height: 11px;
		background: #0c0c0c;
		border: 1px solid rgba(251, 146, 60, 0.55);
		transform: rotate(45deg);
	}
	.lock-hint[data-side='above']::after {
		bottom: -7px;
		border-top: none;
		border-left: none;
	}
	.lock-hint[data-side='below']::after {
		top: -7px;
		border-bottom: none;
		border-right: none;
	}

	.title {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		margin: 0;
		color: #fb923c;
		font-size: 0.68rem;
		font-weight: 900;
		letter-spacing: 1px;
		line-height: 1.3;
		text-transform: uppercase;
	}
	.text {
		margin: 0.35rem 0 0;
		font-size: 0.82rem;
		line-height: 1.45;
		overflow-wrap: break-word;
	}
	.tip {
		margin: 0.45rem 0 0;
		padding-top: 0.45rem;
		border-top: 1px solid #262626;
		color: #a3a3a3;
		font-size: 0.76rem;
		line-height: 1.4;
		overflow-wrap: break-word;
	}

	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		margin: -1px;
		padding: 0;
		overflow: hidden;
		clip: rect(0 0 0 0);
		white-space: nowrap;
		border: 0;
	}

	@media (prefers-reduced-motion: reduce) {
		.lock-hint.ready {
			animation: none;
		}
	}
</style>
