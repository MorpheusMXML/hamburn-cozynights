<script lang="ts">
	import type { ActivityBucket, IntelRange } from '$lib/intel';

	export let buckets: ActivityBucket[];
	export let range: IntelRange;
	/** "Last booking 4 min ago" and the like, appended to the summary line. */
	export let footnote = '';

	// Legend buttons switch a series off and on; one always stays.
	let showBooked = true;
	let showChecked = true;
	function toggle(series: 'booked' | 'checked') {
		if (series === 'booked') showBooked = !showBooked || !showChecked;
		else showChecked = !showChecked || !showBooked;
	}

	/** The bar under the pointer or the keyboard; null shows the summary. */
	let active: number | null = null;
	let showTable = false;

	$: totals = buckets.reduce(
		(sum, bucket) => ({
			booked: sum.booked + bucket.booked,
			checkedIn: sum.checkedIn + bucket.checkedIn
		}),
		{ booked: 0, checkedIn: 0 }
	);
	// Bars scale to the busiest visible bucket, never to zero: a quiet range
	// still shows its baseline instead of an empty box.
	$: peak = Math.max(
		1,
		...buckets.map((bucket) =>
			Math.max(showBooked ? bucket.booked : 0, showChecked ? bucket.checkedIn : 0)
		)
	);
	$: if (active !== null && active >= buckets.length) active = null;

	// A label under every bar would collide on a phone: every nth, counted from
	// the current bar backwards so "now" is always named.
	$: step = range === '7d' ? 1 : Math.max(1, Math.ceil(buckets.length / 6));
	$: last = buckets.length - 1;
	/** Whether bar `index` gets its label, with `step` and `last` passed in (so the template reruns). */
	const labelled = (index: number, every: number, lastIndex: number) =>
		(lastIndex - index) % every === 0;
	$: unit = buckets[0]?.unit ?? 'day';

	const spanLabel: Record<IntelRange, string> = {
		'24h': 'Last 24 h',
		'7d': 'Last 7 days',
		all: 'Since the first booking'
	};

	// The series switches are arguments, not read inside: `$:` only reruns for
	// what it sees, and a hidden series must leave the sentence at once.
	function counts(booked: number, checkedIn: number, withBooked: boolean, withChecked: boolean) {
		const parts: string[] = [];
		if (withBooked) parts.push(`${booked} booking${booked === 1 ? '' : 's'}`);
		if (withChecked) parts.push(`${checkedIn} check-in${checkedIn === 1 ? '' : 's'}`);
		return parts.join(' · ');
	}

	$: shownBucket = active !== null ? buckets[active] : undefined;
	$: readout = shownBucket
		? `${shownBucket.detail}: ${counts(shownBucket.booked, shownBucket.checkedIn, showBooked, showChecked)}`
		: `${spanLabel[range]}: ${counts(totals.booked, totals.checkedIn, showBooked, showChecked)}${footnote ? ` · ${footnote}` : ''}`;

	function onKeydown(event: KeyboardEvent) {
		const moves: Record<string, number> = {
			ArrowLeft: -1,
			ArrowRight: 1,
			Home: -Infinity,
			End: Infinity
		};
		if (event.key === 'Escape') {
			active = null;
			return;
		}
		if (!(event.key in moves)) return;
		event.preventDefault();
		const from = active ?? last;
		active = Math.min(last, Math.max(0, from + moves[event.key]));
	}
</script>

<figure class="intel-activity">
	<figcaption class="activity-head">
		<span class="activity-title">Bookings & check-ins</span>
		<span class="activity-legend">
			<button
				type="button"
				class="legend-toggle"
				data-state="full"
				aria-pressed={showBooked}
				on:click={() => toggle('booked')}
				title="Show or hide the bookings"
			>
				<span class="legend-swatch"></span>Bookings <strong>{totals.booked}</strong>
			</button>
			<button
				type="button"
				class="legend-toggle"
				data-state="checked-in"
				aria-pressed={showChecked}
				on:click={() => toggle('checked')}
				title="Show or hide the check-ins"
			>
				<span class="legend-swatch"></span>Check-ins <strong>{totals.checkedIn}</strong>
			</button>
		</span>
	</figcaption>

	<p class="activity-readout">{readout}</p>

	<!-- One tab stop for the whole chart: a slider over the bars, so the arrow
	     keys walk them and a screen reader reads each one out. -->
	<div
		class="activity-plot"
		role="slider"
		tabindex="0"
		aria-label="{spanLabel[range]}, one bar per {unit}"
		aria-valuemin={0}
		aria-valuemax={last}
		aria-valuenow={active ?? last}
		aria-valuetext={readout}
		on:keydown={onKeydown}
		on:focus={() => (active = active ?? last)}
		on:blur={() => (active = null)}
		on:pointerleave={() => (active = null)}
	>
		<span class="activity-peak">{peak}</span>
		<div class="activity-bars" style:--count={buckets.length}>
			{#each buckets as bucket, index (index)}
				<!-- svelte-ignore a11y-no-static-element-interactions -->
				<div
					class="activity-col"
					class:current={bucket.current}
					class:active={index === active}
					on:pointerenter={() => (active = index)}
					on:pointerdown={() => (active = index)}
				>
					{#if showBooked}
						<span class="activity-bar" data-state="full" style:--fill={bucket.booked / peak}></span>
					{/if}
					{#if showChecked}
						<span
							class="activity-bar"
							data-state="checked-in"
							style:--fill={bucket.checkedIn / peak}
						></span>
					{/if}
				</div>
			{/each}
		</div>
		<div class="activity-axis" aria-hidden="true">
			{#each buckets as bucket, index (index)}
				{#if labelled(index, step, last)}
					<span
						class="activity-tick"
						class:end={index === last}
						class:current={bucket.current}
						style:--at={(index + 0.5) / buckets.length}>{bucket.label}</span
					>
				{/if}
			{/each}
		</div>
	</div>

	<button type="button" class="activity-table-toggle" on:click={() => (showTable = !showTable)}>
		{showTable ? 'Hide the numbers' : 'Show the numbers as a table'}
	</button>
	{#if showTable}
		<table class="activity-data">
			<thead>
				<tr>
					<th scope="col">When</th>
					<th scope="col">Bookings</th>
					<th scope="col">Check-ins</th>
				</tr>
			</thead>
			<tbody>
				{#each buckets as bucket, index (index)}
					<tr class:current={bucket.current}>
						<th scope="row">{bucket.detail}</th>
						<td>{bucket.booked}</td>
						<td>{bucket.checkedIn}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	{/if}
</figure>

<style>
	.intel-activity {
		margin: 0;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.activity-head {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		align-items: center;
		gap: 0.5rem 1rem;
	}
	.activity-title {
		font-size: 0.6rem;
		font-weight: 900;
		letter-spacing: 1.5px;
		text-transform: uppercase;
		color: #a3a3a3;
	}
	.activity-legend {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
	}
	.legend-toggle {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		min-height: 32px;
		padding: 0.2rem 0.6rem;
		border-radius: 999px;
		border: 1px solid #262626;
		background: transparent;
		color: #d4d4d4;
		font: inherit;
		font-size: 0.65rem;
		font-weight: 800;
		cursor: pointer;
	}
	.legend-toggle strong {
		color: #fff;
		font-variant-numeric: tabular-nums;
	}
	.legend-toggle[aria-pressed='false'] {
		color: #737373;
		border-style: dashed;
	}
	.legend-toggle[aria-pressed='false'] .legend-swatch {
		background: transparent;
	}
	.legend-swatch {
		width: 10px;
		height: 10px;
		border-radius: 3px;
		border: 1px solid var(--state);
		background: var(--state);
	}

	.activity-readout {
		margin: 0;
		min-height: 1.4em;
		font-size: 0.7rem;
		font-weight: 700;
		color: #d4d4d4;
		line-height: 1.4;
	}

	.activity-plot {
		position: relative;
		padding-top: 0.9rem;
		border-radius: 8px;
		outline: none;
	}
	.activity-plot:focus-visible {
		box-shadow: 0 0 0 2px #2dd4bf;
	}
	/* The peak, as the one tick of the value axis. */
	.activity-peak {
		position: absolute;
		top: 0;
		left: 0;
		font-size: 0.55rem;
		font-weight: 800;
		color: #737373;
		font-variant-numeric: tabular-nums;
		line-height: 1;
	}
	.activity-bars {
		display: grid;
		grid-template-columns: repeat(var(--count), minmax(0, 1fr));
		height: 72px;
		border-top: 1px solid #1a1a1a;
		border-bottom: 1px solid #333;
	}
	.activity-col {
		display: flex;
		align-items: flex-end;
		justify-content: center;
		gap: 1px;
		min-width: 0;
		padding: 0 1px;
		cursor: crosshair;
	}
	.activity-col.active {
		background: rgba(255, 255, 255, 0.06);
	}
	/* At most 20 px wide: thin bars, the rest of the column is air. */
	.activity-bar {
		flex: 0 1 20px;
		min-width: 1px;
		height: 100%;
		background: var(--state);
		border-radius: 3px 3px 0 0;
		/* scaleY stays on the compositor: no layout, no repaint per frame. */
		transform: scaleY(var(--fill));
		transform-origin: bottom;
		transition: transform 0.6s cubic-bezier(0.4, 0, 0.2, 1);
		opacity: 0.8;
	}
	.activity-col.current .activity-bar,
	.activity-col.active .activity-bar {
		opacity: 1;
	}

	.activity-axis {
		position: relative;
		height: 1.1rem;
	}
	.activity-tick {
		position: absolute;
		top: 0.3rem;
		left: calc(var(--at) * 100%);
		transform: translateX(-50%);
		font-size: 0.55rem;
		font-weight: 800;
		line-height: 1;
		white-space: nowrap;
		color: #737373;
		font-variant-numeric: tabular-nums;
	}
	.activity-tick.end {
		left: auto;
		right: 0;
		transform: none;
	}
	.activity-tick.current {
		color: #d4d4d4;
	}

	.activity-table-toggle {
		align-self: flex-start;
		min-height: 32px;
		padding: 0;
		background: none;
		border: none;
		color: #2dd4bf;
		font: inherit;
		font-size: 0.65rem;
		font-weight: 800;
		text-decoration: underline;
		cursor: pointer;
	}
	.activity-data {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.7rem;
	}
	.activity-data th,
	.activity-data td {
		padding: 0.3rem 0.4rem;
		border-bottom: 1px solid #1a1a1a;
		text-align: right;
		font-variant-numeric: tabular-nums;
		color: #d4d4d4;
	}
	.activity-data th[scope='row'],
	.activity-data thead th:first-child {
		text-align: left;
		font-weight: 700;
	}
	.activity-data thead th {
		font-size: 0.55rem;
		letter-spacing: 1px;
		text-transform: uppercase;
		color: #737373;
	}
	.activity-data tr.current th,
	.activity-data tr.current td {
		color: #fff;
	}

	@media (prefers-reduced-motion: reduce) {
		.activity-bar {
			transition: none;
		}
	}
</style>
