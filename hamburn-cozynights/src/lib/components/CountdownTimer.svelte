<script lang="ts">
	import { createEventDispatcher, onMount, onDestroy } from 'svelte';
	import { fade } from 'svelte/transition';
	import { EVENT_TIME_ZONE } from '$lib/time';

	export let targetDate: string;
	/** One small line for page headers instead of the big panel. */
	export let compact = false;

	const dispatch = createEventDispatcher<{ elapsed: void }>();

	let timeLeft = '';
	let interval: ReturnType<typeof setInterval> | undefined;
	let elapsedFor = '';

	function calculateTimeLeft() {
		const difference = new Date(targetDate).getTime() - Date.now();

		if (Number.isNaN(difference)) {
			timeLeft = '';
			return;
		}

		if (difference <= 0) {
			timeLeft = 'ANY MOMENT NOW...';
			// Tell the page once, so it can reload its data and open the booking.
			if (elapsedFor !== targetDate) {
				elapsedFor = targetDate;
				dispatch('elapsed');
			}
			return;
		}

		const days = Math.floor(difference / (1000 * 60 * 60 * 24));
		const hours = Math.floor((difference % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
		const minutes = Math.floor((difference % (1000 * 60 * 60)) / (1000 * 60));
		const seconds = Math.floor((difference % (1000 * 60)) / 1000);

		const parts = [];
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

	// Own English names instead of Intl month/weekday names: those differ
	// between ICU versions ("Sep" vs "Sept"), i.e. between server and browser.
	const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
	const MONTHS = [
		'Jan',
		'Feb',
		'Mar',
		'Apr',
		'May',
		'Jun',
		'Jul',
		'Aug',
		'Sep',
		'Oct',
		'Nov',
		'Dec'
	];
	const berlinClock = new Intl.DateTimeFormat('en-GB', {
		timeZone: EVENT_TIME_ZONE,
		hourCycle: 'h23',
		year: 'numeric',
		month: 'numeric',
		day: 'numeric',
		hour: '2-digit',
		minute: '2-digit'
	});

	/** e.g. "Mon, 21 Sep 2026 · 18:00" in the event's timezone. */
	function formatTarget(value: string): string {
		const date = new Date(value);
		if (Number.isNaN(date.getTime())) return '';
		const p: Record<string, number> = {};
		for (const part of berlinClock.formatToParts(date)) {
			if (part.type !== 'literal') p[part.type] = Number(part.value);
		}
		const weekday = WEEKDAYS[new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay()];
		const pad = (n: number) => String(n).padStart(2, '0');
		return `${weekday}, ${p.day} ${MONTHS[p.month - 1]} ${p.year} · ${pad(p.hour)}:${pad(p.minute)}`;
	}

	$: targetLabel = formatTarget(targetDate);
</script>

{#if compact}
	<div class="countdown-compact" title="Booking opens {targetLabel} (Berlin time)">
		<span class="compact-label">Booking opens in</span>
		<span class="compact-timer">{timeLeft || '…'}</span>
	</div>
{:else}
	<div class="countdown-wrapper" in:fade>
		<div class="timezone-badge">BERLIN TIME</div>
		<span class="label">BOOKING OPENS {targetLabel.toUpperCase()}</span>
		<span class="timer" role="timer" aria-live="off">{timeLeft}</span>
	</div>
{/if}

<style>
	.countdown-wrapper {
		display: flex;
		flex-direction: column;
		align-items: center;
		background: rgba(0, 0, 0, 0.85);
		padding: 1.75rem clamp(1rem, 5vw, 2.5rem) 1.25rem;
		border-radius: 16px;
		border: 2px solid #fb923c;
		box-shadow:
			0 0 30px rgba(251, 146, 60, 0.15),
			inset 0 0 15px rgba(251, 146, 60, 0.1);
		min-width: min(240px, 100%);
		max-width: 100%;
		text-align: center;
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
		font-size: 0.65rem;
		font-weight: 900;
		padding: 2px 10px;
		border-radius: 0 0 8px 8px;
		letter-spacing: 1px;
		white-space: nowrap;
	}
	.label {
		font-size: 0.75rem;
		font-weight: 900;
		color: #b0b0b0;
		letter-spacing: 1.5px;
		line-height: 1.5;
		margin-top: 5px;
		margin-bottom: 5px;
	}
	.timer {
		font-size: clamp(1.25rem, 6.5vw, 1.75rem);
		font-weight: 900;
		color: #fb923c;
		font-family: 'JetBrains Mono', monospace;
		text-shadow: 0 0 15px rgba(251, 146, 60, 0.6);
		white-space: nowrap;
	}

	.countdown-compact {
		display: inline-flex;
		flex-wrap: wrap;
		align-items: baseline;
		justify-content: flex-end;
		gap: 0.15rem 0.5rem;
		padding: 0.4rem 0.85rem;
		border-radius: 12px;
		border: 1px solid rgba(251, 146, 60, 0.5);
		background: rgba(0, 0, 0, 0.6);
		max-width: 100%;
	}
	.compact-label {
		font-size: 0.7rem;
		font-weight: 900;
		color: #b0b0b0;
		letter-spacing: 1px;
		text-transform: uppercase;
	}
	.compact-timer {
		font-size: 0.95rem;
		font-weight: 900;
		color: #fb923c;
		font-family: 'JetBrains Mono', monospace;
		white-space: nowrap;
	}
</style>
