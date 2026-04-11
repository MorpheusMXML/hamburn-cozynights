<script lang="ts">
	import type { PageData, ActionData } from './$types';
	import { enhance } from '$app/forms';
	import CountdownTimer from '$lib/components/CountdownTimer.svelte';
	export let data: PageData;
	export let form: ActionData;
</script>

<div class="container">
	<header>
		<div class="header-nav">
			<a href="/map" class="back-link">← Map</a>
			{#if !data.isBookingActive && data.bookingUnlockAt}
				<div class="timer-mini">
					<CountdownTimer targetDate={data.bookingUnlockAt} />
				</div>
			{/if}
		</div>
		<h1>{data.house.name}</h1>
		<p class="subtitle">Choose a house for your night</p>
	</header>

	{#if data.userBedId}
		<div class="booking-warning-banner">
			<div class="warning-icon">⚠️</div>
			<div class="warning-content">
				<h3>You already have a booking!</h3>
				<p>
					You have already secured a spot. To choose a new bed, you must release your current
					reservation first.
				</p>
				{#if form?.error}
					<p class="error-msg">{form.error}</p>
				{/if}
				<form method="POST" action="?/unbookBed" use:enhance>
					<button type="submit" class="btn-unbook-banner">Release Current Spot</button>
				</form>
			</div>
		</div>
	{/if}

	<div class="grid">
		{#each data.rooms as room}
			<a href="/room/{room.id}" class="card" class:full={room.freeCount === 0}>
				<div class="card-header">
					<h2>{room.name || 'Room'} #{room.room_number}</h2>
					<span class="badge" class:green={room.freeCount > 0}>
						{room.freeCount > 0 ? `${room.freeCount} free` : 'Full'}
					</span>
				</div>
				<div class="progress-bar">
					<div
						class="fill"
						style="width: {((room.totalCount - room.freeCount) / (room.totalCount || 1)) * 100}%"
					></div>
				</div>
			</a>
		{/each}
	</div>
</div>

<style>
	/* Dunkles Theme */
	:global(body) {
		background: #050505;
		color: #eee;
		font-family: sans-serif;
		margin: 0;
	}
	.container {
		max-width: 800px;
		margin: 0 auto;
		padding: 2rem;
	}

	header {
		margin-bottom: 2rem;
		border-bottom: 1px solid #333;
		padding-bottom: 1rem;
	}

	.header-nav {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 1rem;
	}

	.back-link {
		color: #888;
		text-decoration: none;
	}
	.back-link:hover {
		color: #fff;
	}

	.timer-mini {
		transform: scale(0.7);
		transform-origin: right center;
	}

	h1 {
		margin: 0;
		font-size: 2.5rem;
		font-weight: 900;
		letter-spacing: -1px;
	}
	.subtitle {
		color: #666;
		margin: 0;
	}

	.booking-warning-banner {
		background: rgba(248, 113, 113, 0.1);
		border: 1px solid #f87171;
		border-radius: 12px;
		padding: 1.5rem;
		display: flex;
		gap: 1.5rem;
		align-items: center;
		margin-bottom: 2rem;
	}
	.warning-icon {
		font-size: 2rem;
	}
	.warning-content h3 {
		margin: 0;
		color: #f87171;
	}
	.warning-content p {
		margin: 0.25rem 0 1rem 0;
		color: #888;
	}
	.btn-unbook-banner {
		background: #f87171;
		color: #000;
		border: none;
		padding: 8px 16px;
		border-radius: 6px;
		font-weight: 900;
		cursor: pointer;
	}
	.error-msg {
		color: #f87171;
		font-weight: bold;
		font-size: 0.9rem;
		margin: 0.5rem 0;
	}

	.grid {
		display: grid;
		gap: 1rem;
		grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
	}

	.card {
		background: #1a1a1a;
		border: 1px solid #333;
		border-radius: 8px;
		padding: 1.5rem;
		text-decoration: none;
		color: white;
		display: block;
		transition: all 0.2s;
	}
	.card:hover {
		border-color: #555;
		background: #222;
		transform: translateY(-2px);
	}
	.card.full {
		opacity: 0.6;
	}

	.card-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 1rem;
	}
	.badge {
		background: #333;
		padding: 4px 8px;
		border-radius: 4px;
		font-size: 0.8rem;
	}
	.badge.green {
		color: #4ade80;
		background: rgba(74, 222, 128, 0.1);
	}

	.progress-bar {
		height: 4px;
		background: #333;
		border-radius: 2px;
		overflow: hidden;
	}
	.fill {
		height: 100%;
		background: #4ade80;
	}
	.full .fill {
		background: #ef4444;
	}
</style>
