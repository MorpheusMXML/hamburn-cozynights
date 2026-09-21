<script lang="ts">
	import { onMount } from 'svelte';
	import NumberFlow from '@number-flow/svelte';
	import type { LiveStats } from '$lib/live-stats';

	/** The live booking picture: first from the page load, then from the poll. */
	export let stats: LiveStats;

	// NumberFlow's server-rendered markup doesn't hydrate cleanly (same as
	// CountdownDigits): plain digits until mounted, rolling ones afterwards.
	let mounted = false;
	onMount(() => (mounted = true));

	$: spots = stats.spots;
	$: houseStates = stats.houseStates;
	$: load = spots.total > 0 ? Math.round((spots.occupied / spots.total) * 100) : 0;

	// The ring: occupied, free, held back and ♿ add up to the active spots, so
	// the four arcs fill the circle exactly and nothing is left unexplained.
	const RADIUS = 42;
	const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
	interface Slice {
		key: string;
		label: string;
		value: number;
		state: string;
		dash: string;
		offset: number;
	}
	$: slices = ((): Slice[] => {
		const parts = [
			{ key: 'occupied', label: 'Taken', value: spots.occupied, state: 'full' },
			{ key: 'free', label: 'Free', value: spots.free, state: 'open' },
			{ key: 'locked', label: 'Held back', value: spots.locked, state: 'locked' },
			{ key: 'special', label: '♿ Reserved', value: spots.special, state: 'special' }
		];
		let covered = 0;
		return parts.map((part) => {
			const fraction = spots.total > 0 ? part.value / spots.total : 0;
			const length = fraction * CIRCUMFERENCE;
			const slice = {
				...part,
				dash: `${length} ${CIRCUMFERENCE - length}`,
				offset: -covered * CIRCUMFERENCE
			};
			covered += fraction;
			return slice;
		});
	})();

	// Day bars scale to the busiest day, never to zero: a flat week still shows
	// its baseline instead of an empty box.
	$: peak = Math.max(1, ...stats.trend.values);
	$: today = stats.trend.values.length - 1;

	const tiles = [
		{ key: 'occupied', label: 'Taken', state: 'full', hint: 'Spots with a ticket on them' },
		{ key: 'free', label: 'Free', state: 'open', hint: 'Spots a guest can still book' },
		{
			key: 'checkedIn',
			label: 'Checked in',
			state: 'checked-in',
			hint: 'Guests the crew checked in at arrival'
		},
		{ key: 'locked', label: 'Held back', state: 'locked', hint: 'Locked spots, not bookable' }
	] as const;

	const houseLegend = [
		{ key: 'open', label: 'Empty houses', state: 'open' },
		{ key: 'filling', label: 'Filling', state: 'filling' },
		{ key: 'full', label: 'Full', state: 'full' },
		{ key: 'unconfigured', label: 'Not set up', state: 'unconfigured' }
	] as const;
</script>

<div class="intel-dashboard">
	<div class="ring-box">
		<svg
			class="ring"
			viewBox="0 0 100 100"
			role="img"
			aria-label="{spots.occupied} of {spots.total} spots taken, {spots.free} free, {spots.locked} held back, {spots.special} reserved for special needs"
		>
			<circle class="ring-track" cx="50" cy="50" r={RADIUS} />
			{#each slices as slice (slice.key)}
				{#if slice.value > 0}
					<circle
						class="ring-slice"
						data-state={slice.state}
						cx="50"
						cy="50"
						r={RADIUS}
						stroke-dasharray={slice.dash}
						stroke-dashoffset={slice.offset}
					/>
				{/if}
			{/each}
		</svg>
		<div class="ring-centre">
			<span class="load">
				{#if mounted}<NumberFlow value={load} />{:else}{load}{/if}<span class="unit">%</span>
			</span>
			<span class="load-label">LOAD</span>
		</div>
	</div>

	<div class="tiles">
		{#each tiles as tile (tile.key)}
			<div class="tile state-ring" data-state={tile.state} title={tile.hint}>
				<span class="tile-value">
					{#if mounted}<NumberFlow value={spots[tile.key]} />{:else}{spots[tile.key]}{/if}
				</span>
				<span class="tile-label">{tile.label}</span>
			</div>
		{/each}
	</div>

	<div class="trend">
		<div class="trend-head">
			<span class="trend-title">New bookings · last 7 days</span>
			<span class="trend-peak">peak {peak}</span>
		</div>
		<div
			class="bars"
			role="img"
			aria-label={stats.trend.labels
				.map((label, index) => `${label}: ${stats.trend.values[index]}`)
				.join(', ')}
		>
			{#each stats.trend.values as value, index (index)}
				<div class="bar-col" class:today={index === today}>
					<div class="bar-track">
						<div
							class="bar-fill"
							style:--fill={value / peak}
							data-state={index === today ? 'checked-in' : 'idle'}
						></div>
					</div>
					<span class="bar-value">{value}</span>
					<span class="bar-label">{stats.trend.labels[index]}</span>
				</div>
			{/each}
		</div>
	</div>

	<div class="houses">
		{#each houseLegend as entry (entry.key)}
			<div class="house-state" data-state={entry.state}>
				<span class="state-dot"></span>
				<span class="house-count">
					{#if mounted}<NumberFlow value={houseStates[entry.key]} />{:else}{houseStates[
							entry.key
						]}{/if}
				</span>
				<span class="house-label">{entry.label}</span>
			</div>
		{/each}
	</div>
</div>

<style>
	.intel-dashboard {
		display: grid;
		grid-template-columns: auto 1fr;
		grid-template-areas:
			'ring tiles'
			'trend trend'
			'houses houses';
		gap: 1.25rem 1.75rem;
		align-items: center;
	}

	/* The ring and the tiles stack once the row would squeeze the numbers. */
	@media (max-width: 560px) {
		.intel-dashboard {
			grid-template-columns: 1fr;
			grid-template-areas:
				'ring'
				'tiles'
				'trend'
				'houses';
			justify-items: center;
		}
	}

	.ring-box {
		grid-area: ring;
		position: relative;
		width: 148px;
		height: 148px;
		flex-shrink: 0;
	}
	.ring {
		width: 100%;
		height: 100%;
		transform: rotate(-90deg);
	}
	.ring-track {
		fill: none;
		stroke: #1a1a1a;
		stroke-width: 10;
	}
	.ring-slice {
		fill: none;
		stroke: var(--state);
		stroke-width: 10;
		stroke-linecap: butt;
		/* Only four arcs move, and only when a booking lands. */
		transition:
			stroke-dasharray 0.6s cubic-bezier(0.4, 0, 0.2, 1),
			stroke-dashoffset 0.6s cubic-bezier(0.4, 0, 0.2, 1);
	}
	.ring-centre {
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		pointer-events: none;
	}
	.load {
		display: inline-flex;
		align-items: baseline;
		font-size: 1.6rem;
		font-weight: 900;
		color: #fff;
		font-variant-numeric: tabular-nums;
	}
	.unit {
		font-size: 0.9rem;
		color: #737373;
		margin-left: 0.1em;
	}
	.load-label {
		font-size: 0.5rem;
		color: #737373;
		font-weight: 900;
		letter-spacing: 2px;
	}

	.tiles {
		grid-area: tiles;
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(94px, 1fr));
		gap: 0.6rem;
		width: 100%;
	}
	.tile {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		padding: 0.6rem 0.75rem;
		border-radius: 10px;
		background: var(--state-soft);
		border: 1px solid transparent;
		min-width: 0;
	}
	.tile-value {
		font-size: 1.25rem;
		font-weight: 900;
		color: #fff;
		font-variant-numeric: tabular-nums;
		line-height: 1.1;
	}
	.tile-label {
		font-size: 0.55rem;
		font-weight: 900;
		letter-spacing: 1px;
		text-transform: uppercase;
		color: var(--state);
	}

	.trend {
		grid-area: trend;
		width: 100%;
		min-width: 0;
	}
	.trend-head {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: 1rem;
		margin-bottom: 0.5rem;
	}
	.trend-title,
	.trend-peak {
		font-size: 0.55rem;
		font-weight: 900;
		letter-spacing: 1.5px;
		text-transform: uppercase;
		color: #555;
	}
	.bars {
		display: grid;
		grid-template-columns: repeat(7, 1fr);
		gap: 0.4rem;
		align-items: end;
	}
	.bar-col {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.25rem;
		min-width: 0;
	}
	.bar-track {
		width: 100%;
		height: 56px;
		display: flex;
		align-items: flex-end;
		background: #111;
		border-radius: 4px;
		overflow: hidden;
	}
	.bar-fill {
		width: 100%;
		height: 100%;
		background: var(--state);
		border-radius: 4px 4px 0 0;
		/* scaleY stays on the compositor: no layout, no repaint per frame. */
		transform: scaleY(var(--fill));
		transform-origin: bottom;
		transition: transform 0.6s cubic-bezier(0.4, 0, 0.2, 1);
		opacity: 0.85;
	}
	.bar-col.today .bar-fill {
		opacity: 1;
	}
	.bar-value {
		font-size: 0.7rem;
		font-weight: 900;
		color: #d4d4d4;
		font-variant-numeric: tabular-nums;
	}
	.bar-label {
		font-size: 0.55rem;
		font-weight: 900;
		letter-spacing: 0.5px;
		color: #555;
		text-transform: uppercase;
	}
	.bar-col.today .bar-label,
	.bar-col.today .bar-value {
		color: var(--state-checked-in);
	}

	.houses {
		grid-area: houses;
		display: flex;
		flex-wrap: wrap;
		gap: 0.6rem 1.5rem;
		padding-top: 1rem;
		border-top: 1px solid #1a1a1a;
	}
	.house-state {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		min-width: 0;
	}
	.house-count {
		font-weight: 900;
		color: #fff;
		font-size: 0.9rem;
		font-variant-numeric: tabular-nums;
	}
	.house-label {
		font-size: 0.55rem;
		font-weight: 900;
		color: #737373;
		letter-spacing: 1px;
		text-transform: uppercase;
	}
</style>
