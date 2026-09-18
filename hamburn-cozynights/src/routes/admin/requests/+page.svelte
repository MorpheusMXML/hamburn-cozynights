<!--
Special-needs requests (docs/admin/special-needs.md): read, approve or
decline, assign a spot. Assigning books even while booking is closed.
What guests wrote may be health data; it is shown here and nowhere else.
-->
<script lang="ts">
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import type { PageData } from './$types';
	import { confirmDialog, toast } from '$lib/dialogs';
	import { STATUS_LABELS, needLabel, type AdminRequestView } from '$lib/special-needs';

	export let data: PageData;

	let busy = '';
	// The spot picked in each request's list, by request id.
	let picked: Record<string, string> = {};

	$: waiting = data.requests.filter((r) => r.status === 'pending');
	$: approved = data.requests.filter((r) => r.status === 'approved');
	$: declined = data.requests.filter((r) => r.status === 'declined');
	$: specialSpots = data.spots.filter((s) => s.special);
	$: otherSpots = data.spots.filter((s) => !s.special);

	const NO_CONNECTION = 'We could not reach the server, so nothing was changed. Try again.';

	type Confirmation = { title: string; message: string; label: string };

	/**
	 * Enhance with an optional confirmation, a busy marker and a toast. The
	 * confirmation is built when the form is sent: the enhance callback is set
	 * up once, and the page data may have changed since.
	 */
	function act(
		key: string,
		done: string | ((data: Record<string, unknown>) => string),
		confirmation?: () => Confirmation
	): SubmitFunction {
		return async ({ cancel }) => {
			if (confirmation) {
				const { title, message, label } = confirmation();
				const ok = await confirmDialog(message, {
					title,
					tone: 'warning',
					confirmLabel: label,
					cancelLabel: 'Cancel'
				});
				if (!ok) {
					cancel();
					return;
				}
			}
			busy = key;
			return async ({ result, update }) => {
				busy = '';
				if (result.type === 'failure') {
					const message = (result.data as { error?: string } | undefined)?.error;
					toast(message || 'That did not work. Reload the page and try again.', 'danger', 8000);
					await update({ reset: false });
					return;
				}
				if (result.type === 'error') {
					toast(NO_CONNECTION, 'danger');
					return;
				}
				const payload = result.type === 'success' ? (result.data ?? {}) : {};
				toast(typeof done === 'string' ? done : done(payload), 'success');
				await update();
			};
		};
	}

	function when(value: string) {
		const date = new Date(value.replace(' ', 'T'));
		if (Number.isNaN(date.getTime())) return '';
		return new Intl.DateTimeFormat('en-GB', {
			timeZone: 'Europe/Berlin',
			day: 'numeric',
			month: 'short',
			hour: '2-digit',
			minute: '2-digit'
		}).format(date);
	}

	function who(request: AdminRequestView) {
		return request.ticket.name || 'Ticket without a name';
	}

	/** consent_at is renewed each time the guest sends the form; admin decisions don't touch it. */
	function changedByGuest(request: AdminRequestView) {
		const sent = Date.parse(request.sentAt.replace(' ', 'T'));
		const changed = Date.parse(request.consentAt.replace(' ', 'T'));
		return changed - sent > 60_000;
	}

	const current = (id: string) => data.requests.find((r) => r.id === id);

	function assignConfirmation(id: string): Confirmation {
		const request = current(id);
		const spot = data.spots.find((s) => s.bedId === picked[id])?.label ?? 'The spot';
		const from = request?.spot ? `, and ${request.spot.label} becomes free` : '';
		const closed = data.isBookingActive ? '' : ', although booking is closed';
		const approves = request?.status === 'pending' ? ' The request is approved as well.' : '';
		return {
			title: request?.spot ? 'Move the guest?' : 'Book this spot for the guest?',
			message: `${spot} is booked for this ticket right away${closed}${from}. The guest gets a message with the booking pass.${approves}`,
			label: 'Book it'
		};
	}

	function releaseConfirmation(id: string): Confirmation {
		const spot = current(id)?.spot;
		const stays = spot?.special ? ' (it stays a special-needs spot)' : '';
		return {
			title: 'Release this spot?',
			message: `${spot?.label ?? 'The spot'} becomes free again${stays}, and the guest gets a message. The request stays approved.`,
			label: 'Release spot'
		};
	}

	const declineConfirmation = (): Confirmation => ({
		title: 'Decline this request?',
		message:
			'The guest gets a message that the crew cannot offer a special-needs spot. They can book like everyone else when booking opens.',
		label: 'Decline'
	});
</script>

<svelte:head>
	<title>Special needs · CozyNights Admin</title>
</svelte:head>

<div class="requests-page">
	<a href="/admin" class="back">← Control Center</a>
	<h1>Special-needs requests ♿</h1>
	<p class="intro">
		Guests ask for a fitting spot with their ticket code, also before booking opens. Approve or
		decline, then assign a spot: that books it for the guest right away, in Staging Mode too. The
		guest gets a message about each decision and the booking.
	</p>

	<section class="switch-card" class:open={data.requestsOpen}>
		<div>
			<h2>Requests from guests: {data.requestsOpen ? 'OPEN' : 'CLOSED'}</h2>
			<p>
				{data.requestsOpen
					? 'Guests see a link on the map and can send or change a request.'
					: 'Guests cannot send new requests. Waiting requests stay, and guests can still withdraw theirs.'}
				Independent of Staging Mode and Live Booking.
			</p>
		</div>
		<form
			method="POST"
			action="?/toggleRequests"
			use:enhance={act('switch', (result) =>
				result.requestsOpen ? 'Requests are open.' : 'Requests are closed.'
			)}
		>
			<input type="hidden" name="open" value={String(!data.requestsOpen)} />
			<button type="submit" class="btn" class:primary={!data.requestsOpen} disabled={!!busy}>
				{data.requestsOpen ? 'Close requests' : 'Open requests'}
			</button>
		</form>
	</section>

	<p class="privacy-note">
		🔏 What guests write here may be about their health. Only admins can read it. Don't copy it into
		chats or e-mails; talk about it in person. Everything is deleted after the event.
	</p>

	{#if data.requests.length === 0}
		<p class="empty">No requests yet.</p>
	{/if}

	{#each [{ title: 'Waiting for a decision', list: waiting }, { title: 'Approved', list: approved }, { title: 'Declined', list: declined }] as group}
		{#if group.list.length > 0}
			<section class="group">
				<h2>{group.title} <span class="count">{group.list.length}</span></h2>

				{#each group.list as request (request.id)}
					<article class="request status-{request.status}">
						<header>
							<div>
								<h3>{who(request)}</h3>
								{#if request.ticket.email}
									<a class="mail" href="mailto:{request.ticket.email}">{request.ticket.email}</a>
								{/if}
							</div>
							<span class="badge">{STATUS_LABELS[request.status]}</span>
						</header>

						<ul class="needs">
							{#each request.needs as need}
								<li>{needLabel(need)}</li>
							{/each}
						</ul>

						<details open={request.status === 'pending'}>
							<summary>What the guest wrote</summary>
							<p class="text">{request.text || '(nothing readable)'}</p>
						</details>

						<dl>
							<dt>Sent</dt>
							<dd>
								{when(request.sentAt)}{changedByGuest(request)
									? ` · changed ${when(request.consentAt)}`
									: ''}
							</dd>
							{#if request.burnerName}
								<dt>Burner name</dt>
								<dd>{request.burnerName}</dd>
							{/if}
							{#if request.decidedBy}
								<dt>{request.status === 'declined' ? 'Declined' : 'Approved'}</dt>
								<dd>{request.decidedBy} · {when(request.decidedAt)}</dd>
							{/if}
							<dt>Spot</dt>
							<dd>
								{#if request.spot}
									<a href="/admin/room/{request.spot.roomId}">{request.spot.label}</a>
									{#if request.spot.special}♿{/if}{#if request.spot.locked}🔒{/if}
								{:else}
									No spot yet
								{/if}
							</dd>
						</dl>

						<div class="actions">
							{#if request.status === 'pending' || request.status === 'declined'}
								<form method="POST" action="?/approve" use:enhance={act(request.id, 'Approved.')}>
									<input type="hidden" name="id" value={request.id} />
									<button class="btn primary" disabled={!!busy}>Approve</button>
								</form>
							{/if}
							{#if request.status === 'pending' || (request.status === 'approved' && !request.spot)}
								<form
									method="POST"
									action="?/decline"
									use:enhance={act(request.id, 'Declined.', declineConfirmation)}
								>
									<input type="hidden" name="id" value={request.id} />
									<button class="btn" disabled={!!busy}>Decline</button>
								</form>
							{/if}
							{#if request.status === 'approved' && request.spot}
								<form
									method="POST"
									action="?/release"
									use:enhance={act(request.id, 'The spot is released.', () =>
										releaseConfirmation(request.id)
									)}
								>
									<input type="hidden" name="id" value={request.id} />
									<button class="btn" disabled={!!busy}>Release spot</button>
								</form>
							{/if}
						</div>

						{#if request.status !== 'declined'}
							<form
								method="POST"
								action="?/assign"
								class="assign"
								use:enhance={act(request.id, 'The spot is booked for the guest.', () =>
									assignConfirmation(request.id)
								)}
							>
								<input type="hidden" name="id" value={request.id} />
								<label for="spot-{request.id}">{request.spot ? 'Move to' : 'Assign a spot'}</label>
								<div class="row">
									<select id="spot-{request.id}" name="bedId" bind:value={picked[request.id]}>
										<option value="">Pick a free spot…</option>
										{#if specialSpots.length > 0}
											<optgroup label="♿ Special-needs spots">
												{#each specialSpots as spot}
													<option value={spot.bedId}>{spot.label}{spot.locked ? ' 🔒' : ''}</option>
												{/each}
											</optgroup>
										{/if}
										{#if otherSpots.length > 0}
											<optgroup label="Other free spots">
												{#each otherSpots as spot}
													<option value={spot.bedId}>{spot.label}{spot.locked ? ' 🔒' : ''}</option>
												{/each}
											</optgroup>
										{/if}
									</select>
									<button class="btn primary" disabled={!!busy || !picked[request.id]}>
										{request.status === 'pending'
											? 'Approve & book'
											: request.spot
												? 'Move'
												: 'Book'}
									</button>
								</div>
								{#if data.spots.length === 0}
									<p class="hint">No free spot left. Free or add one in the room editor.</p>
								{/if}
							</form>
						{/if}
					</article>
				{/each}
			</section>
		{/if}
	{/each}
</div>

<style>
	.requests-page {
		max-width: 860px;
		margin: 0 auto;
		padding: clamp(1rem, 4vw, 2rem);
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
	}
	.back {
		color: #2dd4bf;
		font-weight: 800;
		text-decoration: none;
		font-size: 0.85rem;
		letter-spacing: 0.05em;
		text-transform: uppercase;
	}
	h1 {
		margin: 0;
		font-weight: 900;
		font-size: clamp(1.5rem, 5vw, 2rem);
	}
	.intro,
	.privacy-note,
	.empty {
		margin: 0;
		color: #b5b5b5;
		line-height: 1.5;
	}
	.privacy-note {
		font-size: 0.9rem;
		padding: 0.75rem 1rem;
		border: 1px dashed #3f3f46;
		border-radius: 12px;
	}

	.switch-card {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: 1rem 1.25rem;
		border-radius: 16px;
		background: #111;
		border: 1px solid #333;
		border-left: 4px solid #737373;
	}
	.switch-card.open {
		border-left-color: #f472b6;
	}
	.switch-card h2 {
		margin: 0 0 0.25rem;
		font-size: 1rem;
		font-weight: 900;
		letter-spacing: 0.05em;
	}
	.switch-card p {
		margin: 0;
		color: #a3a3a3;
		font-size: 0.9rem;
		line-height: 1.45;
		max-width: 36rem;
	}

	.group h2 {
		font-size: 1.1rem;
		font-weight: 900;
		margin: 0.5rem 0 0.75rem;
	}
	.count {
		display: inline-block;
		min-width: 1.6rem;
		padding: 0 0.4rem;
		border-radius: 999px;
		background: #27272a;
		color: #fff;
		font-size: 0.85rem;
		text-align: center;
	}

	.request {
		background: #111;
		border: 1px solid #262626;
		border-left: 4px solid #fb923c;
		border-radius: 16px;
		padding: 1rem 1.25rem;
		margin-bottom: 1rem;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	.request.status-approved {
		border-left-color: #2dd4bf;
	}
	.request.status-declined {
		border-left-color: #525252;
	}
	.request header {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 1rem;
	}
	.request h3 {
		margin: 0;
		font-size: 1.05rem;
	}
	.mail {
		color: #2dd4bf;
		font-size: 0.9rem;
		overflow-wrap: anywhere;
	}
	.badge {
		flex: none;
		font-size: 0.75rem;
		font-weight: 800;
		padding: 0.25rem 0.6rem;
		border-radius: 999px;
		background: #27272a;
		color: #e5e5e5;
	}
	.needs {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.needs li {
		font-size: 0.85rem;
		padding: 0.25rem 0.6rem;
		border-radius: 999px;
		border: 1px solid #f472b6;
		color: #f9a8d4;
	}
	summary {
		cursor: pointer;
		color: #a3a3a3;
		font-weight: 700;
		min-height: 32px;
	}
	.text {
		white-space: pre-line;
		overflow-wrap: anywhere;
		margin: 0.5rem 0 0;
		padding: 0.75rem 1rem;
		background: #0a0a0a;
		border-radius: 10px;
		line-height: 1.5;
	}
	dl {
		display: grid;
		grid-template-columns: max-content 1fr;
		gap: 0.3rem 1rem;
		margin: 0;
		font-size: 0.9rem;
	}
	dt {
		color: #a3a3a3;
	}
	dd {
		margin: 0;
		overflow-wrap: anywhere;
	}
	dd a {
		color: #2dd4bf;
	}

	.actions,
	.row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.6rem;
	}
	.assign {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		padding-top: 0.75rem;
		border-top: 1px solid #222;
	}
	.assign label {
		font-weight: 800;
		font-size: 0.8rem;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		color: #a3a3a3;
	}
	select {
		flex: 1 1 16rem;
		min-height: 44px;
		padding: 0 0.75rem;
		border-radius: 10px;
		border: 1px solid #333;
		background: #0a0a0a;
		color: #fff;
		font: inherit;
	}
	.btn {
		min-height: 44px;
		padding: 0 1.1rem;
		border-radius: 10px;
		border: 1px solid #52525b;
		background: transparent;
		color: #e5e5e5;
		font: inherit;
		font-weight: 800;
		cursor: pointer;
	}
	.btn.primary {
		background: #2dd4bf;
		border-color: #2dd4bf;
		color: #000;
	}
	.btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.hint {
		margin: 0;
		color: #a3a3a3;
		font-size: 0.85rem;
	}
</style>
