<script lang="ts">
	import { onMount } from 'svelte';
	import NumberFlow from '@number-flow/svelte';
	import type { LiveStats } from '$lib/live-stats';
	import type { BookingPhase } from '$lib/booking-phase';
	import {
		RANGES,
		activityBuckets,
		attentionItems,
		loadOf,
		scopedSpots,
		ticketsWithoutSpot,
		waitingOf,
		type HouseSort,
		type IntelRange
	} from '$lib/intel';
	import { relativeTime } from '$lib/time';
	import IntelAttention from './intel/IntelAttention.svelte';
	import IntelDonut, { type DonutPart } from './intel/IntelDonut.svelte';
	import IntelActivity from './intel/IntelActivity.svelte';
	import IntelHouseTable from './intel/IntelHouseTable.svelte';
	import IntelOps from './intel/IntelOps.svelte';

	/** The live picture: first from the page load, then from the poll. */
	export let stats: LiveStats;
	export let phase: BookingPhase;
	/** The Control Center shows "Needs attention" further up, on its own. */
	export let showAttention = true;

	// NumberFlow's server-rendered markup doesn't hydrate cleanly (same as
	// CountdownDigits): plain digits until mounted, rolling ones afterwards.
	let mounted = false;
	// The chart's "now" moves on its own, so the current hour turns over even
	// while no number changes; a new snapshot brings it up to date at once.
	let now = Date.now();
	onMount(() => {
		mounted = true;
		const timer = setInterval(() => (now = Date.now()), 30_000);
		return () => clearInterval(timer);
	});
	$: if (stats) now = Date.now();

	// The filters. Everything in "Spots & bookings" follows them; the camp-wide
	// blocks (what needs attention, tickets and messages) don't.
	let houseId = '';
	let range: IntelRange = '7d';
	let sort: HouseSort = 'name';
	/** The ring part under the pointer, or the tile the pointer is on. */
	let highlight: DonutPart | null = null;

	// A house that vanished (deleted by another admin) drops the filter.
	$: if (houseId && !stats.houses.some((house) => house.id === houseId)) houseId = '';
	$: house = houseId ? stats.houses.find((entry) => entry.id === houseId) : undefined;
	$: spots = scopedSpots(stats, houseId || null);
	$: load = loadOf(spots);
	$: waiting = waitingOf(spots);
	$: crewTaken = Math.max(0, spots.occupied - spots.booked);
	$: scopeHouses = house ? [house] : stats.houses;
	$: buckets = activityBuckets(scopeHouses, range, now);
	$: lastBooking = house
		? (() => {
				const latest = house.bookedAt[house.bookedAt.length - 1];
				return latest === undefined ? null : new Date(latest * 60000).toISOString();
			})()
		: stats.lastBookingAt;
	$: footnote = lastBooking ? `last booking ${relativeTime(lastBooking, now)}` : 'no booking yet';
	$: attention = attentionItems(stats, phase);
	$: withoutSpot = ticketsWithoutSpot(stats);
	$: sortedHouses = [...stats.houses].sort((a, b) =>
		a.name.localeCompare(b.name, 'en', { numeric: true })
	);

	// A tile or a ring slice sorts the house table by what it counts; a second
	// click goes back to the names.
	const SORT_OF: Record<DonutPart | 'checkedIn', HouseSort> = {
		occupied: 'load',
		free: 'free',
		checkedIn: 'waiting',
		locked: 'locked',
		special: 'special'
	};
	function pick(part: DonutPart | 'checkedIn') {
		sort = sort === SORT_OF[part] ? 'name' : SORT_OF[part];
	}
	$: picked = (Object.entries(SORT_OF).find(([, value]) => value === sort)?.[0] ?? null) as
		DonutPart | 'checkedIn' | null;

	$: tiles = [
		{
			key: 'occupied',
			label: 'Taken',
			state: 'full',
			value: spots.occupied,
			sub: `of ${spots.total} · ${load} %`
		},
		{ key: 'free', label: 'Free', state: 'open', value: spots.free, sub: 'can be booked' },
		{
			key: 'checkedIn',
			label: 'Checked in',
			state: 'checked-in',
			value: spots.checkedIn,
			sub: waiting > 0 ? `${waiting} still to come` : `of ${spots.booked} booked`
		},
		{ key: 'locked', label: 'Held back', state: 'locked', value: spots.locked, sub: 'locked' },
		{
			key: 'special',
			label: '♿ Reserved',
			state: 'special',
			value: spots.special,
			sub: 'for requests'
		}
	] as const;
</script>

<div class="intel-dashboard">
	{#if showAttention}<IntelAttention items={attention} />{/if}

	<section class="intel-block" aria-labelledby="intel-spots-title">
		<header class="intel-block-head">
			<h4 id="intel-spots-title">SPOTS & BOOKINGS</h4>
			<span class="intel-scope">{house ? house.name : 'Whole camp'}</span>
			<a class="intel-bookings-link" href="/admin/bookings{house ? `?house=${house.id}` : ''}"
				>Who booked →</a
			>
			<a class="intel-guests-link" href="/admin/guests{house ? `?house=${house.id}` : ''}"
				>Guests →</a
			>
		</header>

		<div class="intel-filters">
			<label class="intel-field">
				<span>House</span>
				<select bind:value={houseId}>
					<option value="">All houses ({stats.houses.length})</option>
					{#each sortedHouses as entry (entry.id)}
						<option value={entry.id}>{entry.name}</option>
					{/each}
				</select>
			</label>
			<div class="intel-range" role="group" aria-label="Time range of the chart">
				{#each RANGES as option (option.key)}
					<button
						type="button"
						aria-pressed={range === option.key}
						title={option.title}
						on:click={() => (range = option.key)}>{option.label}</button
					>
				{/each}
			</div>
			{#if houseId}
				<button type="button" class="intel-reset" on:click={() => (houseId = '')}>
					✕ Whole camp
				</button>
			{/if}
		</div>

		<div class="tiles">
			{#each tiles as tile (tile.key)}
				<button
					type="button"
					class="tile state-ring"
					class:lit={highlight === tile.key}
					data-state={tile.state}
					aria-pressed={picked === tile.key}
					title="Sort the houses by this"
					on:click={() => pick(tile.key)}
					on:pointerenter={() => (highlight = tile.key === 'checkedIn' ? null : tile.key)}
					on:pointerleave={() => (highlight = null)}
				>
					<span class="tile-label"><span class="tile-key"></span>{tile.label}</span>
					<span class="tile-value">
						{#if mounted}<NumberFlow value={tile.value} />{:else}{tile.value}{/if}
					</span>
					<span class="tile-sub">{tile.sub}</span>
				</button>
			{/each}
		</div>
		{#if spots.deactivated > 0 || crewTaken > 0}
			<p class="intel-footnote">
				{#if crewTaken > 0}{crewTaken} taken without a ticket (marked by the crew).{/if}
				{#if spots.deactivated > 0}{spots.deactivated} switched off, counted nowhere.{/if}
			</p>
		{/if}

		<div class="intel-charts">
			<IntelDonut
				{spots}
				{highlight}
				picked={picked === 'checkedIn' ? null : picked}
				on:pick={(event) => pick(event.detail)}
				on:hover={(event) => (highlight = event.detail)}
			/>
			<IntelActivity {buckets} {range} {footnote} />
		</div>
	</section>

	<IntelHouseTable
		houses={stats.houses}
		houseStates={stats.houseStates}
		selectedId={houseId}
		bind:sort
		on:select={(event) => (houseId = event.detail)}
	/>

	<IntelOps
		ops={stats.ops}
		ticketsWithSpot={stats.ticketsWithSpot}
		ticketsWithoutSpot={withoutSpot}
	/>
</div>

<style>
	.intel-dashboard {
		display: flex;
		flex-direction: column;
		gap: 1.75rem;
		min-width: 0;
	}

	/* The blocks of the panel; the sub-components use the same frame. */
	.intel-dashboard :global(.intel-block) {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		min-width: 0;
		padding-top: 1.25rem;
		border-top: 1px solid #1a1a1a;
	}
	.intel-dashboard :global(.intel-block-head) {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.25rem 1rem;
	}
	.intel-dashboard :global(.intel-block-head h4) {
		margin: 0;
		font-size: 0.65rem;
		font-weight: 900;
		letter-spacing: 2px;
		color: #d4d4d4;
	}
	.intel-bookings-link,
	.intel-guests-link {
		font-size: 0.7rem;
		font-weight: 800;
		color: #2dd4bf;
		text-decoration: none;
		white-space: nowrap;
	}
	.intel-bookings-link {
		margin-left: auto;
	}
	.intel-bookings-link:hover,
	.intel-guests-link:hover {
		text-decoration: underline;
	}
	.intel-dashboard :global(.intel-scope) {
		min-width: 0;
		font-size: 0.65rem;
		font-weight: 700;
		color: #a3a3a3;
		overflow-wrap: anywhere;
	}

	.intel-filters {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.6rem 1rem;
	}
	.intel-field {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex: 0 1 20rem;
		min-width: 0;
	}
	.intel-field span {
		font-size: 0.6rem;
		font-weight: 900;
		letter-spacing: 1px;
		text-transform: uppercase;
		color: #a3a3a3;
	}
	.intel-field select {
		flex: 1;
		min-width: 0;
		min-height: 40px;
		box-sizing: border-box;
		background: #111;
		border: 1px solid #262626;
		border-radius: 8px;
		color: #fff;
		font: inherit;
		font-size: 0.8rem;
		padding: 0.4rem 0.7rem;
	}
	.intel-field select:focus {
		outline: none;
		border-color: #2dd4bf;
	}
	.intel-range {
		display: inline-flex;
		border: 1px solid #262626;
		border-radius: 8px;
		overflow: hidden;
	}
	.intel-range button {
		min-height: 40px;
		padding: 0 0.85rem;
		background: transparent;
		border: none;
		color: #a3a3a3;
		font: inherit;
		font-size: 0.7rem;
		font-weight: 800;
		cursor: pointer;
		white-space: nowrap;
	}
	.intel-range button + button {
		border-left: 1px solid #262626;
	}
	.intel-range button[aria-pressed='true'] {
		background: rgba(45, 212, 191, 0.15);
		color: #2dd4bf;
	}
	.intel-reset {
		min-height: 40px;
		padding: 0 0.85rem;
		border-radius: 8px;
		border: 1px solid #2dd4bf;
		background: transparent;
		color: #2dd4bf;
		font: inherit;
		font-size: 0.7rem;
		font-weight: 800;
		cursor: pointer;
		white-space: nowrap;
	}

	/* Five in a row on a laptop, two per row on a phone. */
	.tiles {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 104px), 1fr));
		gap: 0.6rem;
	}
	.tile {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.2rem;
		min-width: 0;
		padding: 0.6rem 0.75rem;
		border-radius: 10px;
		background: var(--state-soft);
		border: 1px solid transparent;
		font: inherit;
		text-align: left;
		cursor: pointer;
	}
	.tile[aria-pressed='true'],
	.tile.lit {
		background: color-mix(in srgb, var(--state) 22%, transparent);
	}
	.tile-label {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		font-size: 0.55rem;
		font-weight: 900;
		letter-spacing: 1px;
		text-transform: uppercase;
		color: #d4d4d4;
	}
	/* The colour sits in the key, the words stay readable. */
	.tile-key {
		width: 8px;
		height: 8px;
		border-radius: 2px;
		background: var(--state);
		flex-shrink: 0;
	}
	.tile-value {
		font-size: 1.35rem;
		font-weight: 900;
		color: #fff;
		line-height: 1.1;
	}
	.tile-sub {
		font-size: 0.6rem;
		font-weight: 700;
		color: #a3a3a3;
	}
	.intel-footnote {
		margin: -0.25rem 0 0;
		font-size: 0.65rem;
		font-weight: 700;
		color: #a3a3a3;
	}

	.intel-charts {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr);
		gap: 1.5rem 2rem;
		align-items: center;
	}
	/* The ring above the chart once the row would squeeze the bars. */
	@media (max-width: 640px) {
		.intel-charts {
			grid-template-columns: minmax(0, 1fr);
			justify-items: center;
		}
		.intel-charts > :global(*) {
			width: 100%;
		}
		.intel-charts > :global(.donut-box) {
			width: 148px;
		}
	}
</style>
