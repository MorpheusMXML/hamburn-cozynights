<!--
@component
The slot machine's lever (/random-bed). Drag the glowing knob down and let
go: a pull past LEVER_TRIGGER spins the reels, and a harder pull spins them
longer (`onpull(strength)`, 0–1). A tap, Enter or Space pulls it for you with
BUTTON_PULL; `yank()` plays that pull when the SPIN button is used, so the
lever always moves with the reels. Transforms only: nothing here makes the
browser lay the page out again while the knob moves.
-->
<script lang="ts">
	import { BUTTON_PULL, LEVER_TRIGGER } from '$lib/roulette';

	let {
		disabled = false,
		onpull,
		onratchet
	}: {
		disabled?: boolean;
		onpull: (strength: number) => void;
		/** A notch of the ratchet passed (for the sound). */
		onratchet?: () => void;
	} = $props();

	/** How far the knob is pulled down, 0–1. */
	let pull = $state(0);
	let dragging = $state(false);
	let yanking = $state(false);
	let button: HTMLButtonElement;
	let startY = 0;
	let travel = 1;
	let moved = false;
	let notch = 0;
	let lastPointer = -Infinity;
	let yankTimer: ReturnType<typeof setTimeout> | undefined;

	/** A click this soon after a pointer release belongs to that drag or tap. */
	const OWN_CLICK_MS = 600;
	const YANK_MS = 560;

	/** Plays a full pull and the spring back, for the SPIN button and taps. */
	export function yank() {
		clearTimeout(yankTimer);
		yanking = false;
		// restart the animation on a second yank
		requestAnimationFrame(() => {
			yanking = true;
			yankTimer = setTimeout(() => (yanking = false), YANK_MS);
		});
	}

	function pointerDown(event: PointerEvent) {
		if (disabled || (event.pointerType === 'mouse' && event.button !== 0)) return;
		button.setPointerCapture?.(event.pointerId);
		startY = event.clientY;
		// the knob travels about three quarters of the lever
		travel = Math.max(40, button.getBoundingClientRect().height * 0.72);
		moved = false;
		notch = 0;
		dragging = true;
		pull = 0;
	}

	function pointerMove(event: PointerEvent) {
		if (!dragging) return;
		const dy = event.clientY - startY;
		if (Math.abs(dy) > 4) moved = true;
		pull = Math.min(1, Math.max(0, dy / travel));
		const reached = Math.floor(pull * 4);
		if (reached > notch) onratchet?.();
		notch = reached;
	}

	function pointerUp() {
		if (!dragging) return;
		lastPointer = performance.now();
		dragging = false;
		const strength = pull;
		// the spring takes the knob back up (a CSS transition)
		pull = 0;
		if (!moved) {
			yank();
			onpull(BUTTON_PULL);
		} else if (strength >= LEVER_TRIGGER) {
			onpull(strength);
		}
	}

	/** Keyboard (Enter or Space) and screen readers: a click without a pointer before it. */
	function click() {
		if (disabled || performance.now() - lastPointer < OWN_CLICK_MS) return;
		yank();
		onpull(BUTTON_PULL);
	}
</script>

<button
	type="button"
	class="lever"
	class:dragging
	class:yanking
	bind:this={button}
	{disabled}
	style="--pull: {pull}"
	aria-label="Pull the lever to spin"
	onpointerdown={pointerDown}
	onpointermove={pointerMove}
	onpointerup={pointerUp}
	onpointercancel={pointerUp}
	onlostpointercapture={pointerUp}
	onclick={click}
	oncontextmenu={(event) => event.preventDefault()}
>
	<span class="track" aria-hidden="true"></span>
	<span class="arm" aria-hidden="true"></span>
	<span class="hub" aria-hidden="true"></span>
	<span class="knob" aria-hidden="true"></span>
</button>

<style>
	.lever {
		position: relative;
		flex: none;
		width: 38px;
		height: 11rem;
		padding: 0;
		border: 0;
		background: none;
		cursor: grab;
		/* a drag must not scroll the page, select text or open a menu */
		touch-action: none;
		user-select: none;
		-webkit-user-select: none;
		-webkit-touch-callout: none;
		-webkit-tap-highlight-color: transparent;
	}
	.lever.dragging {
		cursor: grabbing;
	}
	.lever:disabled {
		cursor: not-allowed;
		filter: grayscale(0.85) brightness(0.6);
	}
	.lever:focus-visible {
		outline: 3px solid #fde68a;
		outline-offset: 4px;
		border-radius: 20px;
	}

	/* The slot in the cabinet the lever moves in. */
	.track {
		position: absolute;
		left: 50%;
		top: 8%;
		bottom: 8%;
		width: 12px;
		margin-left: -6px;
		border-radius: 6px;
		background: #050407;
		box-shadow:
			inset 0 2px 6px rgba(0, 0, 0, 0.9),
			0 0 0 1px rgba(255, 255, 255, 0.07);
	}

	/* The chrome stick, from the hub up to the knob. Pulled, it tips towards
	   the viewer: from the front it shrinks, then grows downwards (scaleY < 0). */
	.arm {
		position: absolute;
		left: 50%;
		top: 14%;
		height: 48%;
		width: 8px;
		margin-left: -4px;
		border-radius: 4px;
		background: linear-gradient(90deg, #4b5563, #f3f4f6 42%, #9ca3af 62%, #374151);
		transform-origin: 50% 100%;
		/* 1.23 = knob travel / arm length: the stick's end stays on the knob */
		transform: scaleY(calc(1 - 1.23 * var(--pull)));
	}
	.hub {
		position: absolute;
		left: 50%;
		top: 62%;
		width: 22px;
		height: 22px;
		margin: -11px 0 0 -11px;
		border-radius: 50%;
		background: radial-gradient(circle at 35% 30%, #f9fafb, #9ca3af 45%, #374151);
		box-shadow: 0 2px 6px rgba(0, 0, 0, 0.6);
	}
	/* The glowing ball: it comes closer (bigger) halfway down. */
	.knob {
		position: absolute;
		left: 50%;
		top: 14%;
		width: 34px;
		height: 34px;
		margin: -17px 0 0 -17px;
		border-radius: 50%;
		background: radial-gradient(circle at 34% 30%, #fff7ed, #fb923c 32%, #dc2626 68%, #7f1d1d);
		box-shadow:
			0 0 16px rgba(251, 146, 60, 0.65),
			0 4px 10px rgba(0, 0, 0, 0.6);
		transform: translateY(calc(var(--pull) * 6.5rem))
			scale(calc(1 + 0.9 * var(--pull) * (1 - var(--pull))));
	}

	/* Let go: the spring takes it back up with a little wobble. */
	.lever:not(.dragging) .arm,
	.lever:not(.dragging) .knob {
		transition: transform 0.5s cubic-bezier(0.3, 1.6, 0.5, 1);
	}

	/* A pull played for a tap or the SPIN button. */
	.yanking .arm {
		animation: yank-arm 0.56s ease-in-out;
	}
	.yanking .knob {
		animation: yank-knob 0.56s ease-in-out;
	}
	@keyframes yank-arm {
		45% {
			transform: scaleY(-0.23);
		}
	}
	@keyframes yank-knob {
		22% {
			transform: translateY(3.25rem) scale(1.22);
		}
		45% {
			transform: translateY(6.5rem) scale(1);
		}
	}
	@keyframes yank-knob-wide {
		22% {
			transform: translateY(2.5rem) scale(1.22);
		}
		45% {
			transform: translateY(5rem) scale(1);
		}
	}

	/* Side by side on a wide machine the glass is shorter, and so is the lever. */
	@container machine (min-width: 36rem) {
		.lever {
			height: 8.5rem;
		}
		.knob {
			transform: translateY(calc(var(--pull) * 5rem))
				scale(calc(1 + 0.9 * var(--pull) * (1 - var(--pull))));
		}
		.yanking .knob {
			animation-name: yank-knob-wide;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.lever:not(.dragging) .arm,
		.lever:not(.dragging) .knob {
			transition: none;
		}
		.yanking .arm,
		.yanking .knob {
			animation: none;
		}
	}
</style>
