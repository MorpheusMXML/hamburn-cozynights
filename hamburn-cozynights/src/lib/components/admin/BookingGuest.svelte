<script lang="ts">
	import { bookingState, guestLabel, placeLabel, type BookingRow } from '$lib/bookings';
	import { formatBerlin } from '$lib/booking-phase';

	/**
	 * Who holds a booked spot, the way the check-in desk shows a guest: names,
	 * masked e-mail and ticket code, when it was booked, the check-in. Used on
	 * the room and house pages and in the map's house sidebar
	 * (docs/admin/bookings.md).
	 */
	export let row: BookingRow;
	/** One or two lines for tight places (the map sidebar); details in the tooltip. */
	export let compact = false;
	/** Also say where the spot is (lists that mix rooms). */
	export let showPlace = false;
	/** The "Open ticket" button (a POST to /admin/tickets, no id in any URL). */
	export let openTicket = true;

	/** The colour of each state (src/routes/state.css). */
	const STATE_ATTR = { crew: 'locked', booked: 'live', checkedin: 'checked-in' } as const;

	$: state = bookingState(row);
	$: chip = state === 'checkedin' ? '✅ Checked in' : state === 'booked' ? '🎟 Booked' : '🛠 Crew';
	$: name = guestLabel(row.guest);
	$: burner = row.guest && row.guest.name && row.guest.burnerName ? row.guest.burnerName : '';
	$: booked = row.bookedAt ? formatBerlin(row.bookedAt, { year: false }) : '';
	$: checkedIn = row.checkIn ? formatBerlin(row.checkIn.at, { year: false }) : '';
	$: details = [
		row.guest ? [row.guest.email, `Ticket ${row.guest.ticket}`].filter(Boolean).join(' · ') : '',
		booked ? `Booked ${booked}` : '',
		row.checkIn ? `Checked in ${checkedIn}${row.checkIn.by ? ` by ${row.checkIn.by}` : ''}` : '',
		row.viaRequest ? '♿ Assigned through a special-needs request' : ''
	].filter(Boolean);
</script>

<div
	class="booking-guest"
	class:compact
	data-state={STATE_ATTR[state]}
	title={compact ? details.join('\n') : undefined}
>
	<div class="guest-head">
		<span class="guest-chip">{chip}</span>
		<span class="guest-name">{name}</span>
		{#if burner}<span class="guest-burner">🔥 {burner}</span>{/if}
		{#if row.viaRequest}
			<span class="guest-special" title="Assigned through a special-needs request">♿</span>
		{/if}
	</div>

	{#if showPlace}
		<a class="guest-place" href="/admin/room/{row.roomId}">{placeLabel(row)}</a>
	{/if}

	{#if !compact}
		{#if row.guest}
			<p class="guest-meta">
				<span>{row.guest.email || 'no e-mail'}</span>
				<span>Ticket {row.guest.ticket}</span>
				{#if booked}<span>Booked {booked}</span>{/if}
			</p>
		{:else}
			<p class="guest-meta">
				<span>Marked taken by the crew, without a ticket</span>
			</p>
		{/if}
		{#if row.checkIn}
			<p class="guest-meta checkin">
				<span>Checked in {checkedIn}</span>
				{#if row.checkIn.by}<span class="by">by {row.checkIn.by}</span>{/if}
			</p>
		{/if}
		{#if !row.enabled || row.locked}
			<p class="guest-meta warn">
				{!row.enabled ? 'The spot is deactivated.' : 'The spot is locked for guests.'} The booking still
				stands.
			</p>
		{/if}
		{#if openTicket && row.guest}
			<form method="POST" action="/admin/tickets?/open" class="open-ticket">
				<input type="hidden" name="ticket" value={row.guest.orderId} />
				<button type="submit" title="The full ticket card: address, pass code, hand-over">
					Open ticket →
				</button>
			</form>
		{/if}
	{:else if row.checkIn}
		<p class="guest-meta checkin"><span>Checked in {checkedIn}</span></p>
	{/if}
</div>

<style>
	.booking-guest {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		min-width: 0;
		padding: 0.55rem 0.7rem;
		border-radius: 10px;
		border: 1px solid color-mix(in srgb, var(--state) 35%, transparent);
		background: var(--state-soft);
	}
	.booking-guest.compact {
		padding: 0.35rem 0.55rem;
		gap: 0.15rem;
	}
	.guest-head {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.25rem 0.5rem;
		min-width: 0;
	}
	.guest-chip {
		flex-shrink: 0;
		font-size: 0.6rem;
		font-weight: 900;
		letter-spacing: 1px;
		text-transform: uppercase;
		color: var(--state);
		white-space: nowrap;
	}
	.guest-name {
		min-width: 0;
		font-weight: 800;
		color: #fff;
		overflow-wrap: anywhere;
	}
	.guest-burner {
		min-width: 0;
		color: #fda4af;
		font-size: 0.8rem;
		font-weight: 700;
		overflow-wrap: anywhere;
	}
	.guest-special {
		flex-shrink: 0;
	}
	.guest-place {
		font-size: 0.75rem;
		font-weight: 700;
		color: #2dd4bf;
		text-decoration: none;
		overflow-wrap: anywhere;
	}
	.guest-place:hover {
		text-decoration: underline;
	}
	.guest-meta {
		margin: 0;
		display: flex;
		flex-wrap: wrap;
		gap: 0.15rem 0.75rem;
		font-size: 0.72rem;
		color: #a3a3a3;
		min-width: 0;
	}
	.guest-meta span {
		min-width: 0;
		overflow-wrap: anywhere;
	}
	.guest-meta.checkin {
		color: var(--state-checked-in);
		font-weight: 700;
	}
	.guest-meta.checkin .by {
		color: #7dd3c8;
		font-weight: 500;
	}
	.guest-meta.warn {
		color: var(--state-filling);
	}
	.open-ticket {
		margin: 0.15rem 0 0;
	}
	.open-ticket button {
		min-height: 36px;
		padding: 0.3rem 0.8rem;
		border-radius: 8px;
		border: 1px solid #2dd4bf;
		background: transparent;
		color: #2dd4bf;
		font-size: 0.72rem;
		font-weight: 900;
		letter-spacing: 0.5px;
		cursor: pointer;
	}
	.open-ticket button:hover {
		background: rgba(45, 212, 191, 0.1);
	}
</style>
