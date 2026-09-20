<script lang="ts">
	import type { PageData, SubmitFunction } from './$types';
	import AddRoomForm from '$lib/components/admin/AddRoomForm.svelte';
	import { fade, fly } from 'svelte/transition';
	import { enhance } from '$app/forms';
	import { alertDialog, confirmDialog, toast } from '$lib/dialogs';

	export let data: PageData;
	export let form: { message?: string } | null = null;
	// Only admins reach this page (hooks + layout)
	$: ({ house, rooms, isLayoutLocked, phase } = data);

	type RoomCard = PageData['rooms'][number];

	let deletingRoomId: string | null = null;

	function deleteRoom(room: RoomCard): SubmitFunction {
		return async ({ cancel }) => {
			const spots = room.stats.total;
			const booked = room.stats.occupied;
			const confirmed = await confirmDialog(
				`Room #${room.room_number} "${room.name}" is deleted together with its spots.` +
					(booked > 0
						? ` ${booked} of its ${spots} active spots ${booked === 1 ? 'is' : 'are'} booked: those bookings are deleted too and the guests have to book again.`
						: '') +
					' Ticket codes stay valid. This cannot be undone.',
				{
					title: 'Delete this room?',
					tone: 'danger',
					confirmLabel: 'Delete room',
					cancelLabel: 'Keep it'
				}
			);
			if (!confirmed) {
				cancel();
				return;
			}

			return async ({ result, update }) => {
				if (result.type === 'success') {
					deletingRoomId = room.id;
					await new Promise((r) => setTimeout(r, 550));
					toast(`🌪️ Room "${room.name}" was deleted.`, 'success');
				} else if (result.type === 'failure' || result.type === 'error') {
					const reason =
						result.type === 'failure'
							? (result.data as { message?: string } | undefined)?.message
							: undefined;
					await alertDialog(
						`${reason || 'The server could not be reached.'} The room was not deleted.`,
						{ title: 'Room not deleted', tone: 'danger' }
					);
				}
				// Reloads the room list; a failure was already explained above.
				await update({ reset: false });
				deletingRoomId = null;
			};
		};
	}
</script>

<svelte:head>
	<title>House {house.name} · CozyNights</title>
</svelte:head>

<div class="dashboard-container">
	<div class="header-row" in:fly={{ y: -20, duration: 500 }}>
		<nav class="breadcrumbs" aria-label="Breadcrumb">
			<a href="/admin">Control Center</a> <span class="sep">/</span>
			<span class="current">{house.name}</span>
		</nav>
		<h1>
			<span class="house-icon">🛖</span>
			<span class="house-name">{house.name}</span>
			<span class="subtitle">SANCTUARY OVERSIGHT</span>
		</h1>
	</div>

	{#if form?.message}
		<div class="error-banner form-error" role="alert">{form.message}</div>
	{/if}

	{#if isLayoutLocked}
		<div class="lockdown-notice" role="status">
			🔒 {phase === 'closed' ? 'Booking is closed' : 'Live Booking is active'}, so rooms cannot be
			added or deleted. A superuser can switch back to Staging Mode in the
			<a href="/admin">Control Center</a>.
		</div>
	{/if}

	<section class="form-section" in:fade={{ delay: 200 }} class:disabled={isLayoutLocked}>
		<header class="section-header">
			<span class="laser-dot turquoise"></span>
			<h3>ADD ROOM ➕</h3>
		</header>
		<div class="form-wrapper">
			<AddRoomForm disabled={isLayoutLocked} />
		</div>
	</section>

	<header class="section-title-row">
		<span class="laser-dot pink"></span>
		<h2 class="section-title">ACTIVE ROOMS 🚪</h2>
	</header>

	<div class="grid">
		{#each rooms as room, i (room.id)}
			<div
				class="room-card"
				class:disintegrating={deletingRoomId === room.id}
				in:fly={{ y: 20, duration: 400, delay: i * 50 }}
			>
				<div class="card-edge pink"></div>

				<a href="/admin/room/{room.id}" class="room-link">
					<header class="card-header">
						<span class="room-number">#{room.room_number}</span>
						<span class="room-name">{room.name}</span>
					</header>

					<div class="card-body">
						<div class="progress-container">
							<div class="progress-track">
								<div
									class="progress-fill"
									style="width: {(room.stats.occupied / (room.stats.total || 1)) * 100}%"
									class:full={room.stats.occupied === room.stats.total && room.stats.total > 0}
								></div>
							</div>
							<div class="stat-info">
								<span class="label">SPOTS CLAIMED 📊</span>
								<span class="value">{room.stats.occupied} / {room.stats.total}</span>
							</div>
							{#if room.stats.checkedIn > 0}
								<div class="stat-info">
									<span class="label">CHECKED IN ✅</span>
									<span class="value">{room.stats.checkedIn} / {room.stats.occupied}</span>
								</div>
							{/if}
						</div>
					</div>
				</a>

				<footer class="card-actions">
					<a href="/admin/room/{room.id}" class="btn-manage">MANAGE SPOTS 🛌</a>
					<form action="?/deleteRoom" method="POST" use:enhance={deleteRoom(room)}>
						<input type="hidden" name="id" value={room.id} />
						<button
							type="submit"
							class="btn-vanish"
							class:disabled={isLayoutLocked}
							disabled={isLayoutLocked}
						>
							VANISH ROOM 🌪️
						</button>
					</form>
				</footer>
			</div>
		{/each}

		{#if rooms.length === 0}
			<div class="empty-state">
				This house has no rooms yet. Add the first one with the form above; guests can only book
				spots inside rooms.
			</div>
		{/if}
	</div>
</div>

<style>
	.dashboard-container {
		max-width: 1200px;
		margin: 0 auto;
		padding: 1rem 0;
	}

	/* Header & Breadcrumbs */
	.header-row {
		margin-bottom: 3rem;
		border-bottom: 1px solid #222;
		padding-bottom: 1.5rem;
		position: relative;
	}
	.breadcrumbs {
		font-size: 0.75rem;
		font-weight: 900;
		letter-spacing: 1px;
		color: #666;
		text-transform: uppercase;
		margin-bottom: 1rem;
		line-height: 1.8;
		overflow-wrap: anywhere;
	}
	.breadcrumbs a {
		color: #2dd4bf;
		text-decoration: none;
		transition: color 0.2s;
	}
	.breadcrumbs a:hover {
		color: #fff;
		text-shadow: 0 0 10px rgba(45, 212, 191, 0.5);
	}
	.breadcrumbs .current {
		color: #f472b6;
	}
	.sep {
		margin: 0 0.5rem;
		color: #333;
	}

	h1 {
		font-size: clamp(1.6rem, 6vw, 2.5rem);
		line-height: 1.15;
		margin: 0;
		color: #fff;
		font-weight: 900;
		letter-spacing: -1px;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem 1rem;
	}
	.house-icon {
		filter: drop-shadow(0 0 10px rgba(255, 255, 255, 0.2));
	}
	.house-name {
		min-width: 0;
		overflow-wrap: anywhere;
	}
	.subtitle {
		color: #666;
		font-size: 0.8rem;
		font-weight: 900;
		margin-left: auto;
		letter-spacing: 2px;
	}

	/* Section Headers */
	.section-title-row,
	.section-header {
		display: flex;
		align-items: center;
		gap: 10px;
		margin-bottom: 1.5rem;
	}
	.laser-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		display: inline-block;
	}
	.laser-dot.turquoise {
		background: #2dd4bf;
		box-shadow: 0 0 10px #2dd4bf;
	}
	.laser-dot.pink {
		background: #f472b6;
		box-shadow: 0 0 10px #f472b6;
	}

	.section-title {
		margin: 0;
		font-size: 1rem;
		color: #fff;
		font-weight: 900;
		letter-spacing: 2px;
	}

	.error-banner {
		background: rgba(239, 68, 68, 0.08);
		border: 1px solid rgba(239, 68, 68, 0.3);
		color: #f87171;
		padding: 1rem 1.5rem;
		border-radius: 12px;
		font-weight: 700;
		font-size: 0.85rem;
		margin-bottom: 2rem;
	}

	/* Form Section */
	.form-section {
		background: #0f0f0f;
		border: 1px solid #222;
		padding: 2rem;
		border-radius: 12px;
		margin-bottom: 4rem;
		border-top: 2px solid #2dd4bf;
		box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
		position: relative;
	}
	.form-section.disabled {
		opacity: 0.4;
		filter: grayscale(1);
		pointer-events: none;
	}
	.lockdown-notice {
		background: rgba(251, 146, 60, 0.08);
		border: 1px solid rgba(251, 146, 60, 0.3);
		color: #fb923c;
		padding: 1rem 1.5rem;
		border-radius: 12px;
		font-weight: 700;
		font-size: 0.85rem;
		line-height: 1.5;
		margin-bottom: 2rem;
	}
	.lockdown-notice a {
		color: #fdba74;
	}
	.form-section h3 {
		margin: 0;
		color: #eee;
		font-size: 0.9rem;
		font-weight: 900;
		letter-spacing: 1px;
	}

	/* Grid Layout */
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(320px, 100%), 1fr));
		gap: 2rem;
	}
	.empty-state {
		grid-column: 1 / -1;
		text-align: center;
		color: #888;
		padding: 2.5rem 1.5rem;
		background: #0a0a0a;
		border-radius: 16px;
		border: 1px dashed #222;
		font-weight: 700;
		line-height: 1.5;
	}

	/* Room Card */
	.room-card {
		background: #111;
		border: 1px solid #222;
		border-radius: 12px;
		padding: 1.5rem;
		color: inherit;
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
		min-width: 0;
		transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
		position: relative;
		overflow: hidden;
	}
	.room-link {
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
		text-decoration: none;
		color: inherit;
	}
	.room-card:hover {
		transform: translateY(-5px);
		border-color: #f472b6;
		box-shadow: 0 10px 30px rgba(244, 114, 182, 0.1);
	}

	.card-edge {
		position: absolute;
		top: 0;
		left: 0;
		width: 4px;
		height: 100%;
	}
	.card-edge.pink {
		background: #f472b6;
	}

	.card-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 1rem;
	}
	.room-number {
		background: #222;
		color: #f472b6;
		padding: 4px 10px;
		border-radius: 6px;
		font-weight: 900;
		font-size: 0.8rem;
		border: 1px solid #333;
		white-space: nowrap;
	}
	.room-name {
		font-weight: bold;
		font-size: 1.25rem;
		color: #fff;
		min-width: 0;
		text-align: right;
		overflow-wrap: anywhere;
	}

	/* Stats & Progress */
	.progress-container {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	.progress-track {
		height: 6px;
		background: #000;
		border-radius: 3px;
		overflow: hidden;
		border: 1px solid #222;
	}
	.progress-fill {
		height: 100%;
		background: #2dd4bf;
		transition: width 1s ease-out;
		box-shadow: 0 0 10px rgba(45, 212, 191, 0.5);
	}
	.progress-fill.full {
		background: #ef4444;
		box-shadow: 0 0 10px rgba(239, 68, 68, 0.5);
	}

	.stat-info {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}
	.label {
		font-size: 0.65rem;
		font-weight: 900;
		color: #888;
		letter-spacing: 1px;
	}
	.value {
		font-size: 0.85rem;
		color: #eee;
		font-weight: bold;
	}

	/* Actions */
	.card-actions {
		margin-top: auto;
		padding-top: 1.5rem;
		border-top: 1px solid #222;
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		gap: 0.75rem;
	}
	.card-actions form {
		display: flex;
		margin-left: auto;
	}
	.btn-manage,
	.btn-vanish {
		background: transparent;
		border: 1px solid #444;
		color: #888;
		cursor: pointer;
		font-size: 0.7rem;
		font-weight: 900;
		letter-spacing: 1px;
		padding: 0.5rem 1rem;
		border-radius: 6px;
		transition: all 0.2s;
		min-height: 44px;
		box-sizing: border-box;
		white-space: nowrap;
	}
	.btn-manage {
		display: inline-flex;
		align-items: center;
		text-decoration: none;
		color: #2dd4bf;
		border-color: rgba(45, 212, 191, 0.4);
	}
	.btn-manage:hover {
		border-color: #2dd4bf;
		background: rgba(45, 212, 191, 0.08);
	}
	.btn-vanish:hover:not(.disabled) {
		color: #f87171;
		border-color: #f87171;
		background: rgba(248, 113, 113, 0.05);
	}
	.btn-vanish.disabled {
		opacity: 0.3;
		cursor: not-allowed;
	}

	@media (max-width: 640px) {
		.header-row {
			margin-bottom: 1.5rem;
		}
		.subtitle {
			margin-left: 0;
			flex-basis: 100%;
		}
		.form-section {
			padding: 1.25rem 1rem;
			margin-bottom: 2.5rem;
		}
		.grid {
			gap: 1.25rem;
		}
		.room-card {
			padding: 1.25rem 1rem 1rem 1.25rem;
		}
	}
</style>
