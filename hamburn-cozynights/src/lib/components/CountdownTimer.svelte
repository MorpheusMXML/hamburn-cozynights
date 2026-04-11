<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { fade } from 'svelte/transition';

	export let targetDate: string;

	let timeLeft = '';
	let interval: any;

	function calculateTimeLeft() {
		const now = new Date().getTime();
		const target = new Date(targetDate).getTime();
		const difference = target - now;

		if (difference <= 0) {
			timeLeft = 'ANY MOMENT NOW...';
			return;
		}

		const days = Math.floor(difference / (1000 * 60 * 60 * 24));
		const hours = Math.floor((difference % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
		const minutes = Math.floor((difference % (1000 * 60 * 60)) / (1000 * 60));
		const seconds = Math.floor((difference % (1000 * 60)) / 1000);

		let parts = [];
		if (days > 0) parts.push(`${days}d`);
		if (hours > 0 || days > 0) parts.push(`${hours}h`);
		parts.push(`${minutes}m`);
		parts.push(`${seconds}s`);

		timeLeft = parts.join(' ');
	}

	onMount(() => {
		calculateTimeLeft();
		interval = setInterval(calculateTimeLeft, 1000);
	});

	onDestroy(() => {
		if (interval) clearInterval(interval);
	});

	$: targetTimeStr = new Date(targetDate).toLocaleTimeString('de-DE', {
		timeZone: 'Europe/Berlin',
		hour: '2-digit',
		minute: '2-digit'
	});
	$: targetDateStr = new Date(targetDate).toLocaleDateString('de-DE', {
		timeZone: 'Europe/Berlin',
		day: '2-digit',
		month: '2-digit',
		year: 'numeric'
	});
</script>

<div class="countdown-wrapper" in:fade>
	<div class="timezone-badge">GERMANY / BERLIN TIME</div>
	<span class="label">IGNITION AT {targetDateStr} - {targetTimeStr} (CET/CEST):</span>
	<span class="timer">{timeLeft}</span>
</div>

<style>
	.countdown-wrapper {
		display: flex;
		flex-direction: column;
		align-items: center;
		background: rgba(0, 0, 0, 0.85);
		padding: 1.5rem 2.5rem;
		border-radius: 16px;
		border: 2px solid #fb923c;
		box-shadow:
			0 0 30px rgba(251, 146, 60, 0.15),
			inset 0 0 15px rgba(251, 146, 60, 0.1);
		min-width: 240px;
		position: relative;
		overflow: hidden;
	}
	.timezone-badge {
		position: absolute;
		top: 0;
		left: 50%;
		transform: translateX(-50%);
		background: #fb923c;
		color: #000;
		font-size: 0.5rem;
		font-weight: 900;
		padding: 2px 8px;
		border-radius: 0 0 8px 8px;
		letter-spacing: 1px;
	}
	.label {
		font-size: 0.65rem;
		font-weight: 900;
		color: #888;
		letter-spacing: 1.5px;
		margin-top: 5px;
		margin-bottom: 5px;
	}
	.timer {
		font-size: 1.75rem;
		font-weight: 900;
		color: #fb923c;
		font-family: 'JetBrains Mono', monospace;
		text-shadow: 0 0 15px rgba(251, 146, 60, 0.6);
	}
</style>
