<script lang="ts">
	import type { PageData } from './$types';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { enhance } from '$app/forms';
	import { replaceState } from '$app/navigation';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import {
		BOOKING_FILTERS,
		BOOKING_SORTS,
		bookingState,
		countBookings,
		defaultView,
		guestLabel,
		isBookingFilter,
		isBookingSort,
		placeLabel,
		visibleBookings,
		type BookingFilter,
		type BookingRow,
		type BookingSort
	} from '$lib/bookings';
	import { PHASE_ICONS, PHASE_LABELS, formatBerlin } from '$lib/booking-phase';
	import { createLivePoll } from '$lib/live-stats-poll';
	import { createBookingsFeed } from '$lib/live-bookings';
	import { relativeTime } from '$lib/time';
	import { alertDialog, confirmDialog, toast } from '$lib/dialogs';
	import { actionErrorMessage } from '$lib/admin-actions';

	export let data: PageData;
	$: ({ phase, houses } = data);

	// The view: from the link that led here (?house=…&show=…&sort=…), else what
	// fits the phase. The search text never goes into the address (guest names
	// don't belong in server logs).
	const params = page.url.searchParams;
	const fallback = defaultView(data.phase);
	let filter: BookingFilter = isBookingFilter(params.get('show'))
		? (params.get('show') as BookingFilter)
		: fallback.filter;
	let sort: BookingSort = isBookingSort(params.get('sort'))
		? (params.get('sort') as BookingSort)
		: fallback.sort;
	let houseId = params.get('house') ?? '';
	let search = '';

	// Live: the numbers poll notices every booking and check-in; only then are
	// the rows asked for again ($lib/live-bookings.ts).
	const poll = createLivePoll();
	const feed = createBookingsFeed({ initial: data.bookings ?? [], changedAt: null });
	$: feed.reset(data.bookings ?? [], null);
	$: feed.follow($poll.stats);
	onMount(() => poll.start());

	let now = Date.now();
	onMount(() => {
		const timer = setInterval(() => (now = Date.now()), 30_000);
		return () => clearInterval(timer);
	});

	$: rows = $feed.rows;
	// A house that vanished (deleted by another admin) drops the filter.
	$: if (houseId && !houses.some((house) => house.id === houseId)) houseId = '';
	$: inHouse = houseId ? rows.filter((row) => row.houseId === houseId) : rows;
	$: counts = countBookings(inHouse);
	$: shown = visibleBookings(rows, { houseId, filter, sort, search });
	$: houseName = houses.find((house) => house.id === houseId)?.name ?? '';

	// Keep the address in step, so a reload or a shared link opens the same view.
	let mounted = false;
	onMount(() => (mounted = true));
	$: if (mounted) keepInAddress(houseId, filter, sort);
	function keepInAddress(house: string, show: BookingFilter, order: BookingSort) {
		const next = new URLSearchParams();
		if (house) next.set('house', house);
		if (show !== fallback.filter) next.set('show', show);
		if (order !== fallback.sort) next.set('sort', order);
		const query = next.toString();
		if (query === page.url.searchParams.toString()) return;
		replaceState(query ? `?${query}` : page.url.pathname, {});
	}

	const COUNT_TILES = [
		{ key: 'all', label: 'booked', state: 'full', value: (c: typeof counts) => c.booked },
		{
			key: 'checkedin',
			label: 'checked in',
			state: 'checked-in',
			value: (c: typeof counts) => c.checkedIn
		},
		{
			key: 'arriving',
			label: 'still to arrive',
			state: 'filling',
			value: (c: typeof counts) => c.arriving
		},
		{
			key: 'crew',
			label: 'held by the crew',
			state: 'locked',
			value: (c: typeof counts) => c.crew + c.viaRequest
		}
	] as const;

	const PHASE_NOTE: Record<typeof data.phase, string> = {
		staging:
			"Booking hasn't opened yet. What shows here are spots the crew holds (taken without a ticket, ♿ assigned to a request) and test bookings.",
		live: 'Live Booking: new bookings, moves and releases show up here within seconds.',
		closed:
			'Booking is closed: the guests arrive. Check them in at the check-in desk with their pass — or here, if a guest has no pass with them.'
	};

	// ---- check in / undo ---------------------------------------------------------

	let busy: string | null = null;

	function stepAction(row: BookingRow, kind: 'checkin' | 'undo'): SubmitFunction {
		return async ({ cancel }) => {
			const name = guestLabel(row.guest);
			const where = placeLabel(row);
			const confirmed =
				kind === 'checkin'
					? await confirmDialog(
							`${name} on ${where}. Without the booking pass this list is the only check: compare the name with the guest before you confirm.`,
							{
								title: 'Check this guest in?',
								confirmLabel: 'Check in',
								cancelLabel: 'Not yet'
							}
						)
					: await confirmDialog(
							`${name} on ${where} counts as not arrived again. The booking stays; the crew chat gets a note.`,
							{
								title: 'Take the check-in back?',
								tone: 'danger',
								confirmLabel: 'Undo check-in',
								cancelLabel: 'Keep it'
							}
						);
			if (!confirmed) {
				cancel();
				return;
			}
			busy = row.bedId;
			return async ({ result, update }) => {
				busy = null;
				if (result.type === 'success') {
					const step = (result.data as { step?: { status: string } } | undefined)?.step;
					const status = step?.status;
					toast(
						status === 'checkedin'
							? `✅ ${name} is checked in.`
							: status === 'already'
								? `☑️ ${name} was already checked in.`
								: status === 'undone'
									? `↩️ The check-in of ${name} was taken back.`
									: `${name} wasn't checked in; nothing to undo.`,
						status === 'checkedin' || status === 'undone' ? 'success' : 'info'
					);
				} else {
					await alertDialog(
						`${actionErrorMessage(result) || 'The server could not be reached.'} Nothing was changed.`,
						{
							title: kind === 'checkin' ? 'Not checked in' : 'Check-in not undone',
							tone: 'danger'
						}
					);
				}
				await update({ reset: false });
			};
		};
	}

	const stamp = (iso: string) => (iso ? formatBerlin(iso, { year: false }) : '');
</script>

<svelte:head>
	<title>Bookings · CozyNights</title>
</svelte:head>

<div class="bookings-page">
	<header class="page-header">
		<div>
			<h1>Bookings & check-ins 🛏️</h1>
			<p class="subtitle">Who sleeps where, who is here, who is still on the road</p>
		</div>
		<span class="phase-chip" data-state={phase}>
			{PHASE_ICONS[phase]}
			{PHASE_LABELS[phase]}
		</span>
	</header>

	<p class="phase-note state-ring" data-state={phase}>{PHASE_NOTE[phase]}</p>

	{#if data.bookings === null && rows.length === 0}
		<p class="error-banner" role="alert">
			The bookings could not be read from the database. Reload the page in a minute.
		</p>
	{/if}

	<div class="count-tiles" role="group" aria-label="Show">
		{#each COUNT_TILES as tile (tile.key)}
			<button
				type="button"
				class="count"
				data-state={tile.state}
				aria-pressed={filter === tile.key}
				on:click={() => (filter = filter === tile.key && tile.key !== 'all' ? 'all' : tile.key)}
			>
				<span class="count-value">{tile.value(counts)}</span>
				<span class="count-label">{tile.label}</span>
			</button>
		{/each}
	</div>

	<div class="filters">
		<label class="field">
			<span>House</span>
			<select bind:value={houseId}>
				<option value="">All houses ({houses.length})</option>
				{#each houses as house (house.id)}
					<option value={house.id}>{house.name}</option>
				{/each}
			</select>
		</label>
		<label class="field">
			<span>Show</span>
			<select bind:value={filter}>
				{#each BOOKING_FILTERS as option (option.key)}
					<option value={option.key} title={option.title}>{option.label}</option>
				{/each}
			</select>
		</label>
		<label class="field">
			<span>Order</span>
			<select bind:value={sort}>
				{#each BOOKING_SORTS as option (option.key)}
					<option value={option.key}>{option.label}</option>
				{/each}
			</select>
		</label>
		<label class="field grow">
			<span>Find a guest or spot</span>
			<input
				type="search"
				bind:value={search}
				placeholder="Name, burner name, spot, room, house"
				autocomplete="off"
				enterkeyhint="search"
			/>
		</label>
	</div>

	<p class="result-line" aria-live="polite">
		{shown.length}
		{shown.length === 1 ? 'spot' : 'spots'}
		{#if houseName}in <strong>{houseName}</strong>{/if}
		{#if $poll.status === 'live'}<span class="live">· live</span
			>{:else if $poll.status === 'offline'}<span class="offline"
				>· no connection, the list may be out of date</span
			>{/if}
		{#if $feed.failed}<span class="offline">· the last update failed</span>{/if}
	</p>

	{#if shown.length === 0}
		<p class="empty">
			{#if rows.length === 0}
				{phase === 'staging'
					? 'Nothing is booked yet.'
					: phase === 'live'
						? 'No guest has booked a spot yet.'
						: 'Nobody holds a spot.'}
			{:else}
				No booking matches{search ? ` "${search}"` : ''}. Try another filter.
			{/if}
		</p>
	{:else}
		<div class="booking-head" aria-hidden="true">
			<span>Guest</span>
			<span>Spot</span>
			<span>Booked</span>
			<span>Check-in</span>
			<span></span>
		</div>
		<ul class="booking-list">
			{#each shown as row (row.bedId)}
				{@const state = bookingState(row)}
				<li
					class="booking-row"
					data-state={state === 'checkedin' ? 'checked-in' : state === 'booked' ? 'full' : 'locked'}
				>
					<div class="cell guest">
						<span class="guest-name">{guestLabel(row.guest)}</span>
						{#if row.guest?.name && row.guest.burnerName}
							<span class="guest-burner">🔥 {row.guest.burnerName}</span>
						{/if}
						{#if row.guest}
							<span class="guest-meta"
								>{row.guest.email || 'no e-mail'} · Ticket {row.guest.ticket}</span
							>
						{:else}
							<span class="guest-meta">Taken by the crew, without a ticket</span>
						{/if}
						{#if row.viaRequest}
							<span class="tag special">♿ assigned through a request</span>
						{/if}
					</div>
					<div class="cell place">
						<a href="/admin/room/{row.roomId}">{placeLabel(row)}</a>
						{#if !row.enabled}<span class="tag warn">deactivated spot</span>{/if}
						{#if row.enabled && row.locked}<span class="tag warn">locked spot</span>{/if}
					</div>
					<div class="cell when">
						<span class="cell-label">Booked</span>
						{#if row.bookedAt}
							<span>{stamp(row.bookedAt)}</span>
							<span class="muted">{relativeTime(row.bookedAt, now)}</span>
						{:else}
							<span class="muted">—</span>
						{/if}
					</div>
					<div class="cell checkin">
						<span class="cell-label">Check-in</span>
						{#if row.checkIn}
							<span class="done">✅ {stamp(row.checkIn.at)}</span>
							{#if row.checkIn.by}<span class="muted">by {row.checkIn.by}</span>{/if}
						{:else if row.guest}
							<span class="waiting">Still to arrive</span>
						{:else}
							<span class="muted">—</span>
						{/if}
					</div>
					<div class="cell actions">
						{#if row.guest}
							<form
								method="POST"
								action={row.checkIn ? '?/undo' : '?/checkin'}
								use:enhance={stepAction(row, row.checkIn ? 'undo' : 'checkin')}
							>
								<input type="hidden" name="order" value={row.guest.orderId} />
								<button
									type="submit"
									class="btn-step"
									class:undo={!!row.checkIn}
									disabled={busy === row.bedId}
								>
									{row.checkIn ? 'Undo' : 'Check in'}
								</button>
							</form>
							<form method="POST" action="/admin/tickets?/open">
								<input type="hidden" name="ticket" value={row.guest.orderId} />
								<button type="submit" class="btn-ticket" title="The full ticket card"
									>Ticket →</button
								>
							</form>
						{/if}
					</div>
				</li>
			{/each}
		</ul>
	{/if}
</div>

<style>
	.bookings-page {
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
		min-width: 0;
		color: #fff;
	}
	.page-header {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem 1.5rem;
		padding-bottom: 1rem;
		border-bottom: 1px solid #1a1a1a;
	}
	h1 {
		margin: 0;
		font-size: 2rem;
		font-weight: 900;
		letter-spacing: -1px;
	}
	.subtitle {
		margin: 0.25rem 0 0;
		color: #777;
		font-size: 0.85rem;
		font-weight: 700;
	}
	.phase-chip {
		padding: 0.35rem 0.9rem;
		border-radius: 999px;
		border: 1px solid var(--state);
		color: var(--state);
		background: var(--state-soft);
		font-size: 0.75rem;
		font-weight: 900;
		letter-spacing: 1px;
		text-transform: uppercase;
		white-space: nowrap;
	}
	.phase-note {
		margin: 0;
		padding: 0.75rem 1rem;
		border-radius: 12px;
		background: var(--state-soft);
		color: #d4d4d4;
		font-size: 0.85rem;
		line-height: 1.5;
	}
	.error-banner {
		margin: 0;
		padding: 0.75rem 1rem;
		border-radius: 12px;
		border: 1px solid #f87171;
		background: rgba(248, 113, 113, 0.1);
		color: #fecaca;
		font-weight: 700;
	}

	.count-tiles {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(9rem, 100%), 1fr));
		gap: 0.75rem;
	}
	.count {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.15rem;
		min-height: 44px;
		padding: 0.75rem 1rem;
		border-radius: 12px;
		border: 1px solid #1f1f1f;
		background: var(--state-soft);
		cursor: pointer;
		font: inherit;
		text-align: left;
	}
	.count:hover,
	.count[aria-pressed='true'] {
		border-color: var(--state);
	}
	.count[aria-pressed='true'] {
		box-shadow: 0 0 0 1px var(--state) inset;
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

	.filters {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
		align-items: flex-end;
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		min-width: 0;
		flex: 0 1 12rem;
	}
	.field.grow {
		flex: 1 1 16rem;
	}
	.field span {
		font-size: 0.6rem;
		font-weight: 900;
		letter-spacing: 1.5px;
		text-transform: uppercase;
		color: #777;
	}
	.field select,
	.field input {
		min-height: 44px;
		box-sizing: border-box;
		width: 100%;
		padding: 0 0.75rem;
		border-radius: 10px;
		border: 1px solid #262626;
		background: #0d0d0d;
		color: #fff;
		font: inherit;
		font-size: 0.85rem;
	}
	.field select:focus,
	.field input:focus {
		outline: none;
		border-color: #2dd4bf;
	}

	.result-line {
		margin: 0;
		font-size: 0.8rem;
		color: #a3a3a3;
	}
	.result-line .live {
		color: var(--state-open);
	}
	.result-line .offline {
		color: var(--state-filling);
	}
	.empty {
		margin: 0;
		padding: 2rem 1rem;
		text-align: center;
		color: #777;
		border: 1px dashed #222;
		border-radius: 16px;
	}

	/* A table on wide screens (the same columns in every row), cards below. */
	.booking-head,
	.booking-row {
		display: grid;
		grid-template-columns:
			minmax(12rem, 1.4fr) minmax(10rem, 1.2fr) minmax(8rem, 0.8fr) minmax(9rem, 0.9fr)
			minmax(8rem, auto);
		gap: 0.75rem 1rem;
		align-items: start;
	}
	.booking-head {
		padding: 0 1rem;
		font-size: 0.6rem;
		font-weight: 900;
		letter-spacing: 1.5px;
		text-transform: uppercase;
		color: #666;
	}
	.booking-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.booking-row {
		padding: 0.85rem 1rem;
		border-radius: 12px;
		border: 1px solid #1c1c1c;
		border-left: 3px solid var(--state);
		background: #0a0a0a;
	}
	.cell {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		min-width: 0;
		font-size: 0.8rem;
	}
	.cell-label {
		display: none;
		font-size: 0.6rem;
		font-weight: 900;
		letter-spacing: 1.5px;
		text-transform: uppercase;
		color: #666;
	}
	.guest-name {
		font-weight: 800;
		font-size: 0.95rem;
		overflow-wrap: anywhere;
	}
	.guest-burner {
		color: #fda4af;
		font-weight: 700;
		overflow-wrap: anywhere;
	}
	.guest-meta,
	.muted {
		color: #8a8a8a;
		font-size: 0.72rem;
		overflow-wrap: anywhere;
	}
	.place a {
		color: #2dd4bf;
		font-weight: 700;
		text-decoration: none;
		overflow-wrap: anywhere;
	}
	.place a:hover {
		text-decoration: underline;
	}
	.tag {
		align-self: flex-start;
		padding: 0.1rem 0.5rem;
		border-radius: 999px;
		font-size: 0.65rem;
		font-weight: 800;
	}
	.tag.special {
		color: var(--state-special);
		background: var(--state-special-soft);
	}
	.tag.warn {
		color: var(--state-filling);
		background: var(--state-filling-soft);
	}
	.done {
		color: var(--state-checked-in);
		font-weight: 800;
	}
	.waiting {
		color: var(--state-filling);
		font-weight: 800;
	}
	.actions {
		flex-direction: row;
		flex-wrap: wrap;
		justify-content: flex-end;
		gap: 0.4rem;
	}
	.actions form {
		display: flex;
	}
	.btn-step,
	.btn-ticket {
		min-height: 40px;
		padding: 0 0.85rem;
		border-radius: 8px;
		font: inherit;
		font-size: 0.75rem;
		font-weight: 900;
		cursor: pointer;
		white-space: nowrap;
	}
	.btn-step {
		border: 1px solid var(--state-checked-in);
		background: var(--state-checked-in-soft);
		color: var(--state-checked-in);
	}
	.btn-step.undo {
		border-color: #444;
		background: transparent;
		color: #aaa;
	}
	.btn-step:disabled {
		opacity: 0.5;
		cursor: progress;
	}
	.btn-ticket {
		border: 1px solid #333;
		background: transparent;
		color: #2dd4bf;
	}
	.btn-step:hover:not(:disabled),
	.btn-ticket:hover {
		filter: brightness(1.2);
	}

	@media (max-width: 1250px) {
		.booking-head {
			display: none;
		}
		.booking-row {
			grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
		}
		.cell.guest,
		.cell.place {
			grid-column: 1 / -1;
		}
		.cell.actions {
			grid-column: 1 / -1;
			justify-content: flex-start;
		}
		.cell-label {
			display: block;
		}
	}
	@media (max-width: 640px) {
		h1 {
			font-size: 1.6rem;
		}
		.booking-row {
			grid-template-columns: minmax(0, 1fr);
		}
	}
</style>
