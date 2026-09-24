<script lang="ts">
	import type { PageData } from './$types';
	import { replaceState } from '$app/navigation';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import {
		GUEST_FILTERS,
		GUEST_SORTS,
		GUEST_TILES,
		countGuests,
		defaultGuestView,
		guestName,
		guestRowState,
		guestTileState,
		isGuestFilter,
		isGuestSort,
		spotLabel,
		visibleGuests,
		type GuestFilter,
		type GuestRow,
		type GuestSort,
		type GuestWalletState
	} from '$lib/guests';
	import { PHASE_ICONS, PHASE_LABELS, formatBerlin } from '$lib/booking-phase';
	import { createLivePoll } from '$lib/live-stats-poll';
	import type { LiveStats } from '$lib/live-stats';
	import { relativeTime } from '$lib/time';

	export let data: PageData;
	$: ({ phase, houses } = data);

	// The view: from the link that led here (?house=…&show=…&sort=…), else what
	// fits the phase. The search text never goes into the address (guest names
	// don't belong in server logs).
	const params = page.url.searchParams;
	const fallback = defaultGuestView(data.phase);
	let filter: GuestFilter = isGuestFilter(params.get('show'))
		? (params.get('show') as GuestFilter)
		: fallback.filter;
	let sort: GuestSort = isGuestSort(params.get('sort'))
		? (params.get('sort') as GuestSort)
		: fallback.sort;
	let houseId = params.get('house') ?? '';
	let search = '';

	// ---- keeping the rows current ------------------------------------------------
	//
	// The live numbers (/admin/api/stats) notice every booking, move, release
	// and check-in; only when their `changedAt` moved are the rows asked for
	// again (the same idea as $lib/live-bookings.ts, for /admin/api/guests).
	// A hand-over, a new e-mail address, a linked Telegram chat or a pass
	// added to a wallet do NOT move `changedAt` — so the page also asks again
	// when its tab comes back to the front, and the Refresh button asks now.
	const GUESTS_URL = '/admin/api/guests';
	const poll = createLivePoll();
	let rows: GuestRow[] = data.guests ?? [];
	let failed = false;
	let refreshing = false;
	let seen: string | null = null;
	let controller: AbortController | null = null;

	async function refresh() {
		controller?.abort();
		const own = new AbortController();
		controller = own;
		refreshing = true;
		try {
			const response = await fetch(GUESTS_URL, { signal: own.signal });
			if (!response.ok) throw new Error(`guests endpoint answered ${response.status}`);
			const body = (await response.json()) as { guests: GuestRow[] };
			rows = body.guests;
			failed = false;
		} catch (err) {
			if ((err as Error)?.name === 'AbortError') return;
			failed = true;
		} finally {
			// A request this one cut short must not switch the button back on
			// while the newer request is still on its way.
			if (controller === own) refreshing = false;
		}
	}

	function follow(stats: Pick<LiveStats, 'changedAt'> | null) {
		if (!stats?.changedAt) return;
		if (seen === null) {
			seen = stats.changedAt;
			return;
		}
		if (stats.changedAt === seen) return;
		seen = stats.changedAt;
		void refresh();
	}

	// A page load (again after navigation) resets the rows and the baseline.
	$: resetFrom(data.guests);
	function resetFrom(guests: GuestRow[] | null) {
		controller?.abort();
		rows = guests ?? [];
		seen = null;
		failed = false;
	}
	$: follow($poll.stats);

	onMount(() => {
		const stop = poll.start();
		const onVisible = () => {
			if (!document.hidden) void refresh();
		};
		document.addEventListener('visibilitychange', onVisible);
		return () => {
			stop();
			controller?.abort();
			document.removeEventListener('visibilitychange', onVisible);
		};
	});

	let now = Date.now();
	onMount(() => {
		const timer = setInterval(() => (now = Date.now()), 30_000);
		return () => clearInterval(timer);
	});

	// A house that vanished (deleted by another admin) drops the filter.
	$: if (houseId && !houses.some((house) => house.id === houseId)) houseId = '';
	$: inHouse = houseId ? rows.filter((row) => row.spot?.houseId === houseId) : rows;
	$: counts = countGuests(inHouse);
	$: shown = visibleGuests(rows, { houseId, filter, sort, search });
	$: houseName = houses.find((house) => house.id === houseId)?.name ?? '';

	// Keep the address in step, so a reload or a shared link opens the same view.
	let mounted = false;
	onMount(() => (mounted = true));
	$: if (mounted) keepInAddress(houseId, filter, sort);
	function keepInAddress(house: string, show: GuestFilter, order: GuestSort) {
		const next = new URLSearchParams();
		if (house) next.set('house', house);
		if (show !== fallback.filter) next.set('show', show);
		if (order !== fallback.sort) next.set('sort', order);
		const query = next.toString();
		if (query === page.url.searchParams.toString()) return;
		replaceState(query ? `?${query}` : page.url.pathname, {});
	}

	const PHASE_NOTE: Record<typeof data.phase, string> = {
		staging:
			'Booking has not opened yet: the tickets as they were imported, plus the spots the crew assigned to special-needs requests.',
		live: 'Live Booking: every ticket, and who has booked a spot so far.',
		closed:
			'Booking is closed: the guests arrive. A ticket without a spot now needs the crew; the arrivals are on the bookings page.'
	};

	const WALLET_WORDS: Record<Exclude<GuestWalletState, null>, string> = {
		current: 'up to date',
		voided: 'old pass',
		failing: 'update failing'
	};

	const stamp = (iso: string) => (iso ? formatBerlin(iso, { year: false }) : '');
</script>

<svelte:head>
	<title>Guests · CozyNights</title>
</svelte:head>

<div class="guests-page">
	<header class="page-header">
		<div>
			<h1>Guests 👥</h1>
			<p class="subtitle">Every ticket, with everything that belongs to it</p>
		</div>
		<span class="phase-chip" data-state={phase}>
			{PHASE_ICONS[phase]}
			{PHASE_LABELS[phase]}
		</span>
	</header>

	<p class="phase-note state-ring" data-state={phase}>{PHASE_NOTE[phase]}</p>

	{#if data.guests === null && rows.length === 0}
		<p class="error-banner" role="alert">
			The guest list could not be read from the database. Reload the page in a minute.
		</p>
	{/if}

	<div class="count-tiles" role="group" aria-label="Show">
		{#each GUEST_TILES as tile (tile.key)}
			<button
				type="button"
				class="count"
				data-state={guestTileState(tile.key, phase)}
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
				{#each GUEST_FILTERS as option (option.key)}
					<option value={option.key} title={option.title}>{option.label}</option>
				{/each}
			</select>
		</label>
		<label class="field">
			<span>Order</span>
			<select bind:value={sort}>
				{#each GUEST_SORTS as option (option.key)}
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
		<button
			type="button"
			class="btn-refresh"
			on:click={() => void refresh()}
			disabled={refreshing}
			title="Ask the server for the list again (hand-overs and address changes arrive only this way)"
		>
			{refreshing ? 'Refreshing…' : '↻ Refresh'}
		</button>
	</div>

	<p class="result-line" aria-live="polite">
		{shown.length}
		{shown.length === 1 ? 'ticket' : 'tickets'}
		{#if houseName}in <strong>{houseName}</strong>{/if}
		{#if $poll.status === 'live'}<span class="live">· live</span
			>{:else if $poll.status === 'offline'}<span class="offline"
				>· no connection, the list may be out of date</span
			>{/if}
		{#if failed}<span class="offline">· the last update failed</span>{/if}
	</p>

	{#if shown.length === 0}
		<p class="empty">
			{#if rows.length === 0}
				No tickets yet. Load the ticket list on the tickets page.
			{:else}
				No ticket matches{search ? ` "${search}"` : ''}. Try another filter.
			{/if}
		</p>
	{:else}
		<div class="guest-head" aria-hidden="true">
			<span>Guest</span>
			<span>Spot</span>
			<span>Check-in</span>
			<span>Messages</span>
			<span>Wallet</span>
			<span>Ticket</span>
			<span></span>
		</div>
		<ul class="guest-list">
			{#each shown as row (row.id)}
				<li class="guest-row" data-state={guestRowState(row, phase)}>
					<div class="cell guest">
						<span class="guest-name">{guestName(row)}</span>
						{#if row.name && row.burnerName}
							<span class="guest-burner">🔥 {row.burnerName}</span>
						{/if}
						<span class="guest-meta">{row.email || 'no e-mail'} · Ticket {row.ticket}</span>
						{#if !row.hasEmail}<span class="tag danger">no e-mail address</span>{/if}
						{#if row.request === 'pending'}
							<span class="tag special">♿ request waits for a decision</span>
						{:else if row.request === 'approved'}
							<span class="tag special">♿ request approved</span>
						{:else if row.request === 'declined'}
							<span class="tag quiet">♿ request declined</span>
						{/if}
					</div>
					<div class="cell place">
						<span class="cell-label">Spot</span>
						{#if row.spot}
							<a href="/admin/room/{row.spot.roomId}">{spotLabel(row.spot)}</a>
							<span class="muted">booked {stamp(row.spot.bookedAt)}</span>
							{#if row.spot.viaRequest}
								<span class="tag special">♿ assigned through a request</span>
							{:else if row.spot.special}
								<span class="tag special">♿ special-needs spot</span>
							{/if}
						{:else}
							<span class="nospot">No spot</span>
						{/if}
					</div>
					<div class="cell checkin">
						<span class="cell-label">Check-in</span>
						{#if row.checkIn}
							<span class="done">✅ {stamp(row.checkIn.at)}</span>
							{#if row.checkIn.by}<span class="muted">by {row.checkIn.by}</span>{/if}
						{:else if row.spot}
							<span class="muted">not yet</span>
						{:else}
							<span class="muted">—</span>
						{/if}
					</div>
					<div class="cell messages">
						<span class="cell-label">Messages</span>
						{#if row.notify.mailed}
							<span>✉️ mailed to {row.notify.mailedTo || 'the address'}</span>
						{:else}
							<span class="muted">✉️ no e-mail sent</span>
						{/if}
						{#if row.notify.telegram}<span>💬 Telegram linked</span>{/if}
						{#if row.notify.queued}<span class="waiting">⏳ message queued</span>{/if}
						{#if row.notify.failed}<span class="failed">⚠️ delivery failed</span>{/if}
					</div>
					<div class="cell wallet">
						<span class="cell-label">Wallet</span>
						{#if row.wallet.apple}
							<span class:failed={row.wallet.apple === 'failing'}
								>Apple Wallet · {WALLET_WORDS[row.wallet.apple]}</span
							>
						{/if}
						{#if row.wallet.google}
							<span class:failed={row.wallet.google === 'failing'}
								>Google Wallet · {WALLET_WORDS[row.wallet.google]}</span
							>
						{/if}
						{#if !row.wallet.apple && !row.wallet.google}<span class="muted">—</span>{/if}
					</div>
					<div class="cell ticket">
						<span class="cell-label">Ticket</span>
						<span class="muted">imported {stamp(row.imported)}</span>
						{#if row.handedOverAt}
							<span class="muted">handed over {relativeTime(row.handedOverAt, now)}</span>
						{/if}
						<span class="muted">{row.signedIn ? 'signed in' : 'never signed in'}</span>
					</div>
					<div class="cell actions">
						<form method="POST" action="/admin/tickets?/open">
							<input type="hidden" name="ticket" value={row.id} />
							<button type="submit" class="btn-link" title="The full ticket card">Ticket →</button>
						</form>
						{#if row.spot}
							<a class="btn-link" href="/admin/room/{row.spot.roomId}">Room →</a>
						{/if}
						{#if row.request !== 'none'}
							<a class="btn-link" href="/admin/requests">Requests →</a>
						{/if}
					</div>
				</li>
			{/each}
		</ul>
	{/if}
</div>

<style>
	.guests-page {
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
		border: 1px solid var(--state-danger);
		background: var(--state-danger-soft);
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
		min-width: 0;
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
		overflow-wrap: anywhere;
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
	.btn-refresh {
		min-height: 44px;
		padding: 0 0.9rem;
		border-radius: 10px;
		border: 1px solid #333;
		background: transparent;
		color: #2dd4bf;
		font: inherit;
		font-size: 0.8rem;
		font-weight: 900;
		cursor: pointer;
		white-space: nowrap;
	}
	.btn-refresh:hover:not(:disabled) {
		border-color: #2dd4bf;
	}
	.btn-refresh:disabled {
		opacity: 0.5;
		cursor: progress;
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
		overflow-wrap: anywhere;
		border: 1px dashed #222;
		border-radius: 16px;
	}

	/* A table on wide screens (the same columns in every row), cards below. */
	.guest-head,
	.guest-row {
		display: grid;
		grid-template-columns:
			minmax(11rem, 1.4fr) minmax(9rem, 1.1fr) minmax(7rem, 0.8fr) minmax(8rem, 1fr)
			minmax(7rem, 0.8fr) minmax(7rem, 0.8fr) minmax(7rem, auto);
		gap: 0.75rem 1rem;
		align-items: start;
	}
	.guest-head {
		padding: 0 1rem;
		font-size: 0.6rem;
		font-weight: 900;
		letter-spacing: 1.5px;
		text-transform: uppercase;
		color: #666;
	}
	.guest-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.guest-row {
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
	.cell > span {
		overflow-wrap: anywhere;
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
	}
	.guest-burner {
		color: #fda4af;
		font-weight: 700;
	}
	.guest-meta,
	.muted {
		color: #8a8a8a;
		font-size: 0.72rem;
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
	.nospot {
		color: var(--state);
		font-weight: 800;
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
	.tag.danger {
		color: var(--state-danger);
		background: var(--state-danger-soft);
	}
	.tag.quiet {
		color: var(--state-idle);
		background: var(--state-idle-soft);
	}
	.done {
		color: var(--state-checked-in);
		font-weight: 800;
	}
	.waiting {
		color: var(--state-filling);
		font-weight: 800;
	}
	.failed {
		color: var(--state-danger);
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
	.btn-link {
		display: inline-flex;
		align-items: center;
		min-height: 40px;
		padding: 0 0.85rem;
		border-radius: 8px;
		border: 1px solid #333;
		background: transparent;
		color: #2dd4bf;
		font: inherit;
		font-size: 0.75rem;
		font-weight: 900;
		text-decoration: none;
		cursor: pointer;
		white-space: nowrap;
	}
	.btn-link:hover {
		filter: brightness(1.2);
		border-color: #2dd4bf;
	}

	@media (max-width: 1250px) {
		.guest-head {
			display: none;
		}
		.guest-row {
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
	@media (max-width: 720px) {
		h1 {
			font-size: 1.6rem;
		}
		.guest-row {
			grid-template-columns: minmax(0, 1fr);
		}
	}
</style>
