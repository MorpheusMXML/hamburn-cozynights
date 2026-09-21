<script lang="ts">
	import type { PageData } from './$types';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { onMount } from 'svelte';
	import IntelDashboard from '$lib/components/admin/IntelDashboard.svelte';
	import IntelAttention from '$lib/components/admin/intel/IntelAttention.svelte';
	import BookingWindowPanel from '$lib/components/admin/BookingWindowPanel.svelte';
	import BookingGuest from '$lib/components/admin/BookingGuest.svelte';
	import { createLivePoll } from '$lib/live-stats-poll';
	import { createBookingsFeed } from '$lib/live-bookings';
	import { attentionItems } from '$lib/intel';
	import { countBookings, sortBookings } from '$lib/bookings';
	import { relativeTime } from '$lib/time';
	import { alertDialog, toast } from '$lib/dialogs';
	import { actionErrorMessage } from '$lib/admin-actions';

	export let data: PageData;

	// The Control Center: the booking window, the special-needs switch, what
	// needs attention, the latest bookings and check-ins, and the live numbers.
	// The camp editor is /admin/camp (docs/admin/index.md). Superusers
	// additionally get the destructive tools (switch now, clear all bookings).
	$: ({ crewBookedSpots, isSuperuser, phase, bookingWindow, sanityIssues } = data);

	// Live booking picture. The page load brings the first set of numbers, the
	// poll keeps them current (see $lib/live-stats-poll.ts: hidden tabs cost
	// nothing, unchanged numbers come back as 304).
	const poll = createLivePoll({ initial: data.stats });
	onMount(() => poll.start());
	// The poll hands back the same object while nothing changes (its answer is
	// a 304), and so does the page load: only a different object re-renders.
	let live = data.stats;
	$: newest = $poll.stats ?? data.stats;
	$: if (newest !== live) live = newest;
	// Another admin added or vanished a house: the numbers know, the page load
	// doesn't. Offer the reload instead of silently drifting apart.
	$: layoutChanged = live.houses.length !== data.houses.length;
	$: liveLabel =
		$poll.status === 'live'
			? `Live · last change ${relativeTime(live.changedAt)}`
			: $poll.signedOut
				? 'Signed out — sign in again for live numbers'
				: $poll.status === 'offline'
					? 'No connection — numbers may be out of date'
					: $poll.status === 'stale'
						? 'Catching up…'
						: 'Starting…';

	// What the booking window panel warns about before releasing bookings.
	$: occupiedBeds = live.spots.occupied;
	$: checkedInBeds = live.spots.checkedIn;
	$: attention = attentionItems(live, phase);

	// The latest bookings and check-ins, with names: asked again only when the
	// live numbers moved ($lib/live-bookings.ts).
	const feed = createBookingsFeed({ initial: data.bookings ?? [], changedAt: null });
	$: feed.reset(data.bookings ?? [], null);
	$: feed.follow($poll.stats);
	$: rows = $feed.rows;
	$: counts = countBookings(rows);
	// After booking closed the guests arrive: the check-ins are the news then.
	$: arrival = phase === 'closed';
	$: latest = arrival
		? sortBookings(
				rows.filter((row) => row.checkIn),
				'checkin'
			).slice(0, 5)
		: sortBookings(
				rows.filter((row) => row.guest && row.bookedAt),
				'newest'
			).slice(0, 5);

	// Special-needs requests (/admin/requests): own switch, independent of the phase.
	$: ({ requestsOpen } = data);
	$: openRequests = data.openRequests;
	let requestsSaving = false;

	const handleToggleRequests: SubmitFunction = () => {
		requestsSaving = true;
		return async ({ result, update }) => {
			requestsSaving = false;
			if (result.type === 'success') {
				const open = (result.data as { requestsOpen?: boolean } | undefined)?.requestsOpen;
				toast(
					open
						? '♿ Special-needs requests are open: guests see a link on the map.'
						: '♿ Special-needs requests are closed.',
					'success'
				);
			} else {
				await alertDialog(
					`${actionErrorMessage(result) || 'The server could not be reached.'} Requests were not opened or closed. Reload the page and try again.`,
					{ title: 'Switch not changed', tone: 'danger' }
				);
			}
			await update();
		};
	};
</script>

<svelte:head>
	<title>Control Center · CozyNights</title>
</svelte:head>

<div class="dashboard-wrapper">
	<header class="page-header">
		<div class="header-left">
			<h1>Control Center 🔥</h1>
			<p class="subtitle">Orchestrating the chaos of the playa 🏜️</p>
		</div>
	</header>

	<BookingWindowPanel
		{phase}
		{bookingWindow}
		{isSuperuser}
		{occupiedBeds}
		{crewBookedSpots}
		{checkedInBeds}
	/>

	<section class="requests-panel" class:open={requestsOpen}>
		<span class="requests-icon" aria-hidden="true">♿</span>
		<span class="requests-text">
			Special-needs requests: <strong>{requestsOpen ? 'OPEN' : 'CLOSED'}</strong>
			{#if openRequests}· {openRequests} waiting for a decision{/if}
		</span>
		<form method="POST" action="/admin/requests?/toggleRequests" use:enhance={handleToggleRequests}>
			<input type="hidden" name="open" value={String(!requestsOpen)} />
			<button type="submit" class="btn-requests" disabled={requestsSaving}>
				{requestsOpen ? 'Close requests' : 'Open requests'}
			</button>
		</form>
		<a class="requests-review" href="/admin/requests">Review requests →</a>
	</section>

	<section class="panel attention-panel">
		<IntelAttention items={attention} />
		{#if sanityIssues > 0}
			<p class="sanity-line" data-state="danger">
				⚠️ The camp layout is incomplete: {sanityIssues}
				{sanityIssues === 1 ? 'place' : 'places'} where guests can't book anything.
				<a href="/admin/camp">Map & houses →</a>
			</p>
		{/if}
	</section>

	<section class="panel bookings-panel" aria-labelledby="overview-bookings-title">
		<div class="section-header">
			<span class="laser-dot turquoise"></span>
			<h3 id="overview-bookings-title">BOOKINGS & CHECK-INS 🛏️</h3>
			<a class="panel-link" href="/admin/bookings">All bookings →</a>
		</div>

		{#if data.bookings === null && rows.length === 0}
			<p class="panel-note">The bookings could not be read. Reload the page to try again.</p>
		{:else}
			<div class="booking-counts">
				<a class="count" data-state="live" href="/admin/bookings?show=all">
					<span class="count-value">{counts.booked}</span>
					<span class="count-label">booked</span>
				</a>
				<a class="count" data-state="checked-in" href="/admin/bookings?show=checkedin">
					<span class="count-value">{counts.checkedIn}</span>
					<span class="count-label">checked in</span>
				</a>
				<a class="count" data-state="filling" href="/admin/bookings?show=arriving">
					<span class="count-value">{counts.arriving}</span>
					<span class="count-label">still to arrive</span>
				</a>
				<a class="count" data-state="locked" href="/admin/bookings?show=crew">
					<span class="count-value">{counts.crew + counts.viaRequest}</span>
					<span class="count-label">held by the crew</span>
				</a>
			</div>

			<h4 class="latest-title">
				{arrival ? 'LATEST CHECK-INS' : 'LATEST BOOKINGS'}
			</h4>
			{#if latest.length === 0}
				<p class="panel-note">
					{#if arrival}
						Nobody is checked in yet. Guests check in at the
						<a href="/admin/check">check-in desk</a> with their booking pass.
					{:else if phase === 'staging'}
						Booking hasn't opened yet. Spots the crew holds show up in the
						<a href="/admin/bookings?show=crew">bookings list</a>.
					{:else}
						No guest has booked a spot yet.
					{/if}
				</p>
			{:else}
				<ul class="latest-list">
					{#each latest as row (row.bedId)}
						<li>
							<span class="latest-when">
								{relativeTime(arrival ? row.checkIn?.at : row.bookedAt)}
							</span>
							<BookingGuest {row} compact showPlace />
						</li>
					{/each}
				</ul>
			{/if}
		{/if}
	</section>

	<section class="intel-panel">
		<div class="dashboard-section">
			<div class="section-header">
				<span class="laser-dot pink"></span>
				<h3>LIVE OPERATIONS INTEL</h3>
				<span class="live-chip" data-status={$poll.status} title={liveLabel}>
					<span class="live-dot"></span>
					<span class="live-text">{liveLabel}</span>
				</span>
				<button
					class="btn-refresh"
					on:click={() => poll.refresh()}
					title="Fetch the numbers again now"
					aria-label="Refresh the numbers now">↻</button
				>
			</div>

			{#if layoutChanged}
				<p class="layout-changed" role="status">
					🛖 The camp layout changed while this page was open.
					<button class="btn-inline" on:click={() => invalidateAll()}>Reload the page</button>
					to see the houses themselves.
				</p>
			{/if}

			<IntelDashboard stats={live} {phase} showAttention={false} />
		</div>
	</section>
</div>

<style>
	.dashboard-wrapper {
		display: flex;
		flex-direction: column;
		gap: 2rem;
		padding: 2rem;
		background: #050505;
		min-height: 100vh;
		min-height: 100dvh;
		color: #fff;
	}
	.page-header {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		align-items: center;
		gap: 1rem 2rem;
		border-bottom: 1px solid #1a1a1a;
		padding-bottom: 1.5rem;
	}
	.header-left h1 {
		margin: 0;
		font-size: 2rem;
		font-weight: 900;
		letter-spacing: -1px;
	}
	.subtitle {
		margin: 0.25rem 0 0 0;
		color: #666;
		font-size: 0.85rem;
		font-weight: bold;
	}
	.requests-panel {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 0.75rem;
		font-size: 0.8rem;
		font-weight: 800;
		letter-spacing: 0.5px;
		background: rgba(115, 115, 115, 0.05);
		border: 1px solid #333;
		border-radius: 12px;
		padding: 0.6rem 1.5rem;
		color: #a3a3a3;
	}
	.requests-panel.open {
		background: rgba(244, 114, 182, 0.05);
		border-color: rgba(244, 114, 182, 0.3);
	}
	.requests-panel strong {
		color: #f472b6;
	}
	.requests-icon {
		font-size: 1rem;
	}
	.requests-text {
		flex: 1 1 12rem;
		min-width: 0;
	}
	.btn-requests {
		min-height: 44px;
		padding: 0.5rem 1rem;
		border-radius: 8px;
		border: 1px solid #f472b6;
		background: transparent;
		color: #f472b6;
		font-weight: 900;
		font-size: 0.75rem;
		cursor: pointer;
		white-space: nowrap;
	}
	.btn-requests:hover {
		background: rgba(244, 114, 182, 0.12);
	}
	.btn-requests:disabled {
		opacity: 0.5;
		cursor: progress;
	}
	.requests-review {
		display: inline-flex;
		align-items: center;
		min-height: 44px;
		color: #2dd4bf;
		text-decoration: none;
	}
	.intel-panel {
		background: #0a0a0a;
		border: 1px solid #222;
		border-radius: 16px;
		padding: 2rem;
		box-shadow:
			inset 0 0 50px rgba(0, 0, 0, 0.8),
			0 0 20px rgba(0, 0, 0, 0.5);
	}
	.dashboard-section {
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
		/* Never wider than the panel: when the panel was a two-column grid, the
		   live chip's one long line ("Live · last change 4 min ago", never
		   wrapping) made the whole page 430 px wide on a 320 px phone. Found by
		   the layout suite. */
		min-width: 0;
	}
	.section-header {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 12px;
		border-bottom: 1px solid #1a1a1a;
		padding-bottom: 0.75rem;
	}
	.section-header h3 {
		flex: 1 1 auto;
		min-width: 0;
		margin: 0;
		font-size: 0.7rem;
		font-weight: 900;
		letter-spacing: 2.5px;
		color: #666;
	}
	.live-chip {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		/* Narrow screens: the chip drops to its own line and, if even that is
		   tight, its text ends in an ellipsis instead of pushing the page. */
		flex: 0 1 auto;
		min-width: 0;
		max-width: 100%;
		padding: 0.25rem 0.6rem;
		border-radius: 999px;
		font-size: 0.55rem;
		font-weight: 900;
		letter-spacing: 1px;
		text-transform: uppercase;
		background: rgba(255, 255, 255, 0.03);
		border: 1px solid #222;
		color: #737373;
	}
	.live-text {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.live-dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: #737373;
		flex-shrink: 0;
	}
	/* The only thing that blinks on this page: proof the numbers are moving. */
	.live-chip[data-status='live'] {
		color: var(--state-open);
		border-color: rgba(74, 222, 128, 0.3);
	}
	.live-chip[data-status='live'] .live-dot {
		background: var(--state-open);
		box-shadow: 0 0 8px var(--state-open);
		animation: live-pulse 2s ease-in-out infinite;
	}
	.live-chip[data-status='stale'] {
		color: var(--state-filling);
		border-color: rgba(251, 146, 60, 0.3);
	}
	.live-chip[data-status='stale'] .live-dot {
		background: var(--state-filling);
	}
	.live-chip[data-status='offline'] {
		color: var(--state-full);
		border-color: rgba(248, 113, 113, 0.3);
	}
	.live-chip[data-status='offline'] .live-dot {
		background: var(--state-full);
	}
	@keyframes live-pulse {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.25;
		}
	}
	.btn-refresh {
		background: transparent;
		border: 1px solid #222;
		color: #737373;
		border-radius: 8px;
		width: 28px;
		height: 28px;
		font-size: 0.9rem;
		line-height: 1;
		cursor: pointer;
		flex-shrink: 0;
	}
	.btn-refresh:hover {
		color: #2dd4bf;
		border-color: #2dd4bf;
	}
	.layout-changed {
		margin: 0;
		font-size: 0.7rem;
		font-weight: 700;
		color: #fb923c;
		line-height: 1.5;
	}
	.btn-inline {
		background: none;
		border: none;
		padding: 0;
		font: inherit;
		color: #2dd4bf;
		text-decoration: underline;
		cursor: pointer;
	}
	.laser-dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
	}
	.laser-dot.pink {
		background: #f472b6;
		box-shadow: 0 0 10px #f472b6;
	}
	.laser-dot.turquoise {
		background: #2dd4bf;
		box-shadow: 0 0 10px #2dd4bf;
	}
	.panel {
		background: #0a0a0a;
		border: 1px solid #222;
		border-radius: 16px;
		padding: 1.25rem 1.5rem;
		display: flex;
		flex-direction: column;
		gap: 1rem;
		min-width: 0;
	}
	.sanity-line {
		margin: 0;
		font-size: 0.8rem;
		font-weight: 700;
		color: var(--state);
		line-height: 1.5;
	}
	.sanity-line a,
	.panel-note a {
		color: #2dd4bf;
	}
	.panel-link {
		flex-shrink: 0;
		font-size: 0.75rem;
		font-weight: 800;
		color: #2dd4bf;
		text-decoration: none;
	}
	.panel-link:hover {
		text-decoration: underline;
	}
	.panel-note {
		margin: 0;
		font-size: 0.8rem;
		color: #888;
		line-height: 1.5;
	}
	.booking-counts {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(9rem, 100%), 1fr));
		gap: 0.75rem;
	}
	.count {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		padding: 0.75rem 1rem;
		border-radius: 12px;
		border: 1px solid #1f1f1f;
		background: var(--state-soft);
		text-decoration: none;
		min-width: 0;
	}
	.count:hover {
		border-color: var(--state);
	}
	.count-value {
		font-size: 1.6rem;
		font-weight: 900;
		color: var(--state);
		line-height: 1.1;
	}
	.count-label {
		font-size: 0.65rem;
		font-weight: 900;
		letter-spacing: 1px;
		text-transform: uppercase;
		color: #a3a3a3;
	}
	.latest-title {
		margin: 0;
		font-size: 0.6rem;
		font-weight: 900;
		letter-spacing: 2px;
		color: #a3a3a3;
	}
	.latest-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.latest-list li {
		display: grid;
		grid-template-columns: 6.5rem minmax(0, 1fr);
		align-items: start;
		gap: 0.75rem;
	}
	.latest-when {
		padding-top: 0.4rem;
		font-size: 0.7rem;
		font-weight: 700;
		color: #777;
	}

	@media (max-width: 640px) {
		.dashboard-wrapper {
			gap: 1.25rem;
			padding: 1rem 0.75rem;
		}
		.header-left h1 {
			font-size: 1.6rem;
		}
		.panel,
		.intel-panel {
			padding: 1rem;
		}
		.latest-list li {
			grid-template-columns: minmax(0, 1fr);
			gap: 0.2rem;
		}
		.latest-when {
			padding-top: 0;
		}
	}
</style>
