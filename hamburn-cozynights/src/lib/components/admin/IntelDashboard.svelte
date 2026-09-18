<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { Chart, registerables } from 'chart.js';
	Chart.register(...registerables);

	export let totalBeds: number;
	export let occupiedBeds: number;
	export let history: { bookingTrend: number[]; labels: string[] };

	let occupancyChart: HTMLCanvasElement;
	let trendChart: HTMLCanvasElement;
	let occupancy: Chart | undefined;
	let trend: Chart | undefined;

	// Keep the charts in step with the numbers, e.g. after "clear all bookings".
	$: if (occupancy) {
		occupancy.data.datasets[0].data = [occupiedBeds, Math.max(0, totalBeds - occupiedBeds)];
		occupancy.update();
	}
	$: if (trend) {
		trend.data.labels = history.labels;
		trend.data.datasets[0].data = history.bookingTrend;
		trend.update();
	}

	onDestroy(() => {
		occupancy?.destroy();
		trend?.destroy();
	});

	onMount(() => {
		// 1. Occupancy Pie Chart (Cookie Diagram)
		occupancy = new Chart(occupancyChart, {
			type: 'doughnut',
			data: {
				labels: ['Occupied', 'Free'],
				datasets: [
					{
						data: [occupiedBeds, Math.max(0, totalBeds - occupiedBeds)],
						backgroundColor: ['#f472b6', '#1a1a1a'],
						borderColor: ['#f472b6', '#333'],
						borderWidth: 2,
						hoverOffset: 10
					}
				]
			},
			options: {
				responsive: true,
				plugins: {
					legend: { display: false }
				},
				cutout: '70%'
			}
		});

		// 2. New bookings per day, last 7 days (real order counts)
		trend = new Chart(trendChart, {
			type: 'bar',
			data: {
				labels: history.labels,
				datasets: [
					{
						label: 'New Bookings',
						data: history.bookingTrend,
						backgroundColor: '#2dd4bf',
						borderRadius: 4,
						barPercentage: 0.6
					}
				]
			},
			options: {
				responsive: true,
				maintainAspectRatio: false,
				scales: {
					y: { display: false, beginAtZero: true },
					x: {
						grid: { display: false },
						ticks: { color: '#444', font: { size: 10 } }
					}
				},
				plugins: {
					legend: { display: false }
				}
			}
		});
	});
</script>

<div class="intel-dashboard">
	<div class="chart-container pie-box">
		<canvas bind:this={occupancyChart}></canvas>
		<div class="pie-overlay">
			<span class="percentage"
				>{totalBeds > 0 ? Math.round((occupiedBeds / totalBeds) * 100) : 0}%</span
			>
			<span class="label">LOAD</span>
		</div>
	</div>
	<div class="chart-container line-box">
		<span class="chart-title">New Bookings · Last 7 Days</span>
		<div class="canvas-wrap">
			<canvas bind:this={trendChart}></canvas>
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
	.line-box {
		flex: 1 1 220px;
		min-width: 0;
		height: 150px;
		display: flex;
		flex-direction: column;
	}
	/* Chart.js sizes the canvas from this box; without it the bar chart grows
	   past the card in a column flexbox. */
	.line-box .canvas-wrap {
		position: relative;
		flex: 1;
		min-height: 0;
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
