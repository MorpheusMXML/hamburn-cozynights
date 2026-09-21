<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import type { HouseLiveStats } from '$lib/live-stats';
	import { houseStateLabel, type HouseState } from '$lib/occupancy';
	import { HOUSE_SORTS, houseRows, type HouseSort, type HouseStateFilter } from '$lib/intel';

	export let houses: HouseLiveStats[];
	export let houseStates: Record<HouseState, number>;
	/** The house the numbers above are narrowed to, or '' for the whole camp. */
	export let selectedId = '';
	export let sort: HouseSort = 'name';

	const dispatch = createEventDispatcher<{ select: string }>();

	/** Rows shown before "Show all": a camp of sixty houses stays readable. */
	const LIMIT = 10;

	let search = '';
	let state: HouseStateFilter = 'all';
	let expanded = false;

	const STATES: { key: HouseStateFilter; label: string }[] = [
		{ key: 'all', label: 'All' },
		{ key: 'open', label: 'Empty' },
		{ key: 'filling', label: 'Filling' },
		{ key: 'full', label: 'Full' },
		{ key: 'unconfigured', label: 'Not set up' }
	];

	$: rows = houseRows(houses, { search, state, sort });
	$: shown = expanded ? rows : rows.slice(0, LIMIT);
	const countOf = (key: HouseStateFilter, all: number, states: Record<HouseState, number>) =>
		key === 'all' ? all : states[key];
</script>

<section class="intel-block" aria-labelledby="intel-houses-title">
	<header class="intel-block-head">
		<h4 id="intel-houses-title">HOUSES</h4>
		<span class="intel-scope">
			{rows.length === houses.length ? `${houses.length}` : `${rows.length} of ${houses.length}`}
			{houses.length === 1 ? 'house' : 'houses'} · pick one to see its numbers above
		</span>
	</header>

	<div class="houses-toolbar">
		<input
			class="houses-search"
			type="search"
			placeholder="Find a house"
			aria-label="Find a house by name"
			bind:value={search}
		/>
		<label class="houses-sort">
			<span>Sort</span>
			<select bind:value={sort}>
				{#each HOUSE_SORTS as option (option.key)}
					<option value={option.key}>{option.label}</option>
				{/each}
			</select>
		</label>
		<div class="houses-states" role="group" aria-label="Show only houses that are">
			{#each STATES as option (option.key)}
				<button
					type="button"
					class="houses-state"
					data-state={option.key === 'all' ? 'idle' : option.key}
					aria-pressed={state === option.key}
					on:click={() => (state = option.key)}
				>
					{#if option.key !== 'all'}<span class="state-dot"></span>{/if}
					{option.label} <strong>{countOf(option.key, houses.length, houseStates)}</strong>
				</button>
			{/each}
		</div>
	</div>

	{#if rows.length === 0}
		<p class="houses-empty">
			{houses.length === 0 ? 'No houses yet.' : 'No house matches.'}
			{#if search || state !== 'all'}
				<button
					type="button"
					class="houses-link"
					on:click={() => {
						search = '';
						state = 'all';
					}}>Show all houses</button
				>
			{/if}
		</p>
	{:else}
		<div class="houses-list" role="table" aria-label="Houses and their spots">
			<div class="houses-row houses-head" role="row">
				<span role="columnheader">House</span>
				<span role="columnheader">Taken</span>
				<span role="columnheader">Free</span>
				<span role="columnheader">Checked in</span>
				<span role="columnheader">Held back</span>
				<span role="columnheader">♿</span>
				<span role="columnheader"><span class="sr-note">Rooms</span></span>
			</div>
			{#each shown as row (row.house.id)}
				{@const house = row.house}
				{@const picked = house.id === selectedId}
				<div class="houses-row" class:picked role="row" data-state={house.state}>
					<span class="houses-name" role="cell">
						<button
							type="button"
							class="houses-pick"
							aria-pressed={picked}
							title={picked ? 'Show the whole camp again' : 'Show the numbers of this house'}
							on:click={() => dispatch('select', picked ? '' : house.id)}>{house.name}</button
						>
						<span class="state-chip" data-state={house.state}
							>{houseStateLabel(house.state, house.free)}</span
						>
					</span>
					<span class="houses-cell houses-taken" role="cell">
						<span class="houses-label">Taken</span>
						<span class="houses-num">{house.occupied}<small> / {house.total}</small></span>
						<span class="houses-bar" aria-hidden="true">
							<span style:width="{row.load}%"></span>
						</span>
					</span>
					<span class="houses-cell" role="cell">
						<span class="houses-label">Free</span>
						<span class="houses-num">{house.free}</span>
					</span>
					<span class="houses-cell" role="cell">
						<span class="houses-label">Checked in</span>
						<span class="houses-num">{house.checkedIn}<small> / {house.booked}</small></span>
					</span>
					<span class="houses-cell" role="cell">
						<span class="houses-label">Held back</span>
						<span class="houses-num">{house.locked}</span>
					</span>
					<span class="houses-cell" role="cell">
						<span class="houses-label">♿ Reserved</span>
						<span class="houses-num">{house.special}</span>
					</span>
					<span class="houses-cell houses-open" role="cell">
						<a href="/admin/house/{house.id}" aria-label="Rooms of {house.name}">Rooms →</a>
					</span>
				</div>
			{/each}
		</div>
		{#if rows.length > LIMIT}
			<button type="button" class="houses-more" on:click={() => (expanded = !expanded)}>
				{expanded ? `Show the first ${LIMIT} only` : `Show all ${rows.length} houses`}
			</button>
		{/if}
	{/if}
</section>

<style>
	.houses-toolbar {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 0.6rem 0.75rem;
		align-items: center;
	}
	.houses-states {
		grid-column: 1 / -1;
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
	}
	.houses-search,
	.houses-sort select {
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
	.houses-search {
		width: 100%;
		min-width: 0;
	}
	.houses-search:focus,
	.houses-sort select:focus {
		outline: none;
		border-color: #2dd4bf;
	}
	.houses-sort {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		min-width: 0;
	}
	.houses-sort span {
		font-size: 0.6rem;
		font-weight: 900;
		letter-spacing: 1px;
		text-transform: uppercase;
		color: #a3a3a3;
	}
	.houses-sort select {
		min-width: 0;
		max-width: 14rem;
	}
	.houses-state {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		min-height: 32px;
		padding: 0.2rem 0.65rem;
		border-radius: 999px;
		border: 1px solid #262626;
		background: transparent;
		color: #a3a3a3;
		font: inherit;
		font-size: 0.65rem;
		font-weight: 800;
		cursor: pointer;
	}
	.houses-state strong {
		color: #fff;
		font-variant-numeric: tabular-nums;
	}
	.houses-state[aria-pressed='true'] {
		border-color: var(--state);
		background: var(--state-soft);
		color: #fff;
	}
	.houses-state .state-dot {
		width: 7px;
		height: 7px;
		box-shadow: none;
	}

	.houses-list {
		display: flex;
		flex-direction: column;
	}
	/* Every row is its own grid: fixed tracks keep the columns in line. */
	.houses-row {
		display: grid;
		grid-template-columns:
			minmax(10rem, 2.4fr) minmax(6.5rem, 1.2fr) repeat(4, minmax(3.5rem, 0.8fr))
			4.5rem;
		gap: 0.75rem;
		align-items: center;
		padding: 0.55rem 0.5rem;
		border-bottom: 1px solid #1a1a1a;
	}
	.houses-head {
		padding-top: 0;
		font-size: 0.55rem;
		font-weight: 900;
		letter-spacing: 1px;
		text-transform: uppercase;
		color: #737373;
	}
	.houses-row.picked {
		background: rgba(45, 212, 191, 0.06);
		box-shadow: inset 3px 0 0 #2dd4bf;
	}
	.houses-name {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.3rem 0.6rem;
		min-width: 0;
	}
	.houses-pick {
		min-height: 32px;
		min-width: 0;
		padding: 0;
		background: none;
		border: none;
		color: #fff;
		font: inherit;
		font-size: 0.85rem;
		font-weight: 800;
		text-align: left;
		overflow-wrap: anywhere;
		cursor: pointer;
	}
	.houses-pick:hover,
	.houses-pick[aria-pressed='true'] {
		color: #2dd4bf;
	}
	.houses-cell {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		min-width: 0;
	}
	.houses-num {
		font-size: 0.85rem;
		font-weight: 800;
		color: #fff;
		font-variant-numeric: tabular-nums;
	}
	.houses-num small {
		font-size: 0.7rem;
		color: #737373;
		font-weight: 700;
	}
	/* The column headers label the cells on a wide screen; on a phone each cell
	   carries its own label. */
	.houses-label {
		display: none;
		font-size: 0.5rem;
		font-weight: 900;
		letter-spacing: 1px;
		text-transform: uppercase;
		color: #737373;
	}
	.houses-bar {
		height: 4px;
		border-radius: 2px;
		background: #1a1a1a;
		overflow: hidden;
	}
	.houses-bar span {
		display: block;
		height: 100%;
		background: var(--state);
		transition: width 0.6s ease-out;
	}
	.houses-open a {
		display: inline-flex;
		align-items: center;
		min-height: 32px;
		color: #2dd4bf;
		font-size: 0.7rem;
		font-weight: 800;
		text-decoration: none;
		white-space: nowrap;
	}
	.houses-open a:hover {
		text-decoration: underline;
	}
	.sr-note {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip: rect(0 0 0 0);
		white-space: nowrap;
	}
	.houses-empty {
		margin: 0;
		font-size: 0.75rem;
		color: #a3a3a3;
	}
	.houses-link,
	.houses-more {
		min-height: 32px;
		padding: 0;
		background: none;
		border: none;
		color: #2dd4bf;
		font: inherit;
		font-size: 0.7rem;
		font-weight: 800;
		text-decoration: underline;
		cursor: pointer;
	}
	.houses-more {
		align-self: flex-start;
	}

	/* Below this the seven columns don't fit: each house becomes a small card,
	   the name on top, the numbers in a grid of labelled cells. */
	@media (max-width: 820px) {
		.houses-toolbar {
			grid-template-columns: minmax(0, 1fr);
		}
		.houses-sort select {
			flex: 1;
			max-width: none;
		}
		.houses-head {
			display: none;
		}
		.houses-row {
			grid-template-columns: repeat(3, minmax(0, 1fr));
			gap: 0.6rem 0.75rem;
			padding: 0.75rem 0.5rem;
			align-items: start;
		}
		.houses-name {
			grid-column: 1 / -1;
		}
		/* Tight enough that "Checked in" stays on one line in a third of a phone. */
		.houses-label {
			display: block;
			letter-spacing: 0.3px;
		}
		.houses-open {
			justify-content: flex-end;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.houses-bar span {
			transition: none;
		}
	}
</style>
