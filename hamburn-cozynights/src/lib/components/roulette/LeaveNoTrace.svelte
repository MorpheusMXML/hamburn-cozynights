<!--
@component
✨ Leave No Trace: the spell a guest casts on the roulette page (/random-bed)
to give up their spot and spin for a new one.

The guest holds the sweep button for HOLD_MS; letting go early stops it. When
the hold completes, `release` deletes the booking on the server. Only if that
worked does the dust devil sweep the spot card away into glitter; then
`ondone` fires and the page spins the reels again. Escape or "Keep my spot"
call `oncancel`, up to the moment of the sweep.

Keyboard: hold Space or Enter on the sweep button. Screen readers that
activate a button with a bare click (no key or pointer events before it)
can't hold: their first activation readies the sweep, a second within READY_MS
sweeps. With reduced motion there is no glitter, swirl or shake.
-->
<script lang="ts">
	import { onDestroy, onMount, tick } from 'svelte';
	import { fade } from 'svelte/transition';
	import { createGlitterSweep, type GlitterSweep } from '$lib/fx/glitter';

	let {
		spot,
		release,
		oncancel,
		ondone,
		onpoof
	}: {
		/** The spot that is given up. */
		spot: { label: string; roomName?: string; houseName?: string };
		/** Deletes the booking. Resolves null once it is gone, else the message to show. */
		release: () => Promise<string | null>;
		oncancel: () => void;
		ondone: () => void;
		/** The sweep starts (for the sound). */
		onpoof?: () => void;
	} = $props();

	const HOLD_MS = 2000;
	const READY_MS = 5000;
	const QUIET_GONE_MS = 450;
	/** After the last speck: a breath before the reels spin again. */
	const SETTLE_MS = 250;
	// A click this soon after a press or release on the sweep button belongs to the hold.
	const OWN_CLICK_MS = 800;
	const NO_CONNECTION =
		'We could not reach the server, so nothing was changed. Check your internet connection and try again.';

	type Stage = 'ready' | 'holding' | 'sweeping' | 'gone';
	let stage = $state<Stage>('ready');
	let progress = $state(0);
	let error = $state('');
	let announce = $state('');
	let reduceMotion = $state(false);

	let keepButton = $state<HTMLButtonElement>();
	let sweepButton = $state<HTMLButtonElement>();
	let spotEl = $state<HTMLDivElement>();
	let canvas = $state<HTMLCanvasElement>();
	let frame = 0;
	let holdStart = 0;
	let lastPress = -Infinity;
	let readyUntil = 0;
	let doneTimer: ReturnType<typeof setTimeout> | undefined;
	let glitter: GlitterSweep | null = null;
	let previousFocus: HTMLElement | null = null;

	let place = $derived([spot.roomName, spot.houseName].filter(Boolean).join(' · '));
	let locked = $derived(stage === 'sweeping' || stage === 'gone');
	let secondsLeft = $derived((((1 - progress) * HOLD_MS) / 1000).toFixed(1));
	let sweepText = $derived(
		stage === 'sweeping' ? 'Sweeping…' : stage === 'gone' ? 'Poof!' : 'Hold to sweep ✨'
	);

	onMount(() => {
		reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		previousFocus = document.activeElement as HTMLElement | null;
		document.body.style.overflow = 'hidden';
		// Safe start: Enter on the focused button keeps the spot, it never sweeps.
		void tick().then(() => keepButton?.focus());
	});

	onDestroy(() => {
		if (typeof window === 'undefined') return;
		cancelAnimationFrame(frame);
		clearTimeout(doneTimer);
		glitter?.destroy();
		document.body.style.overflow = '';
		// After "Keep my spot" the respin button is still there; after a sweep the page moved on.
		if (previousFocus?.isConnected) previousFocus.focus();
	});

	function press() {
		lastPress = performance.now();
		if (stage !== 'ready') return;
		error = '';
		announce = '';
		stage = 'holding';
		holdStart = performance.now();
		cancelAnimationFrame(frame);
		frame = requestAnimationFrame(step);
	}

	function step(now: number) {
		if (stage !== 'holding') return;
		progress = Math.min(1, Math.max(0, (now - holdStart) / HOLD_MS));
		if (progress >= 1) void sweep();
		else frame = requestAnimationFrame(step);
	}

	function letGo() {
		lastPress = performance.now();
		if (stage !== 'holding') return;
		cancelAnimationFrame(frame);
		stage = 'ready';
		progress = 0;
	}

	async function sweep() {
		stage = 'sweeping';
		progress = 1;
		readyUntil = 0;
		announce = 'Sweeping. Releasing your spot…';
		let failure: string | null;
		try {
			failure = await release();
		} catch {
			failure = NO_CONNECTION;
		}
		if (failure) {
			stage = 'ready';
			progress = 0;
			announce = '';
			error = failure;
			await tick();
			keepButton?.focus();
			return;
		}

		stage = 'gone';
		announce = `Spot ${spot.label} is released. Spinning a new spot…`;
		onpoof?.();
		if (reduceMotion || !canvas || !spotEl) {
			doneTimer = setTimeout(ondone, QUIET_GONE_MS);
			return;
		}
		try {
			navigator.vibrate?.([30, 40, 90]);
		} catch {
			/* no vibration on this device */
		}
		const box = spotEl.getBoundingClientRect();
		glitter = createGlitterSweep(
			canvas,
			{ left: box.left, top: box.top, width: box.width, height: box.height },
			{ onDone: () => (doneTimer = setTimeout(ondone, SETTLE_MS)) }
		);
	}

	function cancel() {
		if (locked) return;
		cancelAnimationFrame(frame);
		oncancel();
	}

	function pointerDown(event: PointerEvent) {
		if (event.pointerType === 'mouse' && event.button !== 0) return;
		// Keep the hold when the finger drifts off the button.
		sweepButton?.setPointerCapture?.(event.pointerId);
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

	/** A bare click (screen reader): the first readies the sweep, a second within READY_MS sweeps. */
	function bareClick() {
		const now = performance.now();
		if (stage !== 'ready' || now - lastPress < OWN_CLICK_MS) return;
		if (now < readyUntil) {
			void sweep();
			return;
		}
		readyUntil = now + READY_MS;
		announce = `Ready. Activate the sweep button again within ${READY_MS / 1000} seconds to release spot ${spot.label}.`;
	}

	function windowKeyDown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			event.preventDefault();
			cancel();
		} else if (event.key === 'Tab') {
			// Two buttons: keep the focus inside the dialog.
			const buttons = [keepButton, sweepButton].filter(
				(b): b is HTMLButtonElement => !!b && !b.disabled
			);
			if (buttons.length === 0) return;
			event.preventDefault();
			const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
			const next = (index + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length;
			buttons[next].focus();
		}
	}
</script>

<svelte:window onkeydown={windowKeyDown} />

<div
	class="lnt"
	class:holding={stage === 'holding'}
	class:sweeping={stage === 'sweeping'}
	class:gone={stage === 'gone'}
	class:calm={reduceMotion}
	style="--p: {progress}"
	role="alertdialog"
	aria-modal="true"
	aria-labelledby="lnt-title"
	aria-describedby="lnt-rules"
	transition:fade={{ duration: reduceMotion ? 0 : 180 }}
>
	<div class="sky" aria-hidden="true"></div>

	<div class="sheet">
		<p class="kicker"><span aria-hidden="true">✨</span> Leave No Trace</p>
		<h2 id="lnt-title">
			{#if stage === 'gone'}Poof! No trace left.{:else}Sweep your spot away?{/if}
		</h2>

		<div class="stage">
			<div class="whirl" aria-hidden="true"></div>
			<div class="spot" bind:this={spotEl}>
				<span class="spot-tag">Your spot</span>
				<strong class="spot-label" class:long={spot.label.length > 6}>{spot.label}</strong>
				{#if place}<span class="spot-place">{place}</span>{/if}
			</div>
		</div>

		<ul id="lnt-rules" class="rules">
			<li>
				Your booking of spot <strong>{spot.label}</strong> ends the moment the sweep is done.
			</li>
			<li>Anyone can grab it right away. There is no undo.</li>
			<li>Until you book a new spot, you have none.</li>
			<li class="then">
				Then the machine spins a new spot for you. Your burner name stays: keep it or change it.
			</li>
		</ul>

		{#if error}
			<p class="lnt-error" role="alert">{error}</p>
		{/if}

		<div class="controls">
			<button type="button" class="keep" bind:this={keepButton} onclick={cancel} disabled={locked}>
				Keep my spot
			</button>

			<button
				type="button"
				class="sweep"
				bind:this={sweepButton}
				disabled={locked}
				aria-describedby="lnt-hold-hint"
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
				<svg class="hold-ring" viewBox="0 0 120 120" aria-hidden="true">
					<circle class="track" cx="60" cy="60" r="54" pathLength="100" />
					<circle
						class="fill"
						cx="60"
						cy="60"
						r="54"
						pathLength="100"
						style="stroke-dashoffset: {100 - progress * 100}"
					/>
				</svg>
				<span class="sweep-text">{sweepText}</span>
				<span class="count" aria-hidden="true">{secondsLeft} s</span>
			</button>
			<p id="lnt-hold-hint" class="hold-hint">
				Press and hold for {HOLD_MS / 1000} seconds. Let go to stop.
			</p>
		</div>

		<p class="sr-only" aria-live="assertive" data-layout-ignore>{announce}</p>
	</div>

	<canvas class="glitter" bind:this={canvas} aria-hidden="true"></canvas>
</div>

<style>
	.lnt {
		--gold: #fde68a;
		--teal: #2dd4bf;
		--pink: #f472b6;
		--violet: #c4b5fd;
		--ink: #f5f3ff;
		--muted: #c7bfe0;
		position: fixed;
		inset: 0;
		/* above the page and the booking countdown bar, below dialogs and toasts */
		z-index: 9000;
		display: flex;
		flex-direction: column;
		background: #0b0616;
		color: var(--ink);
		font-family: 'Inter', system-ui, sans-serif;
		overflow-x: hidden;
		overflow-y: auto;
		overscroll-behavior: contain;
		-webkit-tap-highlight-color: transparent;
	}

	/* The playa at dusk: violet sky, a warm glow on the horizon, a few stars. */
	.sky {
		position: fixed;
		inset: 0;
		pointer-events: none;
		background:
			radial-gradient(120% 60% at 50% 108%, rgba(251, 146, 60, 0.38), transparent 62%),
			radial-gradient(90% 70% at 50% -10%, rgba(76, 29, 149, 0.75), transparent 70%), #0b0616;
	}
	.sky::after {
		content: '';
		position: absolute;
		inset: 0;
		background:
			radial-gradient(1.5px 1.5px at 12% 18%, #fff, transparent),
			radial-gradient(1px 1px at 27% 8%, #fff, transparent),
			radial-gradient(1.5px 1.5px at 44% 22%, #fde68a, transparent),
			radial-gradient(1px 1px at 63% 12%, #fff, transparent),
			radial-gradient(1.5px 1.5px at 78% 26%, #c4b5fd, transparent),
			radial-gradient(1px 1px at 88% 9%, #fff, transparent),
			radial-gradient(1px 1px at 8% 40%, #fff, transparent),
			radial-gradient(1.5px 1.5px at 93% 44%, #fff, transparent);
		animation: twinkle 4s ease-in-out infinite alternate;
	}
	@keyframes twinkle {
		from {
			opacity: 0.45;
		}
		to {
			opacity: 1;
		}
	}

	.sheet {
		position: relative;
		flex: 1 0 auto;
		width: 100%;
		max-width: 520px;
		margin: 0 auto;
		padding: clamp(0.9rem, 3vh, 1.75rem) 16px;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: clamp(0.6rem, 1.8vh, 1rem);
		text-align: center;
	}

	.kicker {
		margin: 0;
		padding-left: 0.3em;
		font-size: 0.78rem;
		font-weight: 900;
		letter-spacing: 0.3em;
		text-transform: uppercase;
		color: var(--gold);
		text-shadow: 0 0 12px rgba(253, 230, 138, 0.6);
	}

	h2 {
		margin: 0;
		font-size: clamp(1.35rem, 6vw, 1.9rem);
		line-height: 1.1;
		font-weight: 900;
		color: #fff;
		text-shadow:
			0 0 14px rgba(196, 181, 253, 0.7),
			0 0 30px rgba(244, 114, 182, 0.45);
		overflow-wrap: anywhere;
	}

	/* The card and the dust devil behind it. */
	.stage {
		position: relative;
		width: 100%;
		padding: 0.6rem 0;
	}
	.whirl {
		position: absolute;
		left: 50%;
		top: 50%;
		width: min(88%, 380px);
		aspect-ratio: 1;
		translate: -50% -50%;
		/* a flat whirlwind: seen from the side */
		scale: 1 0.58;
		opacity: calc(0.3 + 0.7 * var(--p));
		pointer-events: none;
	}
	/* Blurred once, then only turned: the compositor rotates the cached layer. */
	.whirl::before {
		content: '';
		position: absolute;
		inset: 0;
		border-radius: 50%;
		background: conic-gradient(
			from 0deg,
			transparent,
			rgba(253, 230, 138, 0.4) 10%,
			transparent 24%,
			rgba(45, 212, 191, 0.32) 40%,
			transparent 55%,
			rgba(244, 114, 182, 0.35) 72%,
			transparent 86%
		);
		filter: blur(10px);
		animation: whirl 2.6s linear infinite;
	}
	.holding .whirl::before,
	.sweeping .whirl::before,
	.gone .whirl::before {
		animation-duration: 0.7s;
	}
	/* Once the spot is gone the glitter is the show: the swirl behind fades. */
	.gone .whirl {
		opacity: 0;
		transition: opacity 0.5s ease-out;
	}
	@keyframes whirl {
		to {
			transform: rotate(360deg);
		}
	}

	.spot {
		position: relative;
		width: 100%;
		padding: 0.8rem 1.25rem;
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		border-radius: 18px;
		border: 1px solid rgba(196, 181, 253, 0.45);
		background:
			radial-gradient(120% 140% at 0% 0%, rgba(244, 114, 182, 0.18), transparent 55%),
			linear-gradient(135deg, rgba(30, 20, 48, 0.95), rgba(14, 10, 24, 0.95));
		box-shadow:
			0 0 0 1px rgba(0, 0, 0, 0.4),
			0 10px 30px rgba(0, 0, 0, 0.45);
	}
	.holding .spot {
		animation: jitter 0.12s linear infinite;
	}
	@keyframes jitter {
		0%,
		100% {
			transform: translate(0, 0);
		}
		25% {
			transform: translate(calc(var(--p) * 2px), calc(var(--p) * -1px))
				rotate(calc(var(--p) * -0.6deg));
		}
		50% {
			transform: translate(calc(var(--p) * -2px), calc(var(--p) * 1px));
		}
		75% {
			transform: translate(calc(var(--p) * 1px), calc(var(--p) * 1px))
				rotate(calc(var(--p) * 0.6deg));
		}
	}
	/* Swept away from the left edge, in step with the glitter. */
	.gone .spot {
		-webkit-mask-image: linear-gradient(90deg, transparent 45%, #000 55%);
		mask-image: linear-gradient(90deg, transparent 45%, #000 55%);
		-webkit-mask-size: 220% 100%;
		mask-size: 220% 100%;
		animation: swept 0.55s ease-in forwards;
	}
	@keyframes swept {
		from {
			-webkit-mask-position: 100% 0;
			mask-position: 100% 0;
		}
		to {
			-webkit-mask-position: 0% 0;
			mask-position: 0% 0;
		}
	}
	.spot-tag {
		padding-left: 0.3em;
		font-size: 0.68rem;
		font-weight: 900;
		letter-spacing: 0.3em;
		text-transform: uppercase;
		color: var(--violet);
	}
	.spot-label {
		font-size: clamp(1.9rem, 9vw, 2.6rem);
		line-height: 1.05;
		font-weight: 900;
		color: #fff;
		overflow-wrap: anywhere;
	}
	/* Spot labels can be whole phrases. */
	.spot-label.long {
		font-size: clamp(1.1rem, 5vw, 1.5rem);
	}
	.spot-place {
		font-size: 0.8rem;
		font-weight: 700;
		letter-spacing: 0.5px;
		text-transform: uppercase;
		color: var(--muted);
		overflow-wrap: anywhere;
	}

	.rules {
		list-style: none;
		margin: 0;
		padding: 0;
		width: 100%;
		display: grid;
		gap: 0.45rem;
		text-align: left;
		font-size: clamp(0.85rem, 3.6vw, 0.95rem);
		line-height: 1.4;
		color: #e4dcf7;
	}
	.rules li {
		position: relative;
		padding-left: 1.6rem;
	}
	.rules li::before {
		content: '✧';
		position: absolute;
		left: 0.1rem;
		top: 0;
		font-weight: 900;
		color: var(--gold);
	}
	.rules .then::before {
		content: '↻';
		color: var(--teal);
	}
	.rules strong {
		color: #fff;
	}

	.lnt-error {
		margin: 0;
		width: 100%;
		padding: 0.75rem 1rem;
		border: 1px solid #f87171;
		border-radius: 12px;
		background: rgba(248, 113, 113, 0.12);
		color: #fecaca;
		font-weight: 700;
		line-height: 1.45;
		text-align: left;
		overflow-wrap: anywhere;
	}

	.controls {
		width: 100%;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 1rem;
		margin-top: 0.15rem;
	}
	.gone .rules,
	.gone .controls,
	.gone .lnt-error {
		transition: opacity 0.4s ease 0.1s;
		opacity: 0;
	}

	.keep {
		width: 100%;
		min-height: 52px;
		padding: 0.8rem 1rem;
		border-radius: 14px;
		border: 2px solid var(--teal);
		background: rgba(45, 212, 191, 0.1);
		color: var(--teal);
		font-weight: 900;
		letter-spacing: 1px;
		text-transform: uppercase;
		cursor: pointer;
	}
	.keep:hover:not(:disabled) {
		background: rgba(45, 212, 191, 0.2);
		color: #fff;
	}
	.keep:focus-visible {
		outline: 3px solid var(--teal);
		outline-offset: 3px;
	}
	.keep:disabled {
		opacity: 0.35;
		cursor: default;
	}

	/* The round sweep button, with the hold ring around it. */
	.sweep {
		position: relative;
		width: clamp(112px, 30vw, 136px);
		aspect-ratio: 1;
		margin: 14px 0 4px;
		padding: 0;
		border: none;
		border-radius: 50%;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.3rem;
		color: #fff;
		cursor: pointer;
		background: radial-gradient(circle at 35% 30%, #f0abfc, #a855f7 50%, #3b0764 100%);
		box-shadow:
			0 0 0 6px #140a22,
			0 0 0 9px rgba(253, 230, 138, 0.5),
			0 12px 40px rgba(168, 85, 247, 0.45),
			inset 0 -8px 18px rgba(0, 0, 0, 0.4);
		/* a long press must not scroll, zoom, select or open a menu */
		touch-action: none;
		user-select: none;
		-webkit-user-select: none;
		-webkit-touch-callout: none;
	}
	.holding .sweep,
	.sweeping .sweep {
		transform: scale(0.95);
		box-shadow:
			0 0 0 6px #140a22,
			0 0 0 9px rgba(253, 230, 138, 0.9),
			0 0 70px rgba(244, 114, 182, 0.7),
			inset 0 8px 20px rgba(0, 0, 0, 0.45);
	}
	.sweep:focus-visible {
		outline: 3px solid var(--gold);
		outline-offset: 28px;
	}
	.sweep:disabled {
		cursor: progress;
	}
	/* Not `.ring`: that is a Tailwind utility (a 1px white box-shadow). */
	.hold-ring {
		position: absolute;
		top: -17%;
		left: -17%;
		width: 134%;
		height: 134%;
		transform: rotate(-90deg);
		pointer-events: none;
		overflow: visible;
	}
	.hold-ring circle {
		fill: none;
		stroke-width: 4;
	}
	.hold-ring .track {
		stroke: rgba(253, 230, 138, 0.2);
	}
	.hold-ring .fill {
		stroke: var(--gold);
		stroke-dasharray: 100;
		stroke-linecap: round;
		filter: drop-shadow(0 0 6px rgba(253, 230, 138, 0.9));
	}
	/* Let go early: the ring drains instead of snapping back. */
	.lnt:not(.holding):not(.sweeping):not(.gone) .hold-ring .fill {
		transition: stroke-dashoffset 0.35s ease-out;
	}
	.sweep-text {
		max-width: 80%;
		font-size: clamp(0.78rem, 3.3vw, 0.92rem);
		font-weight: 900;
		line-height: 1.15;
		letter-spacing: 1px;
		text-transform: uppercase;
		text-shadow: 0 1px 2px rgba(0, 0, 0, 0.6);
	}
	.count {
		font-family: ui-monospace, 'SF Mono', Menlo, monospace;
		font-size: 0.8rem;
		font-weight: 800;
		font-variant-numeric: tabular-nums;
		color: #fef3c7;
	}
	.hold-hint {
		margin: 0.2rem 0 0;
		font-size: 0.75rem;
		color: var(--muted);
	}

	.glitter {
		position: fixed;
		inset: 0;
		width: 100vw;
		height: 100vh;
		pointer-events: none;
	}

	/* Short screens (a 667px phone): everything down to the sweep button fits. */
	@media (max-height: 700px) {
		.sheet {
			gap: 0.5rem;
			padding-block: 0.6rem;
		}
		h2 {
			font-size: clamp(1.1rem, 5.2vw, 1.4rem);
		}
		.spot {
			padding: 0.6rem 1rem;
		}
		.spot-label {
			font-size: clamp(1.5rem, 7vw, 2rem);
		}
		.rules {
			gap: 0.3rem;
			font-size: 0.82rem;
		}
		.sweep {
			width: 108px;
			margin-top: 10px;
		}
	}

	/* Reduced motion: a still sky, no swirl, no shake; the card simply fades. */
	.calm .sky::after,
	.calm .whirl::before,
	.calm.holding .spot {
		animation: none;
	}
	.calm.gone .spot {
		-webkit-mask-image: none;
		mask-image: none;
		animation: none;
		opacity: 0.2;
	}
	@media (prefers-reduced-motion: reduce) {
		.sky::after,
		.whirl::before,
		.spot {
			animation: none !important;
		}
	}
</style>
