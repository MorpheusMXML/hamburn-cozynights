<script lang="ts">
	import type { PageData, SubmitFunction } from './$types';
	import type { ActionResult } from '@sveltejs/kit';
	import AddBedForm from '$lib/components/admin/AddBedForm.svelte';
	import { fade, fly } from 'svelte/transition';
	import { enhance } from '$app/forms';
	import { alertDialog, confirmDialog, toast } from '$lib/dialogs';

	export let data: PageData;
	export let form: { message?: string } | null = null;
	// Only admins reach this page (hooks + layout)
	$: ({ room, beds, isLayoutLocked, phase } = data);
	$: house = room.expand?.house;
	$: roomTitle = room.name || `Room ${room.room_number}`;

	type Bed = PageData['beds'][number];

	let deletingBedId: string | null = null;

	const spotName = (bed: Bed) => (bed.label ? `"${bed.label}"` : 'the unnamed spot');

	/** Shows why an action failed; the list is reloaded either way. */
	async function explainFailure(result: ActionResult, title: string) {
		if (result.type !== 'failure' && result.type !== 'error') return;
		const reason =
			result.type === 'failure'
				? (result.data as { message?: string } | undefined)?.message
				: undefined;
		await alertDialog(`${reason || 'The server could not be reached.'} Nothing was changed.`, {
			title,
			tone: 'danger'
		});
	}

	/** Lock, activate and occupancy switches: no question asked, failures are explained. */
	function toggleSpot(title: string): SubmitFunction {
		return () =>
			async ({ result, update }) => {
				await explainFailure(result, title);
				await update({ reset: false });
			};
	}

	function toggleOccupied(bed: Bed): SubmitFunction {
		return async ({ cancel }) => {
			// A spot with a ticket attached is a guest's booking, not a test flag.
			if (bed.occupied && bed.order) {
				const confirmed = await confirmDialog(
					`Spot ${spotName(bed)} was booked by a guest. Freeing it cancels that booking: the guest loses the spot and has to book again. Their ticket code stays valid.`,
					{
						title: "Cancel this guest's booking?",
						tone: 'danger',
						confirmLabel: 'Free the spot',
						cancelLabel: 'Keep booking'
					}
				);
				if (!confirmed) {
					cancel();
					return;
				}
			}
			return async ({ result, update }) => {
				await explainFailure(result, 'Spot not changed');
				await update({ reset: false });
			};
		};
	}

	function deleteSpot(bed: Bed): SubmitFunction {
		return async ({ cancel }) => {
			const confirmed = await confirmDialog(
				`Spot ${spotName(bed)} is removed from this room.` +
					(bed.occupied
						? ' It is currently taken: that booking is deleted too and the guest has to book again.'
						: '') +
					' This cannot be undone.',
				{
					title: 'Delete this spot?',
					tone: 'danger',
					confirmLabel: 'Delete spot',
					cancelLabel: 'Keep it'
				}
			);
			if (!confirmed) {
				cancel();
				return;
			}
			return async ({ result, update }) => {
				if (result.type === 'success') {
					deletingBedId = bed.id;
					await new Promise((r) => setTimeout(r, 550));
					toast(`🗑 Spot ${spotName(bed)} was deleted.`, 'success');
				}
				await explainFailure(result, 'Spot not deleted');
				await update({ reset: false });
				deletingBedId = null;
			};
		};
	}
</script>

<svelte:head>
	<title>{roomTitle}{house ? ` · ${house.name}` : ''} · CozyNights</title>
</svelte:head>

<div class="dashboard-container">
	<div class="header-row" in:fly={{ y: -20, duration: 500 }}>
		<nav class="breadcrumbs" aria-label="Breadcrumb">
			<a href="/admin">Control Center</a>
			<span class="sep">/</span>
			{#if house}<a href="/admin/house/{house.id}">{house.name}</a> <span class="sep">/</span>{/if}
			<span class="current">Room {room.room_number}</span>
		</nav>

		<h1>
			<span class="room-icon">🛌</span>
			<span class="room-title">{roomTitle}</span>
			<span class="badge turquoise">#{room.room_number}</span>
		</h1>
	</div>

	{#if form?.message}
		<div class="error-banner" role="alert" in:fade>⚠️ {form.message}</div>
	{/if}

	{#if isLayoutLocked}
		<div class="lockdown-notice" role="status">
			🔒 {phase === 'closed' ? 'Booking is closed' : 'Live Booking is active'}. You can still lock
			🔒 and unlock 🔓 spots. To add, delete, deactivate or free spots, a superuser has to switch
			back to Staging Mode in the <a href="/admin">Control Center</a>.
		</div>
	{/if}

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

			<section class="form-panel orange" class:disabled={isLayoutLocked}>
				<header class="panel-header">
					<span class="laser-dot orange"></span>
					<h3>ADD SPOT ➕</h3>
				</header>
				<p class="hint">Define spot label (e.g. "Upper Deck")</p>
				<AddBedForm roomId={room.id} disabled={isLayoutLocked} />
			</section>
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
						class:disabled={isLayoutLocked}
						class:inactive={bed.enabled === false}
						class:disintegrating={deletingBedId === bed.id}
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
							{#if bed.is_special}
								<span class="bed-status special">SPECIAL NEEDS ♿</span>
							{/if}
						</div>

						<div class="bed-actions">
							<form
								action="?/toggleLocked"
								method="POST"
								use:enhance={toggleSpot('Lock not changed')}
							>
								<input type="hidden" name="id" value={bed.id} />
								<input type="hidden" name="is_locked" value={bed.is_locked?.toString()} />
								<button
									class="btn-icon"
									class:orange={bed.is_locked}
									title={bed.is_locked
										? 'Unlock: guests can book this spot again'
										: 'Lock: guests cannot book this spot'}
								>
									<span class="btn-emoji">{bed.is_locked ? '🔓' : '🔒'}</span>
									<span class="btn-text">{bed.is_locked ? 'UNLOCK' : 'LOCK'}</span>
								</button>
							</form>

							<form
								action="?/toggleSpecial"
								method="POST"
								use:enhance={toggleSpot('Special-needs mark not changed')}
							>
								<input type="hidden" name="id" value={bed.id} />
								<input type="hidden" name="is_special" value={String(!!bed.is_special)} />
								<button
									class="btn-icon pink"
									class:active={bed.is_special}
									title={bed.is_special
										? 'Special-needs spot: only the crew assigns it. Click to make it a normal spot again.'
										: 'Special-needs spot: guests cannot book it, the crew assigns it to approved special-needs requests'}
								>
									<span class="btn-emoji">♿</span>
									<span class="btn-text">{bed.is_special ? 'NORMAL' : 'SPECIAL'}</span>
								</button>
							</form>

							<form
								action="?/toggleEnabled"
								method="POST"
								use:enhance={toggleSpot('Spot not changed')}
							>
								<input type="hidden" name="id" value={bed.id} />
								<input type="hidden" name="enabled" value={bed.enabled !== false} />
								<button
									class="btn-icon"
									class:orange={bed.enabled === false}
									class:disabled={isLayoutLocked}
									disabled={isLayoutLocked}
									title={bed.enabled === false
										? 'Activate: the spot counts and can be booked'
										: 'Deactivate: the spot is not in use and does not count'}
								>
									<span class="btn-emoji">{bed.enabled === false ? '⚡️' : '❄️'}</span>
									<span class="btn-text">{bed.enabled === false ? 'ACTIVATE' : 'DEACTIVATE'}</span>
								</button>
							</form>

							<form action="?/toggleOccupied" method="POST" use:enhance={toggleOccupied(bed)}>
								<input type="hidden" name="id" value={bed.id} />
								<input type="hidden" name="occupied" value={bed.occupied.toString()} />
								<button
									class="btn-icon turquoise"
									title={bed.occupied
										? 'Free this spot'
										: 'Mark this spot as taken without a ticket'}
									disabled={isLayoutLocked || bed.enabled === false}
									class:disabled={isLayoutLocked || bed.enabled === false}
								>
									<span class="btn-emoji">🔄</span>
									<span class="btn-text">{bed.occupied ? 'FREE' : 'TAKEN'}</span>
								</button>
							</form>

							<form action="?/deleteBed" method="POST" use:enhance={deleteSpot(bed)}>
								<input type="hidden" name="id" value={bed.id} />
								<button
									class="btn-icon vanish"
									title="Delete this spot"
									disabled={isLayoutLocked}
									class:disabled={isLayoutLocked}
								>
									<span class="btn-emoji">🗑</span>
									<span class="btn-text">DELETE</span>
								</button>
							</form>
						</div>
					</div>
				{/each}

				{#if beds.length === 0}
					<div class="empty-state">
						Desert wasteland. 🏜️ This room has no spots yet, so guests cannot book here. Add spots
						with ADD SPOT ➕.
					</div>
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
		line-height: 1.8;
		overflow-wrap: anywhere;
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
	.room-title {
		min-width: 0;
		overflow-wrap: anywhere;
	}
	.badge {
		font-size: 0.8rem;
		padding: 4px 12px;
		border-radius: 6px;
		font-weight: 900;
		letter-spacing: 0;
		white-space: nowrap;
	}
	.badge.turquoise {
		background: rgba(45, 212, 191, 0.1);
		color: #2dd4bf;
		border: 1px solid #2dd4bf;
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

	/* Layout */
	.content-split {
		display: grid;
		grid-template-columns: 320px minmax(0, 1fr);
		gap: 3rem;
	}
	@media (max-width: 900px) {
		.content-split {
			grid-template-columns: minmax(0, 1fr);
			gap: 2rem;
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
		font-size: 0.65rem;
		color: #888;
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
		color: #888;
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
		grid-template-columns: repeat(auto-fill, minmax(min(260px, 100%), 1fr));
		gap: 1.5rem;
	}

	.bed-card {
		background: #111;
		border: 1px solid #222;
		border-radius: 12px;
		padding: 1.5rem;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 1rem;
		transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
		position: relative;
		overflow: hidden;
		min-width: 0;
		box-sizing: border-box;
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
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.bed-label {
		font-weight: 900;
		font-size: 1rem;
		color: #fff;
		overflow-wrap: anywhere;
	}
	.bed-status {
		font-size: 0.65rem;
		color: #888;
		font-weight: 900;
		letter-spacing: 1px;
	}
	.occupied .bed-status {
		color: #f87171;
	}
	.inactive .bed-label {
		color: #777;
	}

	/* Own row below the label: the five buttons don't fit next to it in a card of
	   the grid's minimum width, and the card would clip them. In a narrow card
	   they wrap onto a second row instead of cutting their words. */
	.bed-actions {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(3.75rem, 1fr));
		gap: 0.5rem;
		flex-basis: 100%;
		padding-top: 1rem;
		border-top: 1px solid #222;
	}
	.bed-actions form {
		display: flex;
		min-width: 0;
	}
	/* Icon plus word: on a touch screen there is no tooltip to explain an icon. */
	.btn-icon {
		flex: 1;
		min-width: 0;
		min-height: 48px;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 2px;
		background: #1a1a1a;
		border: 1px solid #333;
		color: #888;
		border-radius: 8px;
		cursor: pointer;
		padding: 6px 2px;
		font-family: inherit;
		transition: all 0.2s;
	}
	.btn-emoji {
		font-size: 1rem;
		line-height: 1.2;
	}
	.btn-text {
		font-size: 0.55rem;
		font-weight: 900;
		letter-spacing: 0.5px;
		max-width: 100%;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.btn-icon.disabled {
		opacity: 0.3;
		cursor: not-allowed !important;
	}
	.btn-icon:hover:not(.disabled) {
		color: #fff;
		transform: scale(1.05);
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
	.btn-icon.pink:hover:not(.disabled),
	.btn-icon.pink.active {
		border-color: #f472b6;
		color: #f472b6;
		box-shadow: 0 0 10px rgba(244, 114, 182, 0.2);
	}
	.bed-status.special {
		display: block;
		color: #f472b6;
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
		color: #888;
		padding: 2.5rem 1.5rem;
		background: #0a0a0a;
		border-radius: 16px;
		border: 1px dashed #222;
		font-weight: 700;
		line-height: 1.5;
	}

	@media (max-width: 640px) {
		.header-row {
			margin-bottom: 1.5rem;
		}
		.status-card,
		.form-panel {
			padding: 1.25rem 1rem;
		}
		.bed-card {
			padding: 1rem;
		}
	}
</style>
