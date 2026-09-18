<script lang="ts">
	import { onMount } from 'svelte';
	import NumberFlow, { NumberFlowGroup } from '@number-flow/svelte';
	import { formatDuration, splitDuration } from '$lib/booking-phase';

	/** Time left in ms (anything below zero shows as zero). */
	export let ms: number;
	/** Without seconds: calmer, for small places. */
	export let seconds = true;

	$: parts = splitDuration(ms);
	// Screen readers get words, updated once a minute, instead of ticking digits.
	$: spoken = formatDuration(ms);

	// Digits roll downwards, the tens of minutes/seconds wrap at 5, of hours at 2.
	const two = { minimumIntegerDigits: 2 };

	// NumberFlow's server-rendered markup doesn't hydrate cleanly: the server
	// (and the first client render) shows plain digits, the rolling ones take
	// over once mounted.
	let mounted = false;
	onMount(() => (mounted = true));
	const pad = (n: number) => String(n).padStart(2, '0');
	$: plain =
		(parts.days > 0 ? `${parts.days}d ` : '') +
		`${pad(parts.hours)}:${pad(parts.minutes)}` +
		(seconds ? `:${pad(parts.seconds)}` : '');
</script>

<span class="countdown-digits">
	<span class="digits" aria-hidden="true">
		{#if !mounted}
			{plain}
		{:else}
			<NumberFlowGroup>
				{#if parts.days > 0}
					<span class="group"
						><NumberFlow value={parts.days} trend={-1} /><span class="unit">d</span></span
					>
				{/if}
				<span class="group">
					<NumberFlow value={parts.hours} trend={-1} format={two} digits={{ 1: { max: 2 } }} />
					<span class="sep">:</span>
					<NumberFlow value={parts.minutes} trend={-1} format={two} digits={{ 1: { max: 5 } }} />
					{#if seconds}
						<span class="sep">:</span>
						<NumberFlow value={parts.seconds} trend={-1} format={two} digits={{ 1: { max: 5 } }} />
					{/if}
				</span>
			</NumberFlowGroup>
		{/if}
	</span>
	<span class="visually-hidden">{spoken}</span>
</span>

<style>
	.countdown-digits {
		display: inline-flex;
		white-space: nowrap;
	}
	.digits {
		display: inline-flex;
		align-items: baseline;
		gap: 0.4em;
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-variant-numeric: tabular-nums;
		line-height: 1;
	}
	.group {
		display: inline-flex;
		align-items: baseline;
	}
	.unit {
		margin-left: 0.08em;
		font-size: 0.8em;
		opacity: 0.75;
	}
	.sep {
		padding: 0 0.04em;
		opacity: 0.55;
	}
	.visually-hidden {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}
</style>
