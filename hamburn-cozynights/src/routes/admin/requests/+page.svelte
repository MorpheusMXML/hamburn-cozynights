<!--
Special-needs requests (docs/admin/special-needs.md): read, approve or
decline, assign a spot. Assigning books even while booking is closed, and it
is the only way a ♿ special-needs spot gets booked: the ♿ panel lists every
one with its state, so none goes missing from the picker unexplained.
Request groups get a card each above the lists, to decide and book for the
whole group; every member's own card still works on its own.
A declined request can still be approved, from the ⋯ menu on its card:
deliberately out of the way. What guests wrote may be health data; it is
shown here and nowhere else.
-->
<script lang="ts">
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import type { ActionData, PageData } from './$types';
	import { confirmDialog, toast } from '$lib/dialogs';
	import {
		STATUS_LABELS,
		isProjectNeed,
		needLabel,
		requestKinds,
		type AdminRequestView,
		type SpecialNeed
	} from '$lib/special-needs';
	import GroupCard from '$lib/components/admin/requests/GroupCard.svelte';
	import SpecialSpots from '$lib/components/admin/requests/SpecialSpots.svelte';
	import SpotSelect from '$lib/components/admin/requests/SpotSelect.svelte';

	export let data: PageData;
	// Without JavaScript a refused step comes back here (with it: a toast).
	export let form: ActionData;

	let busy = '';

	$: waiting = data.requests.filter((r) => r.status === 'pending');
	$: approved = data.requests.filter((r) => r.status === 'approved');
	$: declined = data.requests.filter((r) => r.status === 'declined');
	$: groupNames = new Map(data.groups.map((group) => [group.id, group.name]));

	// The ♿ spots: how many are free, and why the others aren't (for the
	// picker's line when none is free, and the capacity box).
	$: specialTotal = data.specialSpots.length;
	$: specialFree = data.specialSpots.filter((spot) => spot.state === 'free').length;
	$: specialSummary = summarizeSpecial(data.specialSpots.map((spot) => spot.state));
	// Same "open" as the load: waiting, or approved without a spot from the crew.
	$: specialAsked = data.requests.filter(
		(r) =>
			(r.status === 'pending' || (r.status === 'approved' && !r.spot?.assigned)) &&
			requestKinds(r.needs).access
	).length;

	/** "3 marked — 1 booked by a guest, 1 blocked with TAKEN, 1 inactive"; '' when none is marked. */
	function summarizeSpecial(states: string[]): string {
		if (states.length === 0) return '';
		const n = (state: string) => states.filter((s) => s === state).length;
		const parts = [
			[n('request'), 'booked through a request', 'booked through requests'],
			[n('booked'), 'booked by a guest', 'booked by guests'],
			[n('blocked'), 'blocked with TAKEN', 'blocked with TAKEN'],
			[n('inactive'), 'inactive', 'inactive']
		] as const;
		const why = parts
			.filter(([count]) => count > 0)
			.map(([count, one, many]) => `${count} ${count === 1 ? one : many}`);
		return `${states.length} marked${why.length > 0 ? ` — ${why.join(', ')}` : ''}`;
	}

	/** A need of an art project or crew: a neutral pill with its own icon, not the ♿ pink. */
	const PROJECT_ICONS: Record<string, string> = { own_room: '🎨', close_together: '👥' };
	const pillText = (need: SpecialNeed) =>
		isProjectNeed(need)
			? `${PROJECT_ICONS[need] ?? ''} ${needLabel(need)}`.trim()
			: needLabel(need);

	const NO_CONNECTION = 'We could not reach the server, so nothing was changed. Try again.';

	type Confirmation = { title: string; message: string; label: string };

	/**
	 * Enhance with an optional confirmation, a busy marker and a toast. The
	 * confirmation is built when the form is sent, from what it sends: the
	 * enhance callback is set up once, and the page data may have changed
	 * since. A step that worked only in part (a group booking) answers with a
	 * `warning`, shown instead of the success toast.
	 * @param options.reset false: keep the form as it is after a success (the
	 *   group planner fills its rows from the page data itself)
	 */
	function act(
		key: string,
		done: string | ((data: Record<string, unknown>) => string),
		confirmation?: (form: FormData) => Confirmation,
		options: { reset?: boolean } = {}
	): SubmitFunction {
		return async ({ cancel, formData }) => {
			if (confirmation) {
				const { title, message, label } = confirmation(formData);
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
				if (typeof payload.warning === 'string' && payload.warning) {
					toast(payload.warning, 'warning', 10000);
				} else {
					toast(typeof done === 'string' ? done : done(payload), 'success');
				}
				await update({ reset: options.reset ?? true });
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

	function assignConfirmation(id: string, form: FormData): Confirmation {
		const request = current(id);
		const spot = data.spots.find((s) => s.bedId === form.get('bedId'))?.label ?? 'The spot';
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
		const whose = spot?.assigned
			? ''
			: ' The guest booked this spot themselves: releasing it takes it away from them.';
		return {
			title: 'Release this spot?',
			message: `${spot?.label ?? 'The spot'} becomes free again${stays}, and the guest gets a message.${whose} The request stays approved.`,
			label: 'Release spot'
		};
	}

	function approveAfterAllConfirmation(id: string): Confirmation {
		const spot = current(id)?.spot;
		return {
			title: 'Approve this request after all?',
			message: `The guest gets a message that the crew approved their special-needs request${
				spot ? ` and keeps ${spot.label} until you book a more fitting spot` : ''
			}. Then assign a spot.`,
			label: 'Approve'
		};
	}

	/** The ⋯ menus are plain <details>: a click elsewhere closes them. */
	function closeMenus(event: MouseEvent) {
		for (const menu of document.querySelectorAll('details.more[open]')) {
			if (!menu.contains(event.target as Node)) menu.removeAttribute('open');
		}
	}

	function declineConfirmation(id: string): Confirmation {
		const spot = current(id)?.spot;
		return {
			title: 'Decline this request?',
			message: `The guest gets a message that the crew cannot offer a special-needs spot. ${
				spot
					? `They keep the spot they booked, ${spot.label}.`
					: 'They can book like everyone else when booking opens.'
			}`,
			label: 'Decline'
		};
	}
</script>

<svelte:head>
	<title>Special needs · CozyNights Admin</title>
</svelte:head>

<svelte:window on:click={closeMenus} />

<div class="requests-page">
	<a href="/admin" class="back">← Control Center</a>
	<h1>Special-needs requests ♿</h1>
	<p class="intro">
		Guests ask for a fitting spot with their ticket code, also before booking opens: for something
		they need, or for an art project or crew that wants a room or spots close together — on their
		own or as a group. Approve or decline, then book a spot: that books it for the guest right away,
		in Staging Mode too. Each guest gets a message about each decision and the booking.
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

	{#if data.capacity.length > 0 || specialTotal > 0 || specialAsked > 0}
		<section
			class="capacity"
			class:short={data.capacity.some((entry) => entry.short) || specialFree < specialAsked}
		>
			<h2>What the open requests need</h2>
			<ul>
				{#if specialTotal > 0 || specialAsked > 0}
					<li class:short={specialFree < specialAsked}>
						<span class="need">♿ Special-needs spots</span>
						<span class="numbers">
							{specialFree} free for {specialAsked} open {specialAsked === 1
								? 'request'
								: 'requests'} with something they need
						</span>
						{#if specialFree < specialAsked}<span class="warn">⚠️ not enough</span>{/if}
					</li>
				{/if}
				{#each data.capacity as entry (entry.need)}
					<li class:short={entry.short}>
						<span class="need">{entry.label}</span>
						<span class="numbers">
							{entry.asked} asked · {entry.fitting} free {entry.fitting === 1 ? 'spot' : 'spots'} fit
						</span>
						{#if entry.short}<span class="warn">⚠️ not enough</span>{/if}
					</li>
				{/each}
			</ul>
			<p class="hint">
				Counted from the bed types and features of the free spots. A spot nobody described counts
				for nothing here — fill the details in on the room page.
			</p>
		</section>
	{/if}

	<SpecialSpots spots={data.specialSpots} />

	<p class="privacy-note">
		🔏 What guests write here may be about their health. Only admins can read it. Don't copy it into
		chats or e-mails; talk about it in person. Everything is deleted after the event.
	</p>

	{#if form && 'error' in form && form.error}
		<p class="form-error" role="alert">{form.error}</p>
	{/if}
	<!-- A group booking that worked only in part: who wasn't booked, and why. -->
	{#if form && 'warning' in form && typeof form.warning === 'string'}
		<p class="warn" role="status">⚠️ {form.warning}</p>
	{/if}

	{#if data.requests.length === 0}
		<p class="empty">No requests yet.</p>
	{/if}

	{#if data.groups.length > 0}
		<section class="status-list groups">
			<h2>Groups 👥 <span class="count">{data.groups.length}</span></h2>
			<p class="hint">
				Guests who ask together share a group code. Decide and book for the whole group here, or for
				each guest in their own card below.
			</p>
			{#each data.groups as group (group.id)}
				<GroupCard
					{group}
					requests={data.requests}
					spots={data.spots}
					{specialFree}
					{specialSummary}
					isBookingActive={data.isBookingActive}
					{busy}
					{act}
				/>
			{/each}
		</section>
	{/if}

	{#each [{ title: 'Waiting for a decision', list: waiting }, { title: 'Approved', list: approved }, { title: 'Declined', list: declined }] as status (status.title)}
		{#if status.list.length > 0}
			<section class="status-list">
				<h2>{status.title} <span class="count">{status.list.length}</span></h2>

				{#each status.list as request (request.id)}
					<article class="request status-{request.status}" id="request-{request.id}">
						<header>
							<div>
								<h3>{who(request)}</h3>
								{#if request.ticket.email}
									<a class="mail" href="mailto:{request.ticket.email}">{request.ticket.email}</a>
								{/if}
								{#if request.groupId}
									<a class="group-chip" href="#group-{request.groupId}"
										>👥 {groupNames.get(request.groupId) ?? 'Group'}</a
									>
								{/if}
							</div>
							<div class="head-right">
								<span class="badge">{STATUS_LABELS[request.status]}</span>
								{#if request.status === 'declined'}
									<details class="more">
										<summary aria-label="More actions" title="More actions">⋯</summary>
										<div class="menu">
											<form
												method="POST"
												action="?/approve"
												use:enhance={act(request.id, 'Approved after all.', () =>
													approveAfterAllConfirmation(request.id)
												)}
											>
												<input type="hidden" name="id" value={request.id} />
												<button class="menu-item" disabled={!!busy}>Approve after all</button>
											</form>
										</div>
									</details>
								{/if}
							</div>
						</header>

						<ul class="needs">
							<!-- unkeyed: stored needs aren't deduplicated, a key could clash -->
							{#each request.needs as need}
								<li class:project={isProjectNeed(need)}>{pillText(need)}</li>
							{:else}
								<li class="project">👥 Group only: nothing of their own</li>
							{/each}
						</ul>

						{#if request.changedAfterDecision}
							<p class="warn">
								⚠️ The guest sent the form again right when the crew decided. Read it again.
							</p>
						{/if}

						<details open={request.status === 'pending' || request.changedAfterDecision}>
							<summary>What the guest wrote</summary>
							<p class="text">
								{request.text ||
									(request.textUnreadable
										? '(nothing readable)'
										: 'Nothing written: they asked as part of a group.')}
							</p>
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
									<span class="dim"
										>· {request.spot.assigned ? 'booked by the crew' : 'booked by the guest'}</span
									>
								{:else}
									No spot yet
								{/if}
							</dd>
						</dl>

						<div class="actions" class:hidden={request.status === 'declined'}>
							{#if request.status === 'pending'}
								<form method="POST" action="?/approve" use:enhance={act(request.id, 'Approved.')}>
									<input type="hidden" name="id" value={request.id} />
									<button class="btn primary" disabled={!!busy}>Approve</button>
								</form>
							{/if}
							{#if request.status === 'pending' || (request.status === 'approved' && !request.spot?.assigned)}
								<form
									method="POST"
									action="?/decline"
									use:enhance={act(request.id, 'Declined.', () => declineConfirmation(request.id))}
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
								use:enhance={act(request.id, 'The spot is booked for the guest.', (sent) =>
									assignConfirmation(request.id, sent)
								)}
							>
								<input type="hidden" name="id" value={request.id} />
								<label for="spot-{request.id}">{request.spot ? 'Move to' : 'Assign a spot'}</label>
								<div class="row">
									<SpotSelect
										name="bedId"
										id="spot-{request.id}"
										spots={data.spots}
										needs={request.needs}
										{specialFree}
										{specialSummary}
										placeholder="Pick a free spot…"
									/>
									<button class="btn primary" disabled={!!busy}>
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

	.capacity {
		padding: 0.85rem 1.1rem;
		border: 1px solid #3f3f46;
		border-radius: 14px;
		min-width: 0;
	}
	.capacity.short {
		border-color: #f59e0b;
	}
	.capacity h2 {
		margin: 0 0 0.5rem;
		font-size: 1rem;
	}
	.capacity ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
	}
	.capacity li {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.5rem;
		font-size: 0.9rem;
		min-width: 0;
	}
	.capacity .need {
		font-weight: 700;
		overflow-wrap: anywhere;
	}
	.capacity .numbers {
		color: #a1a1aa;
		overflow-wrap: anywhere;
	}
	.capacity li.short .numbers {
		color: #fbbf24;
	}
	.capacity .warn {
		color: #fbbf24;
		font-weight: 700;
	}
	.capacity .hint {
		margin: 0.6rem 0 0;
		font-size: 0.8rem;
		color: #a1a1aa;
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

	.status-list h2 {
		font-size: 1.1rem;
		font-weight: 900;
		margin: 0.5rem 0 0.75rem;
	}
	.groups > .hint {
		margin: -0.25rem 0 0.75rem;
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
		/* reached from a group card's "Details ↓": clear of the sticky admin bar */
		scroll-margin-top: 5rem;
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
		border-left-color: #22c55e;
	}
	.request.status-declined {
		border-left-color: #525252;
		border-color: #1f1f1f;
	}
	/* a declined request steps back; its header (with the ⋯ menu) stays readable */
	.request.status-declined > :not(header) {
		opacity: 0.55;
	}
	.request.status-declined h3 {
		color: #a3a3a3;
	}
	/* Name and status side by side while the name has room; otherwise the
	   status goes underneath (it squeezed a long name to a word per line). */
	.request header {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		align-items: flex-start;
		gap: 0.5rem 1rem;
	}
	.request header > :first-child {
		flex: 1 1 14rem;
		min-width: 0;
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
	/* the request's group: a link up to its card, on a line of its own */
	.group-chip {
		display: flex;
		align-items: center;
		width: fit-content;
		max-width: 100%;
		box-sizing: border-box;
		margin-top: 0.35rem;
		min-height: 32px;
		padding: 0.2rem 0.7rem;
		border-radius: 999px;
		border: 1px solid #525252;
		color: #e5e5e5;
		font-size: 0.85rem;
		font-weight: 700;
		text-decoration: none;
		overflow-wrap: anywhere;
	}
	.group-chip:hover {
		border-color: #a3a3a3;
	}
	.head-right {
		flex: none;
		/* wrapped under a long name it stays at the right edge, so the ⋯ menu opens inside the card */
		margin-left: auto;
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	.badge {
		flex: none;
		font-size: 0.75rem;
		font-weight: 800;
		padding: 0.25rem 0.6rem;
		border-radius: 999px;
		background: rgba(251, 146, 60, 0.15);
		color: #fdba74;
		border: 1px solid rgba(251, 146, 60, 0.4);
	}
	.status-approved .badge {
		background: rgba(34, 197, 94, 0.15);
		color: #86efac;
		border-color: rgba(34, 197, 94, 0.5);
	}
	.status-declined .badge {
		background: #1f1f1f;
		color: #a3a3a3;
		border-color: #3f3f46;
	}

	/* the ⋯ menu: a native <details>, so it works without JavaScript too */
	details.more {
		position: relative;
	}
	details.more summary {
		list-style: none;
		cursor: pointer;
		width: 36px;
		height: 36px;
		border-radius: 10px;
		border: 1px solid #3f3f46;
		display: grid;
		place-items: center;
		font-weight: 900;
		color: #d4d4d4;
		line-height: 1;
	}
	details.more summary::-webkit-details-marker {
		display: none;
	}
	details.more[open] summary,
	details.more summary:hover {
		background: #27272a;
	}
	.menu {
		position: absolute;
		right: 0;
		top: calc(100% + 6px);
		min-width: 12rem;
		padding: 0.35rem;
		background: #18181b;
		border: 1px solid #3f3f46;
		border-radius: 12px;
		box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
		z-index: 5;
	}
	.menu-item {
		width: 100%;
		min-height: 44px;
		padding: 0.5rem 0.75rem;
		border: 0;
		border-radius: 8px;
		background: transparent;
		color: #e5e5e5;
		font: inherit;
		font-weight: 700;
		text-align: left;
		cursor: pointer;
	}
	.menu-item:hover {
		background: #27272a;
	}
	.menu-item:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.actions.hidden {
		display: none;
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
		border: 1px solid var(--state-special);
		color: #f9a8d4;
		overflow-wrap: anywhere;
	}
	/* pink is ♿ alone (state.css): a project's wishes and "group only" stay neutral */
	.needs li.project {
		border-color: #525252;
		color: #e5e5e5;
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
	/* the button stays its own height when a line under the list says why no ♿ spot is free */
	.row {
		align-items: flex-start;
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
	.dim {
		color: #a3a3a3;
	}
	.warn {
		margin: 0;
		padding: 0.6rem 0.9rem;
		border-radius: 10px;
		background: rgba(251, 146, 60, 0.1);
		border: 1px solid rgba(251, 146, 60, 0.4);
		color: #fed7aa;
		font-weight: 700;
	}
</style>
