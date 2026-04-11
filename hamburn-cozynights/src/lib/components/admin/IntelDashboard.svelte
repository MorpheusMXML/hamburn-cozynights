<script lang="ts">
	import { onMount } from 'svelte';
	import { Chart, registerables } from 'chart.js';
	Chart.register(...registerables);

	export let totalBeds: number;
	export let occupiedBeds: number;
	export let history: { bookingTrend: number[]; trafficTrend: number[]; labels: string[] };

	let occupancyChart: HTMLCanvasElement;
	let trendChart: HTMLCanvasElement;

	onMount(() => {
		// 1. Occupancy Pie Chart (Cookie Diagram)
		new Chart(occupancyChart, {
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

		// 2. Trend Chart (Booking & Traffic)
		new Chart(trendChart, {
			type: 'line',
			data: {
				labels: history.labels,
				datasets: [
					{
						label: 'Bookings',
						data: history.bookingTrend,
						borderColor: '#2dd4bf',
						backgroundColor: 'rgba(45, 212, 191, 0.1)',
						fill: true,
						tension: 0.4,
						pointRadius: 4,
						pointBackgroundColor: '#2dd4bf'
					},
					{
						label: 'Traffic',
						data: history.trafficTrend.map((v) => v / 10), // Scale for visual fit
						borderColor: '#fb923c',
						borderDash: [5, 5],
						tension: 0.4,
						pointRadius: 0
					}
				]
			},
			options: {
				responsive: true,
				maintainAspectRatio: false,
				scales: {
					y: { display: false },
					x: {
						grid: { color: '#1a1a1a' },
						ticks: { color: '#444', font: { size: 10 } }
					}
				},
				plugins: {
					legend: {
						display: true,
						position: 'top',
						align: 'end',
						labels: {
							color: '#666',
							boxWidth: 10,
							font: { size: 10, weight: 'bold' }
						}
					}
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
		<canvas bind:this={trendChart}></canvas>
	</div>
</div>

<style>
	.intel-dashboard {
		display: flex;
		gap: 2rem;
		height: 180px;
		align-items: center;
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
		flex: 1;
		height: 150px;
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
