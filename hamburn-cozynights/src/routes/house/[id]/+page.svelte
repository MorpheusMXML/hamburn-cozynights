<script lang="ts">
	import PlaceDetails from '$lib/components/PlaceDetails.svelte';
	import { filterLabel, roomWord } from '$lib/accommodation';
	import { ownSpotNote } from '$lib/booking-phase';
	import { CHECKED_IN_NOTE } from '$lib/check-in';
	import PassTicket from '$lib/components/PassTicket.svelte';
	import type { PageData, ActionData } from './$types';
	import { enhance } from '$app/forms';
	import { confirmDialog, toast } from '$lib/dialogs';

	export let data: PageData;
	export let form: ActionData;

	// `form` only matters without JavaScript; with it, the enhance callback below reports errors.
	let releaseError = form?.error ?? '';
	let isReleasing = false;
</script>

<svelte:head>
	<title>{data.house.name} · CozyNights</title>
</svelte:head>

<div class="container">
	<header>
		<div class="header-nav">
			<a href="/map" class="back-link">← Map</a>
		</div>
		<h1>{data.house.name}</h1>
		<p class="subtitle">Choose a {roomWord(data.house.kind)} for your night</p>
		<PlaceDetails
			level="house"
			kind={data.house.kind}
			features={data.house.features}
			description={data.house.description}
		/>
		{#if data.wishes.length > 0}
			<p class="wishes" role="status">
				Your wishes: {data.wishes.map(filterLabel).join(' · ')} —
				<a href="/house/{data.house.id}">show everything</a>
			</p>
		{/if}
	</header>

	{#if data.guestPhase === 'closed'}
		<div class="info-banner" role="status">
			<div class="banner-icon" aria-hidden="true">🔒</div>
			<div class="banner-content">
				<h3>Booking is closed</h3>
				<p>Spots are final now: nothing can be booked, changed or released anymore.</p>
			</div>
		</div>
	{:else if !data.isBookingActive}
		<div class="info-banner" role="status">
			<div class="banner-icon" aria-hidden="true">🎪</div>
			<div class="banner-content">
				<h3>Booking is not open yet</h3>
				<p>You can look around. Spots can be picked as soon as Live Booking starts.</p>
			</div>
		</div>
	{/if}

	{#if data.userBedId}
		<div class="booking-warning-banner">
			<div class="banner-icon" aria-hidden="true">⚠️</div>
			<div class="banner-content">
				<h3>You already have a spot</h3>
				{#if data.checkedIn}
					<p>{CHECKED_IN_NOTE}</p>
				{:else if data.spotFixed}
					<p>
						The crew picked your spot for you because of your special-needs request, so only the
						crew can change it.
					</p>
				{:else if data.isBookingActive}
					<p>
						One ticket code is one spot. To pick a different one, release your current spot first.
					</p>
				{:else}
					<p>{ownSpotNote(data.phase, data.guestPhase)}</p>
				{/if}
				{#if data.pass}
					<PassTicket pass={data.pass} />
				{/if}
				{#if data.isBookingActive && !data.spotFixed && !data.checkedIn}
					{#if releaseError}
						<p class="error-msg" role="alert">{releaseError}</p>
					{/if}
					<form
						method="POST"
						action="?/unbookBed"
						use:enhance={async ({ cancel }) => {
							const confirmed = await confirmDialog(
								'Your current spot becomes free for everyone else right away. You can then pick a new one.',
								{
									title: 'Release your spot?',
									tone: 'warning',
									confirmLabel: 'Release spot',
									cancelLabel: 'Keep my spot'
								}
							);
							if (!confirmed) {
								cancel();
								return;
							}
							releaseError = '';
							isReleasing = true;

							return async ({ result, update }) => {
								isReleasing = false;
								if (result.type === 'failure') {
									releaseError =
										(result.data as { error?: string } | undefined)?.error ||
										'Your spot could not be released. Please try again.';
								} else if (result.type === 'error') {
									releaseError =
										'We could not reach the server, so your spot was not released. Check your connection and try again.';
									return;
								} else if (result.type === 'success') {
									toast('Your spot is released. Pick a new one!', 'success');
								}
								await update();
							};
						}}
					>
						<button type="submit" class="btn-unbook-banner" disabled={isReleasing}>
							{isReleasing ? 'Releasing…' : 'Release Current Spot'}
						</button>
					</form>
				{/if}
			</div>
		</div>
	{/if}

	{#if data.rooms.length === 0}
		<p class="empty-state">This house has no rooms yet. Pick another house on the map.</p>
	{/if}

	<div class="grid">
		{#each data.rooms as room}
			<a
				href="/room/{room.id}{data.wishes.length > 0 ? `?w=${data.wishes.join(',')}` : ''}"
				class="card"
				class:full={room.freeCount === 0}
			>
				<div class="card-header">
					<h2>{room.name || 'Room'} <span class="room-number">#{room.room_number}</span></h2>
					<span class="badge" class:green={room.freeCount > 0}>
						{room.totalCount === 0
							? 'No spots'
							: room.freeCount > 0
								? `${room.freeCount} free`
								: 'Full'}
					</span>
				</div>
				<div class="progress-bar">
					<div
						class="fill"
						style="width: {((room.totalCount - room.freeCount) / (room.totalCount || 1)) * 100}%"
					></div>
				</div>
				<PlaceDetails
					level="room"
					kind={room.kind}
					features={room.features}
					description={room.description}
					compact
				/>
				{#if room.bedMix}<p class="bed-mix">{room.bedMix}</p>{/if}
				{#if room.fittingFree !== null}
					<p class="fitting" class:none={room.fittingFree === 0}>
						{room.fittingFree === 0
							? 'No free spot here fits your wishes'
							: `${room.fittingFree} free ${room.fittingFree === 1 ? 'spot fits' : 'spots fit'} your wishes`}
					</p>
				{/if}
			</a>
		{/each}
	</div>
</div>

<style>
	:global(body) {
		background: #050505;
		color: #eee;
		font-family: sans-serif;
		margin: 0;
	}
	.container {
		max-width: 800px;
		margin: 0 auto;
		padding: clamp(1rem, 4vw, 2rem);
		padding-bottom: max(2rem, env(safe-area-inset-bottom));
	}

	header {
		margin-bottom: 2rem;
		border-bottom: 1px solid #333;
		padding-bottom: 1rem;
	}

	.header-nav {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		align-items: center;
		gap: 0.5rem 1rem;
		margin-bottom: 1rem;
	}

	.back-link {
		display: inline-flex;
		align-items: center;
		min-height: 44px;
		padding: 0 0.75rem 0 0;
		color: #b5b5b5;
		font-weight: 700;
		text-decoration: none;
	}
	.back-link:hover {
		color: #fff;
	}

	h1 {
		margin: 0;
		font-size: clamp(1.75rem, 8vw, 2.5rem);
		line-height: 1.15;
		font-weight: 900;
		letter-spacing: -1px;
		overflow-wrap: anywhere;
	}
	.subtitle {
		color: #9a9a9a;
		margin: 0.25rem 0 0.75rem;
	}

	.wishes {
		margin: 0.75rem 0 0;
		font-size: 0.85rem;
		color: #9fb3c8;
		overflow-wrap: anywhere;
	}
	.wishes a {
		color: #00ffe0;
	}
	.bed-mix {
		margin: 0.5rem 0 0;
		font-size: 0.78rem;
		color: #8a8f98;
		overflow-wrap: anywhere;
	}
	.fitting {
		margin: 0.35rem 0 0;
		font-size: 0.82rem;
		font-weight: 700;
		color: #6ee7b7;
		overflow-wrap: anywhere;
	}
	.fitting.none {
		color: #9a9a9a;
		font-weight: 400;
	}

	.info-banner,
	.booking-warning-banner {
		border-radius: 12px;
		padding: clamp(1rem, 4vw, 1.5rem);
		display: flex;
		gap: clamp(0.75rem, 4vw, 1.5rem);
		align-items: flex-start;
		margin-bottom: 2rem;
	}
	/* "Booking is closed" / "not open yet": the closed phase's colour, the same
	   as the room page's banner (state.css). Pink is for special needs only. */
	.info-banner {
		background: var(--state-closed-soft);
		border: 1px solid var(--state-closed);
	}
	.booking-warning-banner {
		background: rgba(248, 113, 113, 0.1);
		border: 1px solid #f87171;
	}
	.banner-icon {
		font-size: 2rem;
		line-height: 1;
	}
	.banner-content {
		min-width: 0;
	}
	.banner-content h3 {
		margin: 0;
		font-weight: 900;
	}
	.info-banner h3 {
		color: var(--state-closed);
	}
	.booking-warning-banner h3 {
		color: #f87171;
	}
	.banner-content p {
		margin: 0.25rem 0 0;
		color: #c4c4c4;
		line-height: 1.45;
	}
	.btn-unbook-banner {
		margin-top: 1rem;
		min-height: 44px;
		background: #f87171;
		color: #000;
		border: none;
		padding: 8px 16px;
		border-radius: 6px;
		font-weight: 900;
		cursor: pointer;
	}
	.btn-unbook-banner:disabled {
		opacity: 0.6;
		cursor: progress;
	}
	.banner-content .error-msg {
		color: #fecaca;
		font-weight: bold;
		font-size: 0.95rem;
		margin: 0.75rem 0 0;
	}

	.empty-state {
		color: #c4c4c4;
		line-height: 1.5;
	}

	.grid {
		display: grid;
		gap: 1rem;
		grid-template-columns: repeat(auto-fill, minmax(min(100%, 300px), 1fr));
	}

	.card {
		background: #1a1a1a;
		border: 1px solid #333;
		border-radius: 8px;
		padding: clamp(1rem, 4vw, 1.5rem);
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
		align-items: flex-start;
		gap: 0.75rem;
		margin-bottom: 1rem;
	}
	.card-header h2 {
		margin: 0;
		min-width: 0;
		font-size: 1.05rem;
		font-weight: 700;
		line-height: 1.3;
		overflow-wrap: anywhere;
	}
	.room-number {
		color: #9a9a9a;
		white-space: nowrap;
	}
	.badge {
		flex-shrink: 0;
		background: #333;
		padding: 4px 8px;
		border-radius: 4px;
		font-size: 0.8rem;
		white-space: nowrap;
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
		background: var(--state-open);
	}
	.full .fill {
		background: var(--state-full);
	}
</style>
