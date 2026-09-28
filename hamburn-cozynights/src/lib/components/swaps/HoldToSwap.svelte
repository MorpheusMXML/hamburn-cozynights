<!--
@component
The yes of a swap request (/swaps): press and hold while the pill fills up and
the little ring closes; letting go early stops it, nothing happens. When the
pill is full, `onconfirm` runs (the swap itself) and the button waits for it.
It answers true when the swap went through (the page takes over with the
celebration), false to arm the button again (the page shows why).

Keyboard: hold Space or Enter. Screen readers that activate a button with a
bare click (no key or pointer events before it) can't hold: their first
activation readies the swap, a second within READY_MS swaps. Same pattern as
the roulette's Leave No Trace. With reduced motion the fill has no glow.
-->
<script lang="ts">
	import { onDestroy, onMount } from 'svelte';

	let {
		onconfirm,
		holdMs = 1000,
		disabled = false,
		spotLabel = ''
	}: {
		/** Runs when the hold completes; true = swapped, false = try again. */
		onconfirm: () => Promise<boolean>;
		holdMs?: number;
		disabled?: boolean;
		/** The spot the guest gets, for the screen reader's words. */
		spotLabel?: string;
	} = $props();

	const READY_MS = 5000;
	// A click this soon after a press or release on the button belongs to the hold.
	const OWN_CLICK_MS = 800;

	type Stage = 'ready' | 'holding' | 'working';
	let stage = $state<Stage>('ready');
	let progress = $state(0);
	let announce = $state('');
	let calm = $state(false);
	let button = $state<HTMLButtonElement>();
	let frame = 0;
	let holdStart = 0;
	let lastPress = -Infinity;
	let readyUntil = 0;

	let text = $derived(
		stage === 'working' ? 'Swapping…' : stage === 'holding' ? 'Keep holding…' : 'Hold to swap'
	);
	const hintId = `hold-hint-${Math.random().toString(36).slice(2, 8)}`;

	onMount(() => {
		calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
	});
	onDestroy(() => {
		if (typeof window !== 'undefined') cancelAnimationFrame(frame);
	});

	function press() {
		lastPress = performance.now();
		if (stage !== 'ready' || disabled) return;
		announce = '';
		stage = 'holding';
		holdStart = performance.now();
		cancelAnimationFrame(frame);
		frame = requestAnimationFrame(step);
	}

	function step(now: number) {
		if (stage !== 'holding') return;
		progress = Math.min(1, Math.max(0, (now - holdStart) / holdMs));
		if (progress >= 1) void confirm();
		else frame = requestAnimationFrame(step);
	}

	function letGo() {
		lastPress = performance.now();
		if (stage !== 'holding') return;
		cancelAnimationFrame(frame);
		stage = 'ready';
		progress = 0;
	}

	async function confirm() {
		stage = 'working';
		progress = 1;
		readyUntil = 0;
		announce = 'Swapping your spots…';
		try {
			navigator.vibrate?.([20, 30, 60]);
		} catch {
			/* no vibration on this device */
		}
		let swapped = false;
		try {
			swapped = await onconfirm();
		} catch {
			swapped = false;
		}
		if (!swapped) {
			stage = 'ready';
			progress = 0;
			announce = '';
		}
	}

	function pointerDown(event: PointerEvent) {
		if (event.pointerType === 'mouse' && event.button !== 0) return;
		// Keep the hold when the finger drifts off the button.
		button?.setPointerCapture?.(event.pointerId);
		press();
	}

	function keyDown(event: KeyboardEvent) {
		if (event.key !== ' ' && event.key !== 'Enter') return;
		event.preventDefault();
		lastPress = performance.now();
		if (!event.repeat) press();
	}

	function keyUp(event: KeyboardEvent) {
		if (event.key !== ' ' && event.key !== 'Enter') return;
		event.preventDefault();
		letGo();
	}

	/** A bare click (screen reader): the first readies the swap, a second within READY_MS swaps. */
	function bareClick() {
		const now = performance.now();
		if (stage !== 'ready' || disabled || now - lastPress < OWN_CLICK_MS) return;
		if (now < readyUntil) {
			void confirm();
			return;
		}
		readyUntil = now + READY_MS;
		announce = `Ready. Activate the swap button again within ${READY_MS / 1000} seconds to swap${spotLabel ? ` and move to spot ${spotLabel}` : ''}.`;
	}
</script>

<button
	type="button"
	class="hold"
	class:holding={stage === 'holding'}
	class:working={stage === 'working'}
	class:calm
	style="--p: {progress}"
	bind:this={button}
	disabled={disabled || stage === 'working'}
	aria-describedby={hintId}
	onpointerdown={pointerDown}
	onpointerup={letGo}
	onpointercancel={letGo}
	onlostpointercapture={letGo}
	onkeydown={keyDown}
	onkeyup={keyUp}
	onblur={letGo}
	onclick={bareClick}
	oncontextmenu={(event) => event.preventDefault()}
>
	<span class="fill" aria-hidden="true"></span>
	<svg class="hold-dial" viewBox="0 0 24 24" aria-hidden="true">
		<circle class="track" cx="12" cy="12" r="9" pathLength="100" />
		<circle
			class="arc"
			cx="12"
			cy="12"
			r="9"
			pathLength="100"
			style="stroke-dashoffset: {100 - progress * 100}"
		/>
	</svg>
	<span class="hold-text">{text}</span>
</button>
<span id={hintId} class="hold-hint">Press and hold for a second. Let go to stop.</span>
<span class="sr-only" aria-live="assertive" data-layout-ignore>{announce}</span>

<style>
	.hold {
		--swap-c: var(--swap, #38bdf8);
		position: relative;
		isolation: isolate;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.6rem;
		min-height: 52px;
		padding: 0 1.4rem 0 1.1rem;
		border-radius: 999px;
		border: 2px solid var(--swap-c);
		background: rgba(56, 189, 248, 0.08);
		color: #e0f2fe;
		font: inherit;
		font-weight: 900;
		font-size: 0.9rem;
		letter-spacing: 1.5px;
		text-transform: uppercase;
		cursor: pointer;
		overflow: hidden;
		user-select: none;
		-webkit-user-select: none;
		-webkit-touch-callout: none;
		touch-action: none;
		transition:
			transform 0.15s ease,
			box-shadow 0.2s ease;
	}
	.hold:hover:not(:disabled) {
		box-shadow: 0 0 24px rgba(56, 189, 248, 0.35);
	}
	.hold:focus-visible {
		outline: 2px solid #fff;
		outline-offset: 3px;
	}
	.hold.holding {
		transform: scale(0.97);
		box-shadow:
			0 0 calc(10px + 30px * var(--p)) rgba(56, 189, 248, calc(0.25 + 0.45 * var(--p))),
			inset 0 0 0 1px rgba(255, 255, 255, 0.1);
	}
	.hold.working {
		cursor: progress;
		color: #04121c;
	}
	.hold:disabled:not(.working) {
		opacity: 0.5;
		cursor: not-allowed;
	}
	/* the pill fills from the left while held */
	.fill {
		position: absolute;
		inset: 0;
		z-index: -1;
		background: linear-gradient(90deg, #2dd4bf, var(--swap-c));
		transform-origin: left center;
		transform: scaleX(var(--p));
	}
	.hold-dial {
		width: 1.4rem;
		height: 1.4rem;
		flex: none;
		transform: rotate(-90deg);
	}
	.track,
	.arc {
		fill: none;
		stroke-width: 3;
	}
	.track {
		stroke: currentColor;
		opacity: 0.25;
	}
	.arc {
		stroke: currentColor;
		stroke-linecap: round;
		stroke-dasharray: 100;
	}
	.working .hold-dial {
		animation: dial-spin 0.8s linear infinite;
	}
	@keyframes dial-spin {
		to {
			transform: rotate(270deg);
		}
	}
	.hold-hint {
		display: block;
		margin-top: 0.4rem;
		font-size: 0.72rem;
		color: #8a8a8a;
	}
	.calm.holding {
		box-shadow: none;
		transform: none;
	}
	.calm.working .hold-dial {
		animation: none;
	}
</style>
