<script context="module" lang="ts">
	/** The spot kinds the ring is cut into; they add up to the active spots. */
	export type DonutPart = 'occupied' | 'free' | 'locked' | 'special';
</script>

<script lang="ts">
	import { createEventDispatcher, onMount } from 'svelte';
	import NumberFlow from '@number-flow/svelte';
	import type { SpotCounts } from '$lib/occupancy';
	import { loadOf } from '$lib/intel';

	export let spots: SpotCounts;
	/** The part the pointer (or a tile) is on: the ring lights it up. */
	export let highlight: DonutPart | null = null;
	/** The part the house table is sorted by. */
	export let picked: DonutPart | null = null;

	const dispatch = createEventDispatcher<{ pick: DonutPart; hover: DonutPart | null }>();

	// NumberFlow's server-rendered markup doesn't hydrate cleanly (same as
	// CountdownDigits): plain digits until mounted, rolling ones afterwards.
	let mounted = false;
	onMount(() => (mounted = true));

	const RADIUS = 42;
	const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
	// 2 px of the panel's own colour between two slices (the SVG is 148 px for
	// 100 units): the slices read as separate without a border drawn round them.
	const GAP = 1.4;

	const PARTS: { key: DonutPart; label: string; state: string }[] = [
		{ key: 'occupied', label: 'Taken', state: 'full' },
		{ key: 'free', label: 'Free', state: 'open' },
		{ key: 'locked', label: 'Held back', state: 'locked' },
		{ key: 'special', label: '♿ Reserved', state: 'special' }
	];

	interface Slice {
		key: DonutPart;
		label: string;
		state: string;
		value: number;
		dash: string;
		offset: number;
	}

	// Occupied, free, held back and ♿ partition the active spots, so the four
	// arcs fill the circle exactly and nothing is left unexplained.
	$: slices = ((): Slice[] => {
		const shown = PARTS.filter((part) => spots[part.key] > 0).length;
		const gap = shown > 1 ? GAP : 0;
		let covered = 0;
		return PARTS.map((part) => {
			const value = spots[part.key];
			const length = spots.total > 0 ? (value / spots.total) * CIRCUMFERENCE : 0;
			const drawn = Math.max(0, length - gap);
			const slice = {
				...part,
				value,
				dash: `${drawn} ${CIRCUMFERENCE - drawn}`,
				offset: -(covered + gap / 2)
			};
			covered += length;
			return slice;
		});
	})();

	$: load = loadOf(spots);
	$: lit = highlight ? slices.find((slice) => slice.key === highlight) : null;
	$: focus = highlight ?? picked;
</script>

<div class="donut-box">
	<svg
		class="intel-donut"
		viewBox="0 0 100 100"
		role="img"
		aria-label="{spots.occupied} of {spots.total} spots taken, {spots.free} free, {spots.locked} held back, {spots.special} reserved for special needs"
	>
		<circle class="donut-track" cx="50" cy="50" r={RADIUS} />
		{#each slices as slice (slice.key)}
			{#if slice.value > 0}
				<!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
				<circle
					class="donut-slice"
					class:dim={focus !== null && focus !== slice.key}
					data-state={slice.state}
					cx="50"
					cy="50"
					r={RADIUS}
					stroke-dasharray={slice.dash}
					stroke-dashoffset={slice.offset}
					on:click={() => dispatch('pick', slice.key)}
					on:pointerenter={() => dispatch('hover', slice.key)}
					on:pointerleave={() => dispatch('hover', null)}
				>
					<title>{slice.label}: {slice.value}</title>
				</circle>
			{/if}
		{/each}
	</svg>
	<div class="donut-centre" aria-hidden="true">
		{#if lit}
			<span class="donut-value">{lit.value}</span>
			<span class="donut-label">{lit.label}</span>
		{:else}
			<span class="donut-value">
				{#if mounted}<NumberFlow value={load} />{:else}{load}{/if}<span class="donut-unit">%</span>
			</span>
			<span class="donut-label">LOAD</span>
		{/if}
	</div>
</div>

<style>
	.donut-box {
		position: relative;
		width: 148px;
		height: 148px;
		flex-shrink: 0;
	}
	/* Not `class="ring"`: that is a Tailwind utility (a 1 px box-shadow in
	   currentColor), and Tailwind emits it globally — it drew a white square
	   frame round the chart. */
	.intel-donut {
		display: block;
		width: 100%;
		height: 100%;
		transform: rotate(-90deg);
		overflow: visible;
	}
	.donut-track {
		fill: none;
		stroke: #1a1a1a;
		stroke-width: 10;
	}
	.donut-slice {
		fill: none;
		stroke: var(--state);
		stroke-width: 10;
		stroke-linecap: butt;
		cursor: pointer;
		/* Only the arcs move, and only when a number changes. */
		transition:
			stroke-dasharray 0.6s cubic-bezier(0.4, 0, 0.2, 1),
			stroke-dashoffset 0.6s cubic-bezier(0.4, 0, 0.2, 1),
			opacity 0.2s ease;
	}
	.donut-slice.dim {
		opacity: 0.3;
	}
	.donut-centre {
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		pointer-events: none;
	}
	.donut-value {
		display: inline-flex;
		align-items: baseline;
		font-size: 1.6rem;
		font-weight: 900;
		color: #fff;
	}
	.donut-unit {
		font-size: 0.9rem;
		color: #737373;
		margin-left: 0.1em;
	}
	.donut-label {
		max-width: 96px;
		font-size: 0.5rem;
		color: #a3a3a3;
		font-weight: 900;
		letter-spacing: 2px;
		text-transform: uppercase;
		text-align: center;
	}

	@media (prefers-reduced-motion: reduce) {
		.donut-slice {
			transition: none;
		}
	}
</style>
