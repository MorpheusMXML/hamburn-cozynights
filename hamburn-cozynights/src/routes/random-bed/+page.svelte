<!--
Destiny Roulette: a neon slot machine that picks a random free spot.

Pull the lever (or press SPIN) and the three reels, house, room and spot,
stop one after the other on a spot drawn fairly from all free ones
($lib/roulette). Then the name plate takes the burner name: the one the
ticket already has, a typed one, or one rolled with 🎲. "Book it" books;
the Destiny Fulfilled card prints the booking pass while fireworks go up.
A guest who already holds a spot sees it on the reels and can cast ✨ Leave
No Trace to give it up and spin again.
-->
<script lang="ts">
	import { onMount, tick, untrack } from 'svelte';
	import { fade, scale } from 'svelte/transition';
	import { deserialize, enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { ownSpotNote } from '$lib/booking-phase';
	import { CHECKED_IN_NOTE } from '$lib/check-in';
	import BookingRulesNote from '$lib/components/BookingRulesNote.svelte';
	import PassTicket from '$lib/components/PassTicket.svelte';
	import SuccessFireworks from '$lib/components/SuccessFireworks.svelte';
	import LeaveNoTrace from '$lib/components/roulette/LeaveNoTrace.svelte';
	import Lever from '$lib/components/roulette/Lever.svelte';
	import NamePlate from '$lib/components/roulette/NamePlate.svelte';
	import Reel from '$lib/components/roulette/Reel.svelte';
	import type { Point } from '$lib/fx/fireworks';
	import { createSlotSounds, type SlotSounds } from '$lib/fx/slotSounds';
	import {
		BUTTON_PULL,
		IDLE_FACE,
		LAST_SLOW_DOWN_MS,
		REELS,
		REEL_TITLES,
		pickSpot,
		reelKeyframes,
		reelStrip,
		reelValue,
		reelValues,
		spinPlan,
		type RouletteSpot
	} from '$lib/roulette';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const NO_CONNECTION =
		'We could not reach the server, so nothing was changed. Check your internet connection and try again.';
	/** How long Leave No Trace waits for the server before it gives up. */
	const SWEEP_TIMEOUT_MS = 20000;
	/** The jackpot lights: three pulses of the cabinet's glow. */
	const JACKPOT_MS = 1600;

	type ReelApi = { run(rows: string[], keyframes: Keyframe[], duration: number): Promise<void> };

	// The machine: idle until the first pull, spinning, then landed on `chosen`.
	let stage = $state<'idle' | 'spinning' | 'landed'>('idle');
	let chosen = $state<RouletteSpot | null>(null);
	let faces = $state<string[]>(REELS.map(() => IDLE_FACE));
	/** A spot has landed at least once: the name plate stays, also while spinning again. */
	let hasLanded = $state(false);
	let jackpot = $state(false);
	let announce = $state('');
	let guestName = $state(untrack(() => data.burnerName));
	let isBooking = $state(false);
	let bookingError = $state('');

	// The Destiny Fulfilled card: what was booked, and whether its pass is printed yet.
	let fate = $state<{ spot: RouletteSpot; name: string } | null>(null);
	let passPrint = $state<'printing' | 'ready' | 'failed'>('printing');
	let showFireworks = $state(false);
	let fireworksOrigin = $state<Point | null>(null);
	let cardIgnite = $state(false);

	// ✨ Leave No Trace: the spot in the dialog, and the one given up for this
	// spin (the page says so until a new spot is booked).
	let sweepSpot = $state<RouletteSpot | null>(null);
	let sweptSpot = $state<{ id: string; label: string } | null>(null);
	let freshSpots: Promise<void> = Promise.resolve();

	let soundOn = $state(false);
	let sounds: SlotSounds | null = null;
	let reduceMotion = false;
	let jackpotTimer: ReturnType<typeof setTimeout> | undefined;
	let cardTimer: ReturnType<typeof setTimeout> | undefined;

	let houseReel: ReelApi | undefined;
	let roomReel: ReelApi | undefined;
	let spotReel: ReelApi | undefined;
	let lever: { yank(): void } | undefined;
	let namePlate = $state.raw<{ roll(): Promise<void> }>();
	let glassEl: HTMLDivElement | undefined;
	let fateEl = $state<HTMLDivElement>();

	let userBed = $derived(data.userBed);
	let freeBeds = $derived(data.freeBeds);
	let mode = $derived<'mine' | 'resting' | 'soldout' | 'play'>(
		userBed
			? 'mine'
			: !data.isBookingActive
				? 'resting'
				: freeBeds.length === 0 && stage === 'idle'
					? 'soldout'
					: 'play'
	);
	let canRespin = $derived(!!userBed && data.isBookingActive && !data.spotFixed && !data.checkedIn);
	/** What the reels show at rest. */
	let shown = $derived.by(() => {
		if (mode === 'mine' && userBed) return REELS.map((reel) => reelValue(userBed, reel));
		if (mode === 'resting') return REELS.map(() => '🔒');
		if (mode === 'soldout') return REELS.map(() => '🏜️');
		return faces;
	});
	/** The reels show symbols, not a spot: hidden from screen readers. */
	let symbolic = $derived(
		mode === 'resting' || mode === 'soldout' || (mode === 'play' && !hasLanded)
	);
	let readout = $derived.by(() => {
		if (mode === 'mine') return fate ? 'Destiny fulfilled' : 'Your spot';
		if (mode === 'resting') {
			return data.guestPhase === 'closed' ? 'Resting until the next burn' : 'Opens with Live Booking';
		}
		if (mode === 'soldout') return 'Every spot is taken';
		if (isBooking) return 'Booking…';
		if (stage === 'spinning') return 'Spinning…';
		if (stage === 'landed') return '✨ Jackpot ✨';
		return 'Pull the lever';
	});
	let leverLocked = $derived(mode !== 'play' || stage === 'spinning' || isBooking || !!fate);

	onMount(() => {
		reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		sounds = createSlotSounds();
		soundOn = sounds.on;
		return () => {
			clearTimeout(jackpotTimer);
			clearTimeout(cardTimer);
			sounds?.destroy();
		};
	});

	/** Centre of an element in viewport pixels, or null when it isn't laid out. */
	function centerOf(el: Element | null | undefined): Point | null {
		if (!el) return null;
		const box = el.getBoundingClientRect();
		if (box.width === 0 && box.height === 0) return null;
		return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
	}

	/** One pull: the reels run and land on a spot drawn fairly from all free ones. */
	async function spin(strength: number) {
		if (mode !== 'play' || stage === 'spinning' || isBooking) return;
		const spot = pickSpot(freeBeds);
		if (!spot) return;
		bookingError = '';
		chosen = spot;
		stage = 'spinning';
		jackpot = false;
		announce = 'Spinning…';
		const targets = REELS.map((reel) => reelValue(spot, reel));
		const drums = [houseReel, roomReel, spotReel];
		if (reduceMotion || drums.some((drum) => !drum)) {
			faces = targets;
			land(spot);
			return;
		}
		const plan = spinPlan(strength);
		const whirr = sounds?.whirr(REELS.length);
		const runs = REELS.map((reel, i) => {
			const rows = reelStrip(
				reelValues(freeBeds, reel),
				targets[i],
				plan.rows[i],
				Math.random,
				faces[i]
			);
			const last = i === REELS.length - 1;
			const frames = reelKeyframes(
				rows.length,
				plan.durations[i],
				last ? LAST_SLOW_DOWN_MS : undefined
			);
			return drums[i]!.run(rows, frames, plan.durations[i]).then(() => {
				whirr?.stop();
				sounds?.clunk();
			});
		});
		// The reels show their strips now; they show these faces once they stop.
		faces = targets;
		await Promise.all(runs);
		whirr?.end();
		land(spot);
	}

	function land(spot: RouletteSpot) {
		stage = 'landed';
		hasLanded = true;
		announce = `Your spot: ${spot.label}, ${spot.roomName}, ${spot.houseName}. Keep or change your burner name, then book it.`;
		sounds?.jackpot();
		if (reduceMotion) return;
		jackpot = true;
		try {
			navigator.vibrate?.([20, 40, 60]);
		} catch {
			/* no vibration on this device */
		}
		clearTimeout(jackpotTimer);
		jackpotTimer = setTimeout(() => (jackpot = false), JACKPOT_MS);
	}

	/** The lever was pulled (dragged or tapped). */
	function pulled(strength: number) {
		sounds?.ratchet();
		void spin(strength);
	}

	/** SPIN and "Spin again": the lever moves along. */
	function spinButton() {
		if (leverLocked) return;
		lever?.yank();
		pulled(BUTTON_PULL);
	}

	/** Back to the start with a fresh list of free spots; the name stays. */
	async function resetMachine() {
		stage = 'idle';
		chosen = null;
		hasLanded = false;
		faces = REELS.map(() => IDLE_FACE);
		await invalidateAll();
	}

	function toggleSound() {
		if (!sounds) return;
		sounds.set(!sounds.on);
		soundOn = sounds.on;
	}

	const book: SubmitFunction = ({ formData, cancel, submitter }) => {
		const spot = chosen;
		const name = guestName.replace(/\s+/g, ' ').trim();
		if (stage !== 'landed' || !spot || isBooking) {
			cancel();
			return;
		}
		if (!name) {
			// No name yet: roll one first, the next tap books.
			cancel();
			void namePlate?.roll();
			return;
		}
		formData.set('bedId', spot.id);
		formData.set('guestName', name);
		bookingError = '';
		isBooking = true;
		const origin = centerOf(submitter) ?? centerOf(glassEl);

		return async ({ result }) => {
			isBooking = false;
			if (result.type === 'success') {
				fate = { spot, name };
				guestName = name;
				passPrint = 'printing';
				fireworksOrigin = origin;
				showFireworks = true;
				announce = `Destiny fulfilled: spot ${spot.label} is booked for ${name}.`;
				await tick();
				fateEl?.focus();
				try {
					await invalidateAll();
					passPrint = data.pass ? 'ready' : 'failed';
				} catch {
					passPrint = 'failed';
				}
			} else if (result.type === 'failure') {
				bookingError =
					(result.data as { error?: string } | undefined)?.error ||
					'The booking did not go through. Please spin again.';
				// The spot is gone or the state changed: start over with fresh data.
				await resetMachine();
			} else if (result.type === 'error') {
				bookingError = NO_CONNECTION;
			}
		};
	};

	function closeFate() {
		fate = null;
	}

	function igniteCard() {
		cardIgnite = true;
		clearTimeout(cardTimer);
		cardTimer = setTimeout(() => (cardIgnite = false), 1400);
	}

	function windowKey(event: KeyboardEvent) {
		if (event.key === 'Escape' && fate && !sweepSpot) closeFate();
	}

	function openSweep() {
		if (userBed) sweepSpot = userBed;
	}

	/**
	 * The dialog's sweep: deletes the booking right away. Resolves null once it
	 * is gone, else the message the dialog shows. The free spots reload while
	 * the glitter flies.
	 */
	async function releaseSpot(): Promise<string | null> {
		const spot = sweepSpot;
		if (!spot) return null;
		const body = new FormData();
		// Only this spot: if the ticket holds another one by now, nothing is deleted.
		body.set('bedId', spot.id);
		// Bad reception must not leave the guest staring at "Sweeping…".
		const stop = new AbortController();
		const timer = setTimeout(() => stop.abort(), SWEEP_TIMEOUT_MS);
		let result;
		try {
			const response = await fetch('?/releaseBed', {
				method: 'POST',
				body,
				cache: 'no-store',
				signal: stop.signal,
				headers: { accept: 'application/json', 'x-sveltekit-action': 'true' }
			});
			result = deserialize(await response.text());
		} catch {
			return stop.signal.aborted
				? 'The server did not answer. Reload the page and check whether your spot is still there.'
				: NO_CONNECTION;
		} finally {
			clearTimeout(timer);
		}
		if (result.type === 'failure') {
			return (
				(result.data as { error?: string } | undefined)?.error ||
				'Your spot could not be released. It is still yours.'
			);
		}
		if (result.type !== 'success') {
			return 'Your spot could not be released. It is still yours. Reload the page and try again.';
		}
		sweptSpot = { id: spot.id, label: spot.label };
		bookingError = '';
		freshSpots = invalidateAll().catch(() => {});
		return null;
	}

	/** The glitter has settled: spin a new spot from the fresh list, starting where the old one was. */
	async function afterSweep() {
		const old = sweepSpot;
		await freshSpots;
		sweepSpot = null;
		await tick();
		if (userBed) {
			// The spot is released, but the reload of the free spots failed: the
			// page still shows the old one, so ask for a reload instead of spinning.
			bookingError =
				'Your spot is released, but the free spots could not be loaded. Please reload the page, then spin.';
			return;
		}
		if (old) faces = REELS.map((reel) => reelValue(old, reel));
		stage = 'idle';
		chosen = null;
		hasLanded = true;
		if (!guestName.trim()) guestName = data.burnerName;
		lever?.yank();
		void spin(BUTTON_PULL);
	}
</script>

<svelte:head>
	<title>Destiny Roulette · CozyNights</title>
</svelte:head>

<svelte:window onkeydown={windowKey} />

<div class="page">
	<nav class="nav">
		<a href="/map" class="back-link">← Return to Map</a>
	</nav>

	<section
		class="machine"
		class:spinning={stage === 'spinning'}
		class:jackpot
		class:asleep={mode === 'resting' || mode === 'soldout'}
		aria-labelledby="machine-title"
	>
		<header class="marquee">
			<span class="bulbs top" aria-hidden="true"><i></i><i></i></span>
			<h1 id="machine-title" class="neon">Luck of the Playa</h1>
			<p class="tagline">Surrender to the dust. We'll find you a home.</p>
			<span class="bulbs bottom" aria-hidden="true"><i></i><i></i></span>
		</header>

		<div class="readout">
			<span class="readout-text">{readout}</span>
			<button
				type="button"
				class="sound"
				aria-label="Sound"
				aria-pressed={soundOn}
				title={soundOn ? 'Turn the sound off' : 'Turn the sound on'}
				onclick={toggleSound}
			>
				<span aria-hidden="true">{soundOn ? '🔊' : '🔈'}</span>
			</button>
		</div>

		<div class="body">
			<div class="glass" bind:this={glassEl}>
				<Reel
					bind:this={houseReel}
					kind="house"
					title={REEL_TITLES.house}
					value={shown[0]}
					decorative={symbolic}
				/>
				<Reel
					bind:this={roomReel}
					kind="room"
					title={REEL_TITLES.room}
					value={shown[1]}
					decorative={symbolic}
				/>
				<Reel
					bind:this={spotReel}
					kind="spot"
					title={REEL_TITLES.spot}
					value={shown[2]}
					decorative={symbolic}
				/>
			</div>
			<Lever
				bind:this={lever}
				disabled={leverLocked}
				onpull={pulled}
				onratchet={() => sounds?.tick()}
			/>
		</div>

		<!-- Visually hidden on purpose: the layout test skips it. -->
		<p class="sr-only" aria-live="polite" data-layout-ignore>{announce}</p>

		{#if bookingError}
			<p class="error-msg" role="alert">{bookingError}</p>
		{/if}

		{#if sweptSpot && !userBed && !fate}
			<p class="swept-note" role="status">
				✨ Spot {sweptSpot.label} left no trace, and you have no spot right now. Book a new one before
				you leave.
			</p>
		{/if}

		<div class="tray">
			{#if mode === 'mine' && userBed}
				<p class="tray-title">You already have a home for the night</p>
				{#if data.checkedIn}
					<p class="tray-text">{CHECKED_IN_NOTE}</p>
				{:else if data.spotFixed}
					<p class="tray-text">
						The crew picked this spot for you because of your special-needs request, so only the
						crew can change it.
					</p>
				{:else if data.isBookingActive}
					<p class="tray-text">
						Feeling lucky? Leave No Trace sweeps this spot away and the machine spins you a new one.
						Your booking ends the moment the sweep is done.
					</p>
				{:else}
					<p class="tray-text">{ownSpotNote(data.phase, data.guestPhase)}</p>
				{/if}
				<div class="tray-actions">
					<a href="/room/{userBed.roomId}" class="btn-goto">Visit My Room</a>
					{#if canRespin}
						<button type="button" class="btn-sweep" onclick={openSweep}>
							✨ Leave No Trace &amp; Respin
						</button>
					{/if}
				</div>
			{:else if mode === 'resting'}
				<p class="tray-text">
					{data.guestPhase === 'closed'
						? 'Booking is closed. The roulette is resting until the next burn.'
						: 'Booking is not open yet. Come back when Live Booking starts.'}
				</p>
			{:else if mode === 'soldout'}
				<p class="tray-text">
					Every spot is taken right now. Check back later: a spot gets free again when someone
					releases theirs.
				</p>
			{:else}
				<!-- "Book it" is a real submit button (no requestSubmit(), which older
				     iOS Safari lacks); `book` decides whether it books or first rolls a name. -->
				<form id="random-form" method="POST" action="?/bookRandom" use:enhance={book}>
					<input type="hidden" name="bedId" value={chosen?.id ?? ''} />
					{#if hasLanded}
						<div class="landed" in:fade={{ duration: 250 }}>
							<NamePlate
								bind:this={namePlate}
								bind:value={guestName}
								locked={isBooking}
								ontick={() => sounds?.tick()}
								onrolled={() => sounds?.ding()}
							/>
							<button
								type="submit"
								class="btn-book btn-ignite"
								disabled={isBooking || stage !== 'landed'}
							>
								{isBooking ? 'Booking…' : 'Book it 🌵'}
							</button>
							<button type="button" class="btn-again" onclick={spinButton} disabled={leverLocked}>
								Spin again 🎰
							</button>
						</div>
					{:else}
						<button
							type="button"
							class="btn-spin btn-confirm"
							onclick={spinButton}
							disabled={leverLocked}
						>
							{stage === 'spinning' ? 'Spinning…' : 'Spin 🎰'}
						</button>
						<p class="lever-hint">…or grab the lever and pull it down.</p>
					{/if}
					<BookingRulesNote />
				</form>
			{/if}
		</div>

		<div class="ticket-slot" aria-hidden="true"></div>
		{#if mode === 'mine' && data.pass && !fate}
			<div class="printed">
				<PassTicket pass={data.pass} />
			</div>
		{/if}
	</section>
</div>

{#if sweepSpot}
	<LeaveNoTrace
		spot={sweepSpot}
		release={releaseSpot}
		oncancel={() => (sweepSpot = null)}
		ondone={afterSweep}
		onpoof={() => sounds?.poof()}
	/>
{/if}

{#if fate}
	<div class="fate-overlay" transition:fade={{ duration: 200 }}>
		<div
			class="fate"
			class:ignite={cardIgnite}
			bind:this={fateEl}
			role="dialog"
			aria-modal="true"
			aria-labelledby="fate-title"
			tabindex="-1"
			in:scale={{ start: 0.92, duration: 320 }}
		>
			<div class="fate-top">
				<p class="fate-kicker" aria-hidden="true">✨ Jackpot ✨</p>
				<button type="button" class="fate-close" onclick={closeFate} aria-label="Close">✕</button>
			</div>
			<h2 id="fate-title">Destiny Fulfilled!</h2>
			<p>You are now known as <strong>{fate.name}</strong>.</p>
			<p>
				Your new home is spot <strong>{fate.spot.label}</strong> in
				<strong>{fate.spot.roomName}</strong>
				({fate.spot.houseName}).
			</p>
			{#if sweptSpot}
				<p class="swept-line">
					{sweptSpot.id === fate.spot.id
						? `Fate sent you straight back to spot ${sweptSpot.label}.`
						: `Spot ${sweptSpot.label} left no trace.`}
				</p>
			{/if}
			<div class="print">
				<span class="print-slot" aria-hidden="true"></span>
				{#if passPrint === 'ready' && data.pass}
					<div class="printed">
						<PassTicket pass={data.pass} />
					</div>
				{:else if passPrint === 'printing'}
					<p class="printing">Printing your booking pass…</p>
				{/if}
			</div>
			<div class="fate-actions">
				<a href="/room/{fate.spot.roomId}" class="btn-goto">Visit My Room</a>
				<a href="/map" class="btn-map">Back to Map</a>
			</div>
		</div>
	</div>
{/if}

{#if showFireworks}
	<SuccessFireworks
		zIndex={1001}
		origin={fireworksOrigin}
		onfinale={igniteCard}
		ondone={() => (showFireworks = false)}
	/>
{/if}

<style>
	/* The machine's colours, for the page and the Destiny Fulfilled card on top of it. */
	.page,
	.fate-overlay {
		--pink: #f472b6;
		--purple: #a855f7;
		--teal: #2dd4bf;
		--gold: #fde68a;
	}

	.page {
		min-height: 100vh;
		min-height: 100dvh;
		display: flex;
		flex-direction: column;
		align-items: center;
		padding: clamp(1rem, 4vw, 2rem);
		padding-bottom: max(2rem, env(safe-area-inset-bottom));
		color: #fff;
		font-family: 'Inter', system-ui, sans-serif;
	}

	.nav {
		width: 100%;
		max-width: 640px;
		margin-bottom: clamp(0.5rem, 3vw, 1.25rem);
	}
	.back-link {
		display: inline-flex;
		align-items: center;
		min-height: 44px;
		padding-right: 0.75rem;
		color: #2dd4bf;
		text-decoration: none;
		font-weight: 900;
		font-size: 0.8rem;
		text-transform: uppercase;
		letter-spacing: 1px;
	}

	/* ── The cabinet ─────────────────────────────────────────────── */
	.machine {
		--pad: clamp(10px, 3vw, 22px);
		container: machine / inline-size;
		position: relative;
		width: 100%;
		max-width: 640px;
		padding: 0 var(--pad) calc(var(--pad) + 4px);
		border-radius: 30px 30px 22px 22px;
		/* neon light falling onto the cabinet: static, it never repaints */
		background:
			radial-gradient(90% 55% at 0% 22%, rgba(168, 85, 247, 0.2), transparent 62%),
			radial-gradient(90% 55% at 100% 80%, rgba(45, 212, 191, 0.13), transparent 62%),
			radial-gradient(70% 45% at 100% 100%, rgba(251, 146, 60, 0.12), transparent 60%),
			linear-gradient(180deg, #1c1024 0%, #0f0a15 42%, #0a090d 100%);
		box-shadow:
			0 30px 80px rgba(0, 0, 0, 0.7),
			inset 0 1px 0 rgba(255, 255, 255, 0.08);
		text-align: center;
	}
	/* The neon rim: a gradient border (masked to the edge). */
	.machine::before {
		content: '';
		position: absolute;
		inset: 0;
		padding: 2px;
		border-radius: inherit;
		background: linear-gradient(135deg, var(--pink), var(--purple) 40%, var(--teal) 72%, #fb923c);
		-webkit-mask:
			linear-gradient(#000 0 0) content-box,
			linear-gradient(#000 0 0);
		-webkit-mask-composite: xor;
		mask:
			linear-gradient(#000 0 0) content-box,
			linear-gradient(#000 0 0);
		mask-composite: exclude;
		pointer-events: none;
	}
	/* Its glow behind the cabinet (z-index -1 in the page's stacking context),
	   drawn once; the jackpot only changes its opacity (composited). */
	.machine::after {
		content: '';
		position: absolute;
		inset: -6px;
		z-index: -1;
		border-radius: 34px 34px 26px 26px;
		background: linear-gradient(135deg, var(--pink), var(--purple) 40%, var(--teal) 72%, #fb923c);
		filter: blur(18px);
		opacity: 0.28;
		pointer-events: none;
	}
	.machine.jackpot::after {
		animation: win-glow 0.5s ease-in-out 3;
	}
	@keyframes win-glow {
		50% {
			opacity: 0.85;
		}
	}
	.machine.asleep::after {
		opacity: 0.1;
	}

	/* The marquee with its chasing bulbs. */
	.marquee {
		position: relative;
		margin: 0 calc(-1 * var(--pad));
		padding: 1.45rem 1rem 1.2rem;
		border-radius: 30px 30px 16px 16px;
		background:
			radial-gradient(120% 150% at 50% 0%, rgba(244, 114, 182, 0.28), transparent 60%),
			linear-gradient(180deg, #2a0f2a, #150a1b);
		border-bottom: 2px solid rgba(253, 230, 138, 0.22);
	}
	.bulbs {
		position: absolute;
		left: 18px;
		right: 18px;
		height: 10px;
		pointer-events: none;
	}
	.bulbs.top {
		top: 6px;
	}
	.bulbs.bottom {
		bottom: 5px;
	}
	/* Two sets of bulbs, every other one; they take turns (opacity only). */
	.bulbs i {
		position: absolute;
		inset: 0;
		background: radial-gradient(
				circle at 5px 5px,
				#fffbeb 0 1.6px,
				#fbbf24 2.4px,
				rgba(251, 191, 36, 0) 4.4px
			)
			0 0 / 22px 10px repeat-x;
		filter: drop-shadow(0 0 3px rgba(251, 191, 36, 0.9));
		animation: bulbs-a 1.6s steps(1, end) infinite;
	}
	.bulbs i + i {
		background-position: 11px 0;
		animation-name: bulbs-b;
	}
	@keyframes bulbs-a {
		0% {
			opacity: 1;
		}
		50% {
			opacity: 0.25;
		}
	}
	@keyframes bulbs-b {
		0% {
			opacity: 0.25;
		}
		50% {
			opacity: 1;
		}
	}
	.spinning .bulbs i {
		animation-duration: 0.6s;
	}
	.jackpot .bulbs i {
		animation: none;
		opacity: 1;
	}
	.asleep .bulbs i {
		animation: none;
		opacity: 0.18;
	}

	.neon {
		margin: 0;
		font-size: clamp(1.45rem, 7.5vw, 2.4rem);
		line-height: 1.05;
		font-weight: 900;
		letter-spacing: 0.02em;
		text-transform: uppercase;
		color: #ffe4f1;
		text-shadow:
			0 0 4px #fff,
			0 0 10px var(--pink),
			0 0 22px var(--pink),
			0 0 44px var(--purple);
		animation: neon-on 1.4s ease-out 1 both;
	}
	/* The tubes flicker on once, twice under three flashes a second. */
	@keyframes neon-on {
		0% {
			opacity: 0.15;
		}
		18% {
			opacity: 1;
		}
		30% {
			opacity: 0.4;
		}
		48%,
		100% {
			opacity: 1;
		}
	}
	.asleep .neon {
		opacity: 0.55;
		animation: none;
	}
	.tagline {
		margin: 0.4rem 0 0;
		font-size: clamp(0.8rem, 3.4vw, 0.92rem);
		font-weight: 600;
		line-height: 1.35;
		color: #e9d5ff;
	}

	/* The LED ticker and the sound switch. */
	.readout {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		margin: 0.85rem 0 0.75rem;
		padding: 0.3rem 0.35rem 0.3rem 0.85rem;
		border-radius: 10px;
		background: #0d0a03;
		box-shadow:
			inset 0 0 0 1px rgba(251, 191, 36, 0.28),
			inset 0 0 18px rgba(0, 0, 0, 0.9);
	}
	.readout-text {
		flex: 1 1 auto;
		min-width: 0;
		text-align: left;
		font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
		font-size: 0.78rem;
		font-weight: 800;
		line-height: 1.3;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		color: #fcd34d;
		text-shadow: 0 0 8px rgba(251, 191, 36, 0.7);
	}
	.sound {
		flex: none;
		min-width: 44px;
		min-height: 36px;
		border: 1px solid rgba(251, 191, 36, 0.3);
		border-radius: 8px;
		background: #17120a;
		font-size: 1.05rem;
		line-height: 1;
		cursor: pointer;
	}
	.sound[aria-pressed='true'] {
		border-color: #fcd34d;
		box-shadow: 0 0 10px rgba(251, 191, 36, 0.35);
	}
	.sound:focus-visible {
		outline: 3px solid #fde68a;
		outline-offset: 2px;
	}

	/* The glass with the reels, and the lever beside it. */
	.body {
		display: flex;
		align-items: center;
		gap: clamp(6px, 2vw, 12px);
	}
	.glass {
		position: relative;
		flex: 1 1 auto;
		min-width: 0;
		display: grid;
		gap: 0.55rem;
		padding: 0.65rem;
		border-radius: 18px;
		background: linear-gradient(180deg, #120d18, #07060a);
		box-shadow:
			inset 0 0 0 2px rgba(255, 255, 255, 0.06),
			inset 0 12px 30px rgba(0, 0, 0, 0.85),
			0 0 0 1px rgba(244, 114, 182, 0.22);
	}
	/* The jackpot's gold frame, drawn once and faded in and out. */
	.glass::after {
		content: '';
		position: absolute;
		inset: -3px;
		border-radius: 20px;
		box-shadow:
			0 0 0 2px var(--gold),
			0 0 26px rgba(253, 230, 138, 0.6);
		opacity: 0;
		pointer-events: none;
	}
	.jackpot .glass::after {
		animation: win-frame 0.5s ease-in-out 3;
	}
	@keyframes win-frame {
		50% {
			opacity: 1;
		}
	}
	@container machine (min-width: 36rem) {
		.glass {
			grid-template-columns: repeat(3, minmax(0, 1fr));
		}
	}

	/* ── The tray: what to do next ───────────────────────────────── */
	.error-msg,
	.swept-note {
		margin: 1rem 0 0;
		padding: 0.75rem 1rem;
		border-radius: 12px;
		font-weight: 700;
		line-height: 1.45;
		text-align: left;
		overflow-wrap: anywhere;
	}
	.error-msg {
		border: 1px solid #f87171;
		background: rgba(248, 113, 113, 0.1);
		color: #fecaca;
	}
	.swept-note {
		border: 1px solid rgba(196, 181, 253, 0.6);
		border-left-width: 4px;
		background: rgba(139, 92, 246, 0.12);
		color: #ede9fe;
	}

	.tray {
		margin-top: 1rem;
	}
	.tray form,
	.landed {
		display: flex;
		flex-direction: column;
		gap: 0.9rem;
	}
	.tray-title {
		margin: 0 0 0.5rem;
		font-size: 1.1rem;
		font-weight: 900;
		color: #fff;
	}
	.tray-text {
		margin: 0;
		color: #c9c2d6;
		font-size: 0.95rem;
		line-height: 1.5;
	}
	.tray-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
		margin-top: 1rem;
	}

	.btn-spin,
	.btn-book {
		width: 100%;
		min-height: 58px;
		padding: 0.9rem 1rem;
		border: 0;
		border-radius: 16px;
		font-size: clamp(1.05rem, 4.6vw, 1.25rem);
		font-weight: 900;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		cursor: pointer;
	}
	.btn-spin {
		background: linear-gradient(135deg, var(--pink), var(--purple));
		color: #fff;
		box-shadow: 0 10px 24px rgba(244, 114, 182, 0.35);
	}
	.btn-spin:hover:not(:disabled) {
		transform: translateY(-3px);
	}
	.btn-book {
		background: var(--teal);
		color: #041312;
		box-shadow: 0 10px 24px rgba(45, 212, 191, 0.3);
	}
	.btn-book:hover:not(:disabled) {
		transform: scale(1.02);
	}
	.btn-spin:disabled,
	.btn-book:disabled,
	.btn-again:disabled {
		opacity: 0.55;
		cursor: progress;
	}
	.lever-hint {
		margin: -0.3rem 0 0;
		font-size: 0.8rem;
		color: #a39bb0;
	}
	.btn-again {
		min-height: 48px;
		padding: 0.75rem 1rem;
		border: 2px solid #4a3f5c;
		border-radius: 12px;
		background: #110d17;
		color: #d8d0e6;
		font-weight: 900;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		font-size: 0.85rem;
		cursor: pointer;
	}
	.btn-again:hover:not(:disabled) {
		border-color: var(--pink);
		color: #fff;
	}

	.btn-goto,
	.btn-map,
	.btn-sweep {
		flex: 1 1 140px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-height: 48px;
		padding: 0.8rem 1rem;
		border-radius: 12px;
		font-weight: 900;
		text-align: center;
		text-decoration: none;
	}
	.btn-goto {
		background: var(--teal);
		color: #000;
	}
	.btn-goto:hover {
		transform: scale(1.03);
	}
	.btn-map {
		border: 1px solid #444;
		color: #b5b5b5;
	}
	/* ✨ Leave No Trace: a little magic, it gives the spot back to the playa. */
	.btn-sweep {
		border: 2px solid rgba(196, 181, 253, 0.7);
		background:
			radial-gradient(120% 160% at 0% 0%, rgba(244, 114, 182, 0.25), transparent 60%), #1a1026;
		color: #ede9fe;
		letter-spacing: 0.02em;
		cursor: pointer;
	}
	.btn-sweep:hover {
		color: #fff;
		box-shadow: 0 0 22px rgba(196, 181, 253, 0.45);
	}
	.btn-sweep:focus-visible {
		outline: 3px solid var(--gold);
		outline-offset: 3px;
	}

	/* The ticket slot at the foot of the machine; the pass comes out of it. */
	.ticket-slot {
		width: min(80%, 22rem);
		height: 9px;
		margin: 1.2rem auto 0;
		border-radius: 5px;
		background: #000;
		box-shadow:
			inset 0 2px 4px rgba(0, 0, 0, 0.95),
			0 1px 0 rgba(255, 255, 255, 0.09);
	}
	.printed {
		display: flex;
		justify-content: center;
		margin-top: -0.55rem;
		animation: print-out 1s cubic-bezier(0.22, 0.9, 0.3, 1) both;
	}
	@keyframes print-out {
		from {
			clip-path: inset(0 -30px 100% -30px);
			transform: translateY(-1.25rem);
		}
		to {
			clip-path: inset(-30px -30px -30px -30px);
			transform: none;
		}
	}

	/* ── Destiny Fulfilled ───────────────────────────────────────── */
	.fate-overlay {
		position: fixed;
		inset: 0;
		z-index: 1000;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1rem;
		/* no backdrop blur: the floating creatures behind would re-blur every frame */
		background:
			radial-gradient(80% 60% at 50% 40%, rgba(45, 212, 191, 0.12), transparent 70%),
			rgba(4, 3, 8, 0.9);
	}
	.fate {
		position: relative;
		width: 100%;
		max-width: 480px;
		max-height: calc(100vh - 2rem);
		max-height: calc(100dvh - 2rem);
		overflow-y: auto;
		padding: clamp(1.1rem, 5vw, 2.25rem);
		border: 2px solid var(--teal);
		border-radius: clamp(22px, 7vw, 36px);
		background: #0a0a0c;
		box-shadow: 0 0 90px rgba(45, 212, 191, 0.3);
		text-align: center;
		color: #fff;
	}
	.fate:focus {
		outline: none;
	}
	/* The finale of the fireworks lights the card up for a moment. */
	.fate.ignite {
		animation: card-ignite 1.4s ease-out;
	}
	@keyframes card-ignite {
		18% {
			border-color: #ffd27a;
			box-shadow:
				0 0 80px rgba(251, 146, 60, 0.6),
				0 0 160px rgba(255, 210, 122, 0.35);
			transform: scale(1.012);
		}
	}
	.fate-top {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	/* The close button's twin on the left keeps the kicker centred. */
	.fate-top::before {
		content: '';
		flex: 0 0 40px;
	}
	.fate-kicker {
		flex: 1 1 auto;
		margin: 0;
		font-size: 0.8rem;
		font-weight: 900;
		letter-spacing: 0.25em;
		text-transform: uppercase;
		color: var(--gold);
	}
	.fate-close {
		flex: 0 0 40px;
		height: 40px;
		border: 1px solid #333;
		border-radius: 50%;
		background: #111;
		color: #bbb;
		font-size: 1rem;
		cursor: pointer;
	}
	.fate-close:hover {
		color: #fff;
		border-color: #666;
	}
	.fate h2 {
		margin: 0.4rem 0 1.1rem;
		font-size: clamp(1.6rem, 8vw, 2.4rem);
		line-height: 1.15;
		font-weight: 900;
		color: #2dd4bf;
		text-shadow: 0 0 24px rgba(45, 212, 191, 0.45);
	}
	.fate p {
		margin: 0 0 0.8rem;
		color: #b5b5b5;
		font-size: 1.02rem;
		line-height: 1.45;
		overflow-wrap: anywhere;
	}
	.fate strong {
		color: #fff;
	}
	.fate .swept-line {
		color: #ddd6fe;
		font-weight: 700;
	}
	.print {
		display: flex;
		flex-direction: column;
		align-items: center;
		margin-top: 0.8rem;
	}
	.print-slot {
		width: min(100%, 26rem);
		height: 8px;
		border-radius: 4px;
		background: #000;
		box-shadow:
			inset 0 2px 3px rgba(0, 0, 0, 0.95),
			0 1px 0 rgba(255, 255, 255, 0.09);
	}
	.print .printed {
		width: 100%;
	}
	.fate .printing {
		margin: 0.7rem 0 0;
		font-size: 0.85rem;
		color: #a3a3a3;
	}
	.fate-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
		margin-top: 1.4rem;
	}

	/* Reduced motion: the machine stands still, the lights stay on. */
	@media (prefers-reduced-motion: reduce) {
		.bulbs i,
		.spinning .bulbs i {
			animation: none;
			opacity: 1;
		}
		.neon,
		.machine.jackpot::after,
		.jackpot .glass::after,
		.printed,
		.fate.ignite {
			animation: none;
		}
	}
</style>
