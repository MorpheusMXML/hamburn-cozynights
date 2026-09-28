<!--
@component
One spot of a swap, drawn as a ticket stub: what the spot is ("B7"), where it
is ("Loft #1 · Hut"), the bed when the crew wrote it down, and a kicker that
says which side of the trade it is on ("You give", "You get"). `tone` picks
the colour: turquoise for the guest's own spot (as everywhere), sky blue for
the other one (the swap colour, state.css --swap). Two notches bitten out of
the sides (a mask, so any background shows through) make it read as a ticket.
-->
<script lang="ts">
	import type { SwapSpot } from '$lib/swaps';

	let {
		spot,
		kicker,
		tone = 'mine',
		name = '',
		compact = false
	}: {
		spot: SwapSpot;
		/** Which side of the trade: "You give", "You get", "Yours now". */
		kicker: string;
		tone?: 'mine' | 'theirs';
		/** The burner name sleeping there, when it helps to say. */
		name?: string;
		/** A smaller stub for lists. */
		compact?: boolean;
	} = $props();

	let place = $derived([spot.room, spot.house].filter(Boolean).join(' · '));
</script>

<div class="swap-ticket {tone}" class:compact>
	<span class="kicker">{kicker}</span>
	<strong class="spot" class:long={spot.spot.length > 6}>{spot.spot || '?'}</strong>
	{#if place}<span class="place">{place}</span>{/if}
	{#if spot.bed}<span class="bed">🛏 {spot.bed}</span>{/if}
	{#if name}<span class="name">🔥 {name}</span>{/if}
</div>

<style>
	.swap-ticket {
		--tone: #2dd4bf;
		--tone-soft: rgba(45, 212, 191, 0.1);
		--notch: 9px;
		position: relative;
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		min-width: 0;
		padding: 0.9rem 1.1rem 0.95rem;
		border-radius: 14px;
		border: 1px solid color-mix(in srgb, var(--tone) 55%, transparent);
		background: linear-gradient(160deg, var(--tone-soft), rgba(10, 10, 10, 0.94) 70%);
		/* the notches: two bites out of the sides, halfway down — each half of
		   the mask keeps everything but its own bite */
		-webkit-mask:
			radial-gradient(circle at 0 50%, transparent var(--notch), #000 calc(var(--notch) + 0.5px))
				left / 51% 100% no-repeat,
			radial-gradient(circle at 100% 50%, transparent var(--notch), #000 calc(var(--notch) + 0.5px))
				right / 51% 100% no-repeat;
		mask:
			radial-gradient(circle at 0 50%, transparent var(--notch), #000 calc(var(--notch) + 0.5px))
				left / 51% 100% no-repeat,
			radial-gradient(circle at 100% 50%, transparent var(--notch), #000 calc(var(--notch) + 0.5px))
				right / 51% 100% no-repeat;
		color: #fff;
		text-align: left;
		overflow-wrap: anywhere;
	}
	.swap-ticket.theirs {
		--tone: var(--swap, #38bdf8);
		--tone-soft: rgba(56, 189, 248, 0.12);
	}
	.kicker {
		font-size: 0.62rem;
		font-weight: 900;
		letter-spacing: 2px;
		text-transform: uppercase;
		color: var(--tone);
	}
	.spot {
		font-size: clamp(1.6rem, 7vw, 2.1rem);
		line-height: 1.05;
		font-weight: 900;
		letter-spacing: -0.02em;
		padding-bottom: 0.2rem;
	}
	.spot.long {
		font-size: clamp(1.15rem, 5vw, 1.45rem);
	}
	.place,
	.bed,
	.name {
		font-size: 0.78rem;
		line-height: 1.35;
		color: #b5b5b5;
	}
	.place {
		color: #e5e5e5;
		font-weight: 700;
	}
	.name {
		color: #fde68a;
		font-weight: 700;
	}

	.compact {
		--notch: 7px;
		padding: 0.6rem 0.8rem 0.65rem;
		gap: 0.1rem;
	}
	.compact .spot {
		font-size: 1.25rem;
		padding-bottom: 0.1rem;
	}
	.compact .spot.long {
		font-size: 1rem;
	}
	.compact .place,
	.compact .bed,
	.compact .name {
		font-size: 0.72rem;
	}
</style>
