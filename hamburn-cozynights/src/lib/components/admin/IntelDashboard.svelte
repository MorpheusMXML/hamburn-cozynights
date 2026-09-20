<script lang="ts">
	/**
	 * Two small charts for the Control Center, drawn as inline SVG: an
	 * occupancy ring and the spots booked per day over the last 7 days.
	 * (chart.js did the same and was ~50 KB of the /admin bundle.)
	 */
	export let totalBeds: number;
	export let occupiedBeds: number;
	export let history: { bookingTrend: number[]; labels: string[] };

	// The ring: one circle whose dash pattern is [occupied share, rest] of the
	// circumference, rotated a quarter back so it starts at 12 o'clock.
	const RADIUS = 40;
	const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
	$: share = totalBeds > 0 ? Math.min(1, Math.max(0, occupiedBeds / totalBeds)) : 0;
	$: percent = Math.round(share * 100);
	$: occupiedArc = CIRCUMFERENCE * share;

	// The bars: drawn in a 100-unit-high box that stretches to the card, one
	// slot of 40 units per day (the labels are HTML below, so nothing stretches
	// that shouldn't). The tallest day fills the height.
	const BAR_HEIGHT = 100;
	const SLOT = 40;
	const BAR = 24;
	$: counts = history.bookingTrend;
	$: peak = Math.max(1, ...counts);
	$: bars = counts.map((count, i) => {
		const height = (count / peak) * BAR_HEIGHT;
		return {
			x: i * SLOT + (SLOT - BAR) / 2,
			y: BAR_HEIGHT - height,
			height,
			count,
			label: history.labels[i] ?? ''
		};
	});
	$: trendSummary =
		counts.length > 0
			? counts.map((count, i) => `${history.labels[i] ?? ''}: ${count}`).join(', ')
			: 'no data';
</script>

<div class="intel-dashboard">
	<div class="chart-container pie-box">
		<svg
			class="ring"
			viewBox="0 0 100 100"
			role="img"
			aria-label="Occupancy: {occupiedBeds} of {totalBeds} spots booked ({percent} %)"
		>
			<circle class="ring-free" cx="50" cy="50" r={RADIUS} />
			<circle
				class="ring-occupied"
				cx="50"
				cy="50"
				r={RADIUS}
				stroke-dasharray="{occupiedArc} {CIRCUMFERENCE - occupiedArc}"
				stroke-dashoffset={CIRCUMFERENCE / 4}
			/>
		</svg>
		<div class="pie-overlay" aria-hidden="true">
			<span class="percentage">{percent}%</span>
			<span class="label">LOAD</span>
		</div>
	</div>
	<div class="chart-container line-box">
		<span class="chart-title">New Bookings · Last 7 Days</span>
		<div class="canvas-wrap">
			<svg
				class="bars"
				viewBox="0 0 {Math.max(1, counts.length) * SLOT} {BAR_HEIGHT}"
				preserveAspectRatio="none"
				role="img"
				aria-label="New bookings in the last 7 days: {trendSummary}"
			>
				{#each bars as bar (bar.label + bar.x)}
					<rect class="bar" x={bar.x} y={bar.y} width={BAR} height={bar.height}>
						<title>{bar.label}: {bar.count} booked</title>
					</rect>
				{/each}
			</svg>
		</div>
		<div class="bar-labels" aria-hidden="true">
			{#each bars as bar (bar.label + bar.x)}
				<span>{bar.label}</span>
			{/each}
		</div>
	</div>
</div>

<style>
	.intel-dashboard {
		display: flex;
		flex-wrap: wrap;
		gap: 1rem 2rem;
		min-height: 180px;
		align-items: center;
		justify-content: center;
	}
	.chart-container {
		position: relative;
		background: #050505;
		border-radius: 12px;
		padding: 1rem;
		border: 1px solid #111;
	}
	.pie-box {
		width: 150px;
		height: 150px;
		flex-shrink: 0;
	}
	.ring {
		display: block;
		width: 100%;
		height: 100%;
	}
	.ring-free,
	.ring-occupied {
		fill: none;
		stroke-width: 12;
	}
	.ring-free {
		stroke: #1a1a1a;
	}
	.ring-occupied {
		stroke: #f472b6;
		transition: stroke-dasharray 0.6s ease;
	}
	.line-box {
		flex: 1 1 220px;
		min-width: 0;
		height: 150px;
		display: flex;
		flex-direction: column;
	}
	/* The bars stretch to whatever height the card leaves them. */
	.line-box .canvas-wrap {
		flex: 1;
		min-height: 0;
	}
	.bars {
		display: block;
		width: 100%;
		height: 100%;
	}
	.bar {
		fill: #2dd4bf;
		transition:
			y 0.4s ease,
			height 0.4s ease;
	}
	.bar-labels {
		display: flex;
		margin-top: 0.35rem;
	}
	.bar-labels span {
		flex: 1 1 0;
		min-width: 0;
		text-align: center;
		font-size: 10px;
		color: #444;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.chart-title {
		font-size: 0.6rem;
		font-weight: 900;
		color: #444;
		letter-spacing: 1px;
		text-transform: uppercase;
		margin-bottom: 0.5rem;
	}

	.pie-overlay {
		position: absolute;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		display: flex;
		flex-direction: column;
		align-items: center;
		pointer-events: none;
	}
	.percentage {
		font-size: 1.25rem;
		font-weight: 900;
		color: #f472b6;
		text-shadow: 0 0 10px rgba(244, 114, 182, 0.3);
	}
	.label {
		font-size: 0.5rem;
		color: #444;
		font-weight: 900;
		letter-spacing: 1px;
	}
</style>
