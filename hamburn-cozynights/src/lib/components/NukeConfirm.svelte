<!--
@component
The ☢ warning before a guest nukes their spot to respin the roulette
(/random-bed): a full-screen DEFCON alert with the spot as the target.

The guest holds the launch button for HOLD_MS; letting go early aborts. When
the hold completes, `launch` deletes the booking on the server. Only if that
worked does the blast play (flash, shockwave, mushroom cloud); then `done`
fires and the page rolls a new spot. Escape or "Abort" fire `abort`, up to
the launch.

Keyboard: hold Space or Enter on the launch button. Screen readers that
activate a button with a bare click (no key or pointer events before it)
can't hold: their first activation arms, a second within ARM_MS launches.
With reduced motion there is no flash, shake or cloud.
-->
<script lang="ts">
	import { createEventDispatcher, onDestroy, onMount, tick } from 'svelte';
	import { fade } from 'svelte/transition';

	/** The spot that gets deleted. */
	export let target: { label: string; roomName?: string; houseName?: string };
	/** Deletes the booking. Resolves null once it is gone, else the message to show. */
	export let launch: () => Promise<string | null>;

	const dispatch = createEventDispatcher<{ abort: void; done: void }>();

	const HOLD_MS = 2000;
	const ARM_MS = 5000;
	const BLAST_MS = 2200;
	const QUIET_BLAST_MS = 450;
	// A click this soon after a press or release on the launch button belongs to the hold.
	const OWN_CLICK_MS = 800;
	const NO_CONNECTION =
		'We could not reach the server, so nothing was deleted. Check your internet connection and try again.';

	type Stage = 'armed' | 'holding' | 'launching' | 'blast';
	let stage: Stage = 'armed';
	let progress = 0;
	let error = '';
	let announce = '';
	let reduceMotion = false;

	let abortButton: HTMLButtonElement;
	let launchButton: HTMLButtonElement;
	let targetEl: HTMLDivElement;
	let frame = 0;
	let holdStart = 0;
	let lastPress = -Infinity;
	let armedUntil = 0;
	let blastX = 0;
	let blastY = 0;
	let blastTimer: ReturnType<typeof setTimeout> | undefined;
	let previousFocus: HTMLElement | null = null;

	$: place = [target.roomName, target.houseName].filter(Boolean).join(' · ');
	$: locked = stage === 'launching' || stage === 'blast';
	$: secondsLeft = (((1 - progress) * HOLD_MS) / 1000).toFixed(1);
	$: launchText =
		stage === 'launching' ? 'Launching…' : stage === 'blast' ? 'Impact' : 'Hold to launch ☢';

	onMount(async () => {
		reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		previousFocus = document.activeElement as HTMLElement | null;
		document.body.style.overflow = 'hidden';
		await tick();
		// Safe start: Enter on the focused button aborts, it never launches.
		abortButton?.focus();
	});

	onDestroy(() => {
		if (typeof window === 'undefined') return;
		cancelAnimationFrame(frame);
		clearTimeout(blastTimer);
		document.body.style.overflow = '';
		// After an abort the nuke button is still there; after a launch the page moved on.
		if (previousFocus?.isConnected) previousFocus.focus();
	});

	function press() {
		lastPress = performance.now();
		if (stage !== 'armed') return;
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
		if (progress >= 1) void fire();
		else frame = requestAnimationFrame(step);
	}

	function release() {
		lastPress = performance.now();
		if (stage !== 'holding') return;
		cancelAnimationFrame(frame);
		stage = 'armed';
		progress = 0;
	}

	async function fire() {
		stage = 'launching';
		progress = 1;
		armedUntil = 0;
		announce = 'Launching. Deleting your booking…';
		let failure: string | null;
		try {
			failure = await launch();
		} catch {
			failure = NO_CONNECTION;
		}
		if (failure) {
			stage = 'armed';
			progress = 0;
			announce = '';
			error = failure;
			await tick();
			abortButton?.focus();
			return;
		}

		const box = targetEl?.getBoundingClientRect();
		blastX = box ? box.left + box.width / 2 : window.innerWidth / 2;
		blastY = box ? box.top + box.height / 2 : window.innerHeight / 3;
		stage = 'blast';
		announce = `Spot ${target.label} is deleted. Rolling a new spot…`;
		if (!reduceMotion) {
			try {
				navigator.vibrate?.([60, 40, 220]);
			} catch {
				/* no vibration on this device */
			}
		}
		blastTimer = setTimeout(() => dispatch('done'), reduceMotion ? QUIET_BLAST_MS : BLAST_MS);
	}

	function abort() {
		if (locked) return;
		cancelAnimationFrame(frame);
		dispatch('abort');
	}

	function pointerDown(event: PointerEvent) {
		if (event.pointerType === 'mouse' && event.button !== 0) return;
		// Keep the hold when the finger drifts off the button.
		launchButton.setPointerCapture?.(event.pointerId);
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
		release();
	}

	/** A bare click (screen reader): the first arms, a second within ARM_MS launches. */
	function bareClick() {
		const now = performance.now();
		if (stage !== 'armed' || now - lastPress < OWN_CLICK_MS) return;
		if (now < armedUntil) {
			void fire();
			return;
		}
		armedUntil = now + ARM_MS;
		announce = `Armed. Activate the launch button again within ${ARM_MS / 1000} seconds to delete spot ${target.label}.`;
	}

	function windowKeyDown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			event.preventDefault();
			abort();
		} else if (event.key === 'Tab') {
			// Two buttons: keep the focus inside the alert.
			const buttons = [abortButton, launchButton].filter((b) => b && !b.disabled);
			if (buttons.length === 0) return;
			event.preventDefault();
			const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
			const next = (index + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length;
			buttons[next].focus();
		}
	}
</script>

<svelte:window on:keydown={windowKeyDown} />

<div
	class="nuke"
	class:holding={stage === 'holding'}
	class:launching={stage === 'launching'}
	class:blast={stage === 'blast'}
	class:calm={reduceMotion}
	style="--p: {progress}"
	role="alertdialog"
	aria-modal="true"
	aria-labelledby="nuke-title"
	aria-describedby="nuke-fallout"
	transition:fade={{ duration: reduceMotion ? 0 : 180 }}
>
	<div class="siren" aria-hidden="true"></div>
	<div class="hazard" aria-hidden="true"></div>

	<div class="console">
		<div class="alert-head">
			<svg class="trefoil" viewBox="-50 -50 100 100" aria-hidden="true">
				<circle class="disc" r="49" />
				{#each [0, 120, 240] as angle (angle)}
					<path
						class="blade"
						transform="rotate({angle})"
						d="M -22 -38.1 A 44 44 0 0 1 22 -38.1 L 6.5 -11.26 A 13 13 0 0 0 -6.5 -11.26 Z"
					/>
				{/each}
				<circle class="hub" r="8" />
			</svg>
			<p class="defcon">DEFCON 1</p>
		</div>

		<h2 id="nuke-title">
			{#if stage === 'blast'}Spot {target.label} is gone{:else}You are about to nuke your spot{/if}
		</h2>

		<div class="target" bind:this={targetEl}>
			<span class="target-tag">Target</span>
			<strong class="target-label" class:long={target.label.length > 6}>{target.label}</strong>
			{#if place}<span class="target-place">{place}</span>{/if}
		</div>

		<ul id="nuke-fallout" class="fallout">
			<li class="x">
				Your booking of spot <strong>{target.label}</strong> is deleted the moment you launch.
			</li>
			<li class="x">Anyone can grab it right away. There is no undo.</li>
			<li class="x">Until you book a new spot, you have none.</li>
			<li class="roll">Then the roulette rolls a new spot and a new burner name for you.</li>
		</ul>

		{#if error}
			<p class="nuke-error" role="alert">{error}</p>
		{/if}

		<div class="controls">
			<button
				type="button"
				class="abort"
				bind:this={abortButton}
				on:click={abort}
				disabled={locked}
			>
				Abort — keep my spot
			</button>

			<button
				type="button"
				class="launch"
				bind:this={launchButton}
				disabled={locked}
				aria-describedby="nuke-hold-hint"
				on:pointerdown={pointerDown}
				on:pointerup={release}
				on:pointercancel={release}
				on:lostpointercapture={release}
				on:keydown={keyDown}
				on:keyup={keyUp}
				on:blur={release}
				on:click={bareClick}
				on:contextmenu|preventDefault
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
				<span class="launch-text">{launchText}</span>
				<span class="tminus" aria-hidden="true">T-{secondsLeft} s</span>
			</button>
			<p id="nuke-hold-hint" class="hold-hint">
				Press and hold for {HOLD_MS / 1000} seconds. Let go to stop.
			</p>
		</div>

		<p class="sr-only" aria-live="assertive">{announce}</p>
	</div>

	<div class="hazard" aria-hidden="true"></div>

	{#if stage === 'blast' && !reduceMotion}
		<div class="flash" style="--bx: {blastX}px; --by: {blastY}px" aria-hidden="true"></div>
		<div class="shockwave" style="left: {blastX}px; top: {blastY}px" aria-hidden="true"></div>
		<div class="cloud" style="left: {blastX}px; top: {blastY}px" aria-hidden="true">
			<span class="stem"></span>
			<span class="skirt"></span>
			<span class="cap"></span>
		</div>
	{/if}
</div>

<style>
	.nuke {
		--red: #ef4444;
		--amber: #facc15;
		--ink: #fef2f2;
		--muted: #fca5a5;
		--safe: #2dd4bf;
		--mono: 'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, monospace;
		position: fixed;
		inset: 0;
		/* above the page and the booking countdown bar, below dialogs and toasts */
		z-index: 9000;
		display: flex;
		flex-direction: column;
		background: #0a0000;
		color: var(--ink);
		font-family: 'Inter', system-ui, sans-serif;
		overflow-x: hidden;
		overflow-y: auto;
		overscroll-behavior: contain;
		-webkit-tap-highlight-color: transparent;
	}

	/* Red alert: the glow pulses slowly, faster while the button is held.
	   Well under three pulses a second in every stage. */
	.siren {
		position: fixed;
		inset: 0;
		pointer-events: none;
		background:
			radial-gradient(ellipse at 50% 30%, rgba(239, 68, 68, 0.42), transparent 62%),
			radial-gradient(ellipse at 50% 105%, rgba(153, 27, 27, 0.65), transparent 58%);
		animation: siren 1.6s ease-in-out infinite;
	}
	.holding .siren {
		animation-duration: 0.8s;
	}
	.launching .siren {
		animation-duration: 0.6s;
	}
	@keyframes siren {
		0%,
		100% {
			opacity: 0.4;
		}
		50% {
			opacity: 0.95;
		}
	}

	.hazard {
		position: relative;
		flex: none;
		height: 14px;
		overflow: hidden;
		box-shadow: 0 0 18px rgba(250, 204, 21, 0.25);
	}
	.hazard::before {
		content: '';
		position: absolute;
		inset: 0 -48px;
		background: repeating-linear-gradient(-45deg, var(--amber) 0 12px, #111 12px 24px);
		/* one stripe period (24px across the diagonal) per loop: seamless */
		animation: crawl 1.2s linear infinite;
	}
	@keyframes crawl {
		to {
			transform: translateX(33.94px);
		}
	}

	.console {
		position: relative;
		flex: 1 0 auto;
		width: 100%;
		max-width: 520px;
		margin: 0 auto;
		padding: clamp(0.75rem, 2.5vh, 1.5rem) 16px;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: clamp(0.6rem, 1.8vh, 1rem);
		text-align: center;
	}
	.holding .console {
		animation: tremble 0.12s linear infinite;
	}
	@keyframes tremble {
		0%,
		100% {
			transform: translate(0, 0);
		}
		25% {
			transform: translate(calc(var(--p) * 2.5px), calc(var(--p) * -1px));
		}
		50% {
			transform: translate(calc(var(--p) * -2px), calc(var(--p) * 1.5px));
		}
		75% {
			transform: translate(calc(var(--p) * 1.5px), calc(var(--p) * 1px));
		}
	}
	.blast .console {
		animation: quake 0.6s cubic-bezier(0.36, 0.07, 0.19, 0.97) both;
	}
	@keyframes quake {
		10%,
		90% {
			transform: translate(-2px, 1px);
		}
		20%,
		80% {
			transform: translate(5px, -2px);
		}
		30%,
		50%,
		70% {
			transform: translate(-9px, 3px);
		}
		40%,
		60% {
			transform: translate(9px, -3px);
		}
		100% {
			transform: none;
		}
	}

	.alert-head {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.3rem;
	}
	.trefoil {
		width: clamp(44px, 8vh, 64px);
		height: auto;
		filter: drop-shadow(0 0 16px rgba(250, 204, 21, 0.5));
		animation: turn 14s linear infinite;
	}
	.holding .trefoil {
		animation-duration: 2.4s;
	}
	.launching .trefoil {
		animation-duration: 0.9s;
	}
	@keyframes turn {
		to {
			transform: rotate(360deg);
		}
	}
	.trefoil .disc {
		fill: var(--amber);
	}
	.trefoil .blade,
	.trefoil .hub {
		fill: #0a0a0a;
	}

	.defcon {
		margin: 0;
		/* letter-spacing adds space after the last letter too: pad the start to centre */
		padding-left: 0.55em;
		font-family: var(--mono);
		font-size: clamp(0.8rem, 3.4vw, 0.95rem);
		font-weight: 900;
		letter-spacing: 0.55em;
		color: var(--red);
		text-shadow: 0 0 12px rgba(239, 68, 68, 0.85);
	}

	h2 {
		margin: 0;
		font-size: clamp(1.3rem, 6vw, 1.8rem);
		line-height: 1.1;
		font-weight: 900;
		letter-spacing: -0.5px;
		text-transform: uppercase;
		color: #fff;
		text-shadow: 0 0 24px rgba(239, 68, 68, 0.6);
		overflow-wrap: anywhere;
	}

	/* The spot in target-lock brackets (one short bar per corner edge). */
	.target {
		--c: var(--red);
		position: relative;
		width: 100%;
		padding: 0.75rem 1.25rem;
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		background:
			linear-gradient(var(--c) 0 0) top left / 20px 3px,
			linear-gradient(var(--c) 0 0) top left / 3px 20px,
			linear-gradient(var(--c) 0 0) top right / 20px 3px,
			linear-gradient(var(--c) 0 0) top right / 3px 20px,
			linear-gradient(var(--c) 0 0) bottom left / 20px 3px,
			linear-gradient(var(--c) 0 0) bottom left / 3px 20px,
			linear-gradient(var(--c) 0 0) bottom right / 20px 3px,
			linear-gradient(var(--c) 0 0) bottom right / 3px 20px,
			rgba(24, 0, 0, 0.8);
		background-repeat: no-repeat;
		box-shadow: inset 0 0 0 1px rgba(239, 68, 68, 0.25);
		animation: lock-on 1.6s ease-in-out infinite;
	}
	@keyframes lock-on {
		0%,
		100% {
			box-shadow:
				inset 0 0 0 1px rgba(239, 68, 68, 0.25),
				0 0 0 rgba(239, 68, 68, 0);
		}
		50% {
			box-shadow:
				inset 0 0 0 1px rgba(239, 68, 68, 0.5),
				0 0 28px rgba(239, 68, 68, 0.35);
		}
	}
	.target-tag {
		font-family: var(--mono);
		font-size: 0.7rem;
		font-weight: 900;
		letter-spacing: 0.35em;
		text-transform: uppercase;
		color: var(--red);
	}
	.target-label {
		font-family: var(--mono);
		font-size: clamp(1.9rem, 9vw, 2.6rem);
		line-height: 1.05;
		font-weight: 900;
		color: #fff;
		overflow-wrap: anywhere;
	}
	/* Spot labels can be whole phrases. */
	.target-label.long {
		font-size: clamp(1.1rem, 5vw, 1.5rem);
	}
	.target-place {
		font-size: 0.8rem;
		font-weight: 700;
		letter-spacing: 0.5px;
		text-transform: uppercase;
		color: var(--muted);
		overflow-wrap: anywhere;
	}
	.blast .target {
		animation: vaporize 1.1s ease-in forwards;
	}
	@keyframes vaporize {
		0% {
			filter: none;
			transform: none;
			opacity: 1;
		}
		12% {
			filter: brightness(3) saturate(0);
			box-shadow: 0 0 70px rgba(255, 255, 255, 0.85);
		}
		55% {
			filter: grayscale(1) blur(1px) brightness(0.8);
			transform: scale(0.97) skewX(-2deg);
			opacity: 0.8;
		}
		100% {
			filter: grayscale(1) blur(6px) brightness(0.4);
			transform: scale(0.9) translateY(8px);
			opacity: 0.15;
		}
	}

	.fallout {
		list-style: none;
		margin: 0;
		padding: 0;
		width: 100%;
		display: grid;
		gap: 0.45rem;
		text-align: left;
		font-size: clamp(0.85rem, 3.6vw, 0.95rem);
		line-height: 1.4;
		color: #fecaca;
	}
	.fallout li {
		position: relative;
		padding-left: 1.6rem;
	}
	.fallout li::before {
		position: absolute;
		left: 0.1rem;
		top: 0;
		font-weight: 900;
	}
	.fallout .x::before {
		content: '✕';
		color: var(--red);
	}
	.fallout .roll::before {
		content: '↻';
		color: var(--safe);
	}
	.fallout strong {
		color: #fff;
	}

	.nuke-error {
		margin: 0;
		width: 100%;
		padding: 0.75rem 1rem;
		border: 1px solid var(--red);
		border-radius: 12px;
		background: rgba(239, 68, 68, 0.12);
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
	.blast .fallout,
	.blast .controls,
	.blast .nuke-error {
		transition: opacity 0.4s ease 0.15s;
		opacity: 0;
	}

	.abort {
		width: 100%;
		min-height: 52px;
		padding: 0.8rem 1rem;
		border-radius: 14px;
		border: 2px solid var(--safe);
		background: rgba(45, 212, 191, 0.08);
		color: var(--safe);
		font-weight: 900;
		letter-spacing: 1px;
		text-transform: uppercase;
		cursor: pointer;
	}
	.abort:hover:not(:disabled) {
		background: rgba(45, 212, 191, 0.18);
		color: #fff;
	}
	.abort:focus-visible {
		outline: 3px solid var(--safe);
		outline-offset: 3px;
	}
	.abort:disabled {
		opacity: 0.35;
		cursor: default;
	}

	/* The big red button, with the hold ring around it. */
	.launch {
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
		background: radial-gradient(circle at 35% 30%, #f87171, #b91c1c 55%, #450a0a 100%);
		box-shadow:
			0 0 0 6px #1a0000,
			0 0 0 9px rgba(250, 204, 21, 0.55),
			0 12px 40px rgba(239, 68, 68, 0.45),
			inset 0 -8px 18px rgba(0, 0, 0, 0.45);
		/* a long press must not scroll, zoom, select or open a menu */
		touch-action: none;
		user-select: none;
		-webkit-user-select: none;
		-webkit-touch-callout: none;
	}
	.holding .launch,
	.launching .launch {
		transform: scale(0.95);
		box-shadow:
			0 0 0 6px #1a0000,
			0 0 0 9px rgba(250, 204, 21, 0.9),
			0 0 70px rgba(239, 68, 68, 0.8),
			inset 0 8px 20px rgba(0, 0, 0, 0.5);
	}
	.launch:focus-visible {
		outline: 3px solid var(--amber);
		outline-offset: 28px;
	}
	.launch:disabled {
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
		stroke: rgba(250, 204, 21, 0.2);
	}
	.hold-ring .fill {
		stroke: var(--amber);
		stroke-dasharray: 100;
		stroke-linecap: round;
		filter: drop-shadow(0 0 6px rgba(250, 204, 21, 0.9));
	}
	/* Let go early: the ring drains instead of snapping back. */
	.nuke:not(.holding):not(.launching):not(.blast) .hold-ring .fill {
		transition: stroke-dashoffset 0.35s ease-out;
	}
	.launch-text {
		max-width: 80%;
		font-size: clamp(0.78rem, 3.3vw, 0.92rem);
		font-weight: 900;
		line-height: 1.15;
		letter-spacing: 1px;
		text-transform: uppercase;
		text-shadow: 0 1px 2px rgba(0, 0, 0, 0.6);
	}
	.tminus {
		font-family: var(--mono);
		font-size: 0.8rem;
		font-weight: 800;
		font-variant-numeric: tabular-nums;
		color: #fde68a;
	}
	.hold-hint {
		margin: 0.2rem 0 0;
		font-size: 0.75rem;
		color: var(--muted);
	}

	/* The strike: one flash (never a strobe), a shockwave and a mushroom cloud
	   from the target. */
	.flash {
		position: fixed;
		inset: 0;
		pointer-events: none;
		background: radial-gradient(
			circle at var(--bx) var(--by),
			#fff 0%,
			#fff7d6 30%,
			#fde68a 60%,
			#fb923c 100%
		);
		animation: flash 0.9s ease-out forwards;
	}
	@keyframes flash {
		0% {
			opacity: 0;
		}
		8% {
			opacity: 0.92;
		}
		100% {
			opacity: 0;
		}
	}
	.shockwave {
		position: fixed;
		width: 40px;
		height: 40px;
		margin: -20px 0 0 -20px;
		border-radius: 50%;
		border: 5px solid rgba(253, 230, 138, 0.9);
		box-shadow:
			0 0 40px rgba(251, 146, 60, 0.8),
			inset 0 0 30px rgba(251, 146, 60, 0.6);
		pointer-events: none;
		animation: shockwave 1.2s cubic-bezier(0.2, 0.6, 0.3, 1) forwards;
	}
	@keyframes shockwave {
		from {
			transform: scale(0.2);
			opacity: 1;
		}
		to {
			transform: scale(55);
			opacity: 0;
		}
	}
	.cloud {
		position: fixed;
		width: 0;
		height: 0;
		pointer-events: none;
		/* 1em: 15px on a phone, 24px on a laptop */
		font-size: clamp(15px, 1.2vw + 9px, 24px);
	}
	.cloud span {
		position: absolute;
		border-radius: 50%;
		filter: blur(0.35em);
	}
	.stem {
		left: -0.9em;
		bottom: -1.5em;
		width: 1.8em;
		height: 9em;
		border-radius: 40% 40% 20% 20%;
		background: linear-gradient(
			to top,
			rgba(120, 113, 108, 0),
			rgba(251, 146, 60, 0.85) 30%,
			rgba(254, 240, 138, 0.95)
		);
		transform-origin: bottom center;
		animation: stem 2.1s ease-out forwards;
	}
	@keyframes stem {
		0% {
			transform: scaleY(0);
			opacity: 0;
		}
		15% {
			opacity: 1;
		}
		65% {
			transform: scaleY(1);
			opacity: 0.9;
		}
		100% {
			transform: scaleY(1.05);
			opacity: 0;
		}
	}
	.skirt {
		left: -3.6em;
		top: -5.2em;
		width: 7.2em;
		height: 1.6em;
		background: radial-gradient(ellipse, rgba(251, 146, 60, 0.75), rgba(120, 53, 15, 0) 70%);
		animation: skirt 2.1s ease-out forwards;
	}
	@keyframes skirt {
		0%,
		20% {
			transform: scale(0.2);
			opacity: 0;
		}
		50% {
			opacity: 1;
		}
		100% {
			transform: scale(1.5);
			opacity: 0;
		}
	}
	.cap {
		left: -5.75em;
		top: -13.5em;
		width: 11.5em;
		height: 7.2em;
		background: radial-gradient(
			ellipse at 50% 62%,
			#fffbeb 0%,
			#fde047 16%,
			#fb923c 38%,
			#9a3412 58%,
			rgba(68, 64, 60, 0.75) 68%,
			rgba(68, 64, 60, 0) 72%
		);
		animation: cap 2.1s ease-out forwards;
	}
	@keyframes cap {
		0% {
			transform: translateY(11em) scale(0.1);
			opacity: 0;
		}
		18% {
			opacity: 1;
		}
		65% {
			transform: translateY(0) scale(1.1);
			opacity: 1;
		}
		100% {
			transform: translateY(-1.2em) scale(1.3);
			opacity: 0;
		}
	}

	/* Short screens (a 667px phone): everything down to the launch button fits. */
	@media (max-height: 700px) {
		.console {
			gap: 0.5rem;
			padding-block: 0.6rem;
		}
		.alert-head {
			flex-direction: row;
			align-items: center;
			gap: 0.6rem;
		}
		.trefoil {
			width: 40px;
		}
		.defcon {
			padding-left: 0.35em;
			letter-spacing: 0.35em;
		}
		h2 {
			font-size: clamp(1.1rem, 5.2vw, 1.4rem);
		}
		.target {
			padding: 0.6rem 1rem;
		}
		.target-label {
			font-size: clamp(1.5rem, 7vw, 2rem);
		}
		.fallout {
			gap: 0.3rem;
			font-size: 0.82rem;
		}
		.launch {
			width: 108px;
			margin-top: 10px;
		}
	}

	/* Reduced motion: a still red alert, no shake, no flash. */
	.calm .siren,
	.calm .hazard::before,
	.calm .trefoil,
	.calm .target,
	.calm.holding .console,
	.calm.blast .console {
		animation: none;
	}
	.calm .siren {
		opacity: 0.7;
	}
	.calm.blast .target {
		opacity: 0.25;
		filter: grayscale(1);
	}
	@media (prefers-reduced-motion: reduce) {
		.siren,
		.hazard::before,
		.trefoil,
		.target,
		.console {
			animation: none !important;
		}
	}
</style>
