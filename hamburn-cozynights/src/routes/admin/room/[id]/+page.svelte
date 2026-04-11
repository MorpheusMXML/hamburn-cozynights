<script lang="ts">
	import type { PageData } from './$types';
	import AddBedForm from '$lib/components/admin/AddBedForm.svelte';
	import { fade, fly } from 'svelte/transition';
	import { invalidateAll } from '$app/navigation';
	import { enhance } from '$app/forms';

	export let data: PageData;
	// isVerified from layout
	$: ({ room, beds, isVerified, isBookingActive } = data);
	$: house = room.expand?.house;

	function handleAction(bedId: string, actionType: 'delete' | 'toggle') {
		if (isBookingActive) {
			alert('🔒 LOCKDOWN ACTIVE: Spots are locked during Live Booking.');
			return;
		}
		return async ({ result, update }: { result: any; update: any }) => {
			if (actionType === 'delete' && result.type === 'success') {
				const card = document.querySelector(`.bed-card:has([value="${bedId}"])`);
				if (card) card.classList.add('disintegrating');
				await new Promise((r) => setTimeout(r, 550));
			}
			await update();
			await invalidateAll();
		};
	}
</script>

<div class="dashboard-container">
	<div class="header-row" in:fly={{ y: -20, duration: 500 }}>
		<nav class="breadcrumbs">
			<a href="/admin">Control Center</a>
			<span class="sep">/</span>
			{#if house}<a href="/admin/house/{house.id}">{house.name}</a> <span class="sep">/</span>{/if}
			<span class="current">Room {room.room_number}</span>
		</nav>

		<h1>
			<span class="room-icon">🛌</span>
			{room.name || `Room ${room.room_number}`}
			<span class="badge turquoise">#{room.room_number}</span>
		</h1>
	</div>

	<div class="content-split">
		<aside class="info-column" in:fly={{ x: -20, duration: 500, delay: 200 }}>
			<div class="status-card turquoise">
				<h3>LOGISTICS 📊</h3>
				<div class="big-number">
					{beds.filter((b) => b.enabled !== false && b.occupied).length}
					<span class="divider">/</span>
					{beds.filter((b) => b.enabled !== false).length}
				</div>
				<p class="label">CLAIMED SPOTS</p>
				<div class="capacity-info">
					Total Capacity: {beds.length} ({(
						(beds.filter((b) => b.enabled !== false).length / (beds.length || 1)) *
						100
					).toFixed(0)}% ACTIVE)
				</div>
			</div>

			{#if isVerified}
				<section class="form-panel orange" class:disabled={isBookingActive}>
					<header class="panel-header">
						<span class="laser-dot orange"></span>
						<h3>ADD SPOT ➕</h3>
					</header>
					{#if isBookingActive}
						<div class="lockdown-notice">🔒 LOCKED</div>
					{/if}
					<p class="hint">Define spot label (e.g. "Upper Deck")</p>
					<AddBedForm roomId={room.id} disabled={isBookingActive} />
				</section>
			{/if}
		</aside>

		<main class="beds-column" in:fade={{ delay: 400 }}>
			<header class="column-header">
				<span class="laser-dot turquoise"></span>
				<h3 class="column-title">ROOM CAPACITY 🛌</h3>
			</header>

			<div class="beds-grid">
				{#each beds as bed (bed.id)}
					<div
						class="bed-card"
						class:occupied={bed.occupied}
						class:disabled={isBookingActive}
						class:inactive={bed.enabled === false}
						in:fade
					>
						<div class="bed-glow" class:red={bed.occupied} class:gray={bed.enabled === false}></div>
						<div class="bed-icon">
							{#if bed.enabled === false}
								⚪️
							{:else if bed.occupied}
								🔴
							{:else}
								🟢
							{/if}
						</div>
						<div class="bed-info">
							<span class="bed-label">{bed.label || 'Unnamed Spot'}</span>
							<span class="bed-status">
								{#if bed.is_locked}
									LOCKED 🔒
								{:else if bed.enabled === false}
									INACTIVE 🧊
								{:else}
									{bed.occupied ? 'CLAIMED 👥' : 'VACANT ✨'}
								{/if}
							</span>
						</div>

						<div class="bed-actions">
							{#if isVerified}
								<form
									action="?/toggleLocked"
									method="POST"
									use:enhance={() => handleAction(bed.id, 'toggle')}
								>
									<input type="hidden" name="id" value={bed.id} />
									<input type="hidden" name="is_locked" value={bed.is_locked?.toString()} />
									<button
										class="btn-icon"
										class:orange={bed.is_locked}
										title={bed.is_locked ? 'Unlock' : 'Lock (Block Guests)'}
									>
										{bed.is_locked ? '🔓' : '🔒'}
									</button>
								</form>
							{/if}

							<form
								action="?/toggleEnabled"
								method="POST"
								use:enhance={() => handleAction(bed.id, 'toggle')}
							>
								<input type="hidden" name="id" value={bed.id} />
								<input type="hidden" name="enabled" value={bed.enabled !== false} />
								<button
									class="btn-icon"
									class:orange={bed.enabled === false}
									class:disabled={isBookingActive}
									disabled={isBookingActive}
									title={bed.enabled === false ? 'Activate' : 'Deactivate'}
								>
									{bed.enabled === false ? '⚡️' : '❄️'}
								</button>
							</form>

							<form
								action="?/toggleOccupied"
								method="POST"
								use:enhance={() => handleAction(bed.id, 'toggle')}
							>
								<input type="hidden" name="id" value={bed.id} />
								<input type="hidden" name="occupied" value={bed.occupied.toString()} />
								<button
									class="btn-icon turquoise"
									title="Toggle occupancy"
									disabled={isBookingActive || bed.enabled === false}
									class:disabled={isBookingActive || bed.enabled === false}>🔄</button
								>
							</form>

							{#if isVerified}
								<form
									action="?/deleteBed"
									method="POST"
									use:enhance={() => handleAction(bed.id, 'delete')}
								>
									<input type="hidden" name="id" value={bed.id} />
									<button
										class="btn-icon vanish"
										title="Delete spot"
										disabled={isBookingActive}
										class:disabled={isBookingActive}>🗑</button
									>
								</form>
							{/if}
						</div>
					</div>
				{/each}

				{#if beds.length === 0}
					<div class="empty-state">Desert wasteland. No spots detected. 🏜️</div>
				{/if}
			</div>
		</main>
	</div>
</div>

<style>
	.dashboard-container {
		max-width: 1200px;
		margin: 0 auto;
		padding: 1rem 0;
	}

	/* Header */
	.header-row {
		margin-bottom: 3rem;
		border-bottom: 1px solid #222;
		padding-bottom: 1.5rem;
	}
	.breadcrumbs {
		font-size: 0.75rem;
		font-weight: 900;
		letter-spacing: 1px;
		color: #666;
		text-transform: uppercase;
		margin-bottom: 1rem;
	}
	.breadcrumbs a {
		color: #2dd4bf;
		text-decoration: none;
	}
	.breadcrumbs a:hover {
		color: #fff;
	}
	.breadcrumbs .current {
		color: #f472b6;
	}
	.sep {
		margin: 0 0.5rem;
		color: #333;
	}

	h1 {
		font-size: 2.5rem;
		margin: 0;
		color: #fff;
		font-weight: 900;
		letter-spacing: -1px;
		display: flex;
		align-items: center;
		gap: 1rem;
	}
	.badge {
		font-size: 0.8rem;
		padding: 4px 12px;
		border-radius: 6px;
		font-weight: 900;
	}
	.badge.turquoise {
		background: rgba(45, 212, 191, 0.1);
		color: #2dd4bf;
		border: 1px solid #2dd4bf;
	}

	/* Layout */
	.content-split {
		display: grid;
		grid-template-columns: 320px 1fr;
		gap: 3rem;
	}
	@media (max-width: 900px) {
		.content-split {
			grid-template-columns: 1fr;
		}
	}

	/* Info Column */
	.status-card {
		background: #0f0f0f;
		border: 1px solid #222;
		padding: 2rem;
		border-radius: 12px;
		text-align: center;
		margin-bottom: 2rem;
		position: relative;
		overflow: hidden;
	}
	.status-card.turquoise {
		border-top: 2px solid #2dd4bf;
		box-shadow: 0 10px 30px rgba(45, 212, 191, 0.1);
	}
	.status-card h3 {
		margin: 0 0 1rem 0;
		color: #444;
		font-size: 0.75rem;
		font-weight: 900;
		letter-spacing: 2px;
	}
	.big-number {
		font-size: 3rem;
		font-weight: 900;
		color: #fff;
		letter-spacing: -2px;
	}
	.big-number .divider {
		color: #222;
		font-size: 1.5rem;
		vertical-align: middle;
	}
	.label {
		margin: 0.5rem 0 0 0;
		color: #2dd4bf;
		font-size: 0.7rem;
		font-weight: 900;
		letter-spacing: 1px;
	}
	.capacity-info {
		margin-top: 1rem;
		font-size: 0.6rem;
		color: #444;
		font-weight: 900;
		letter-spacing: 1px;
	}

	.form-panel {
		background: #0f0f0f;
		border: 1px solid #222;
		padding: 2rem;
		border-radius: 12px;
		position: relative;
	}
	.form-panel.orange {
		border-top: 2px solid #fb923c;
	}
	.form-panel.disabled {
		opacity: 0.4;
		filter: grayscale(1);
		pointer-events: none;
	}
	.lockdown-notice {
		position: absolute;
		top: 1.5rem;
		right: 2rem;
		color: #fb923c;
		font-size: 0.65rem;
		font-weight: 900;
		letter-spacing: 1px;
	}
	.panel-header {
		display: flex;
		align-items: center;
		gap: 10px;
		margin-bottom: 1rem;
	}
	.panel-header h3 {
		margin: 0;
		color: #eee;
		font-size: 0.85rem;
		font-weight: 900;
		letter-spacing: 1px;
	}
	.laser-dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
	}
	.laser-dot.orange {
		background: #fb923c;
		box-shadow: 0 0 10px #fb923c;
	}
	.laser-dot.turquoise {
		background: #2dd4bf;
		box-shadow: 0 0 10px #2dd4bf;
	}
	.hint {
		color: #444;
		font-size: 0.75rem;
		margin-bottom: 1.5rem;
		font-weight: bold;
	}

	/* Beds Column */
	.column-header {
		display: flex;
		align-items: center;
		gap: 10px;
		margin-bottom: 2rem;
		padding-bottom: 1rem;
		border-bottom: 1px solid #222;
	}
	.column-title {
		margin: 0;
		font-size: 0.9rem;
		font-weight: 900;
		color: #fff;
		letter-spacing: 2px;
	}
	.beds-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
		gap: 1.5rem;
	}

	.bed-card {
		background: #111;
		border: 1px solid #222;
		border-radius: 12px;
		padding: 1.5rem;
		display: flex;
		align-items: center;
		gap: 1rem;
		transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
		position: relative;
		overflow: hidden;
	}
	.bed-card.disabled {
		opacity: 0.5;
		filter: grayscale(0.8);
	}
	.bed-card.inactive {
		border-style: dashed;
		background: #0a0a0a;
		border-color: #333;
	}
	.bed-card.occupied {
		border-color: #311;
		background: #150a0a;
	}
	.bed-card:hover:not(.disabled) {
		transform: translateY(-3px);
		border-color: #444;
	}
	.bed-card.occupied:hover:not(.disabled) {
		border-color: #ef4444;
	}

	.bed-glow {
		position: absolute;
		top: 0;
		left: 0;
		width: 100%;
		height: 100%;
		background: radial-gradient(circle at center, rgba(45, 212, 191, 0.03), transparent);
		pointer-events: none;
	}
	.bed-glow.red {
		background: radial-gradient(circle at center, rgba(239, 68, 68, 0.03), transparent);
	}
	.bed-glow.gray {
		background: none;
	}

	.bed-icon {
		font-size: 1.25rem;
	}
	.bed-info {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.bed-label {
		font-weight: 900;
		font-size: 1rem;
		color: #fff;
	}
	.bed-status {
		font-size: 0.65rem;
		color: #444;
		font-weight: 900;
		letter-spacing: 1px;
	}
	.occupied .bed-status {
		color: #f87171;
	}
	.inactive .bed-label {
		color: #444;
	}

	.bed-actions {
		display: flex;
		gap: 0.75rem;
	}
	.btn-icon {
		background: #1a1a1a;
		border: 1px solid #333;
		color: #666;
		border-radius: 8px;
		cursor: pointer;
		padding: 8px;
		transition: all 0.2s;
	}
	.btn-icon.disabled {
		opacity: 0.3;
		cursor: not-allowed !important;
	}
	.btn-icon:hover:not(.disabled) {
		color: #fff;
		transform: scale(1.1);
	}
	.btn-icon.turquoise:hover:not(.disabled) {
		border-color: #2dd4bf;
		color: #2dd4bf;
		box-shadow: 0 0 10px rgba(45, 212, 191, 0.2);
	}
	.btn-icon.orange:hover:not(.disabled) {
		border-color: #fb923c;
		color: #fb923c;
		box-shadow: 0 0 10px rgba(251, 146, 60, 0.2);
	}
	.btn-icon.vanish:hover:not(.disabled) {
		border-color: #f87171;
		color: #f87171;
		background: #211;
		box-shadow: 0 0 10px rgba(248, 113, 113, 0.2);
	}

	.empty-state {
		grid-column: 1/-1;
		text-align: center;
		color: #333;
		padding: 4rem;
		background: #0a0a0a;
		border-radius: 16px;
		border: 1px dashed #222;
		font-weight: 900;
		letter-spacing: 2px;
	}
</style>
