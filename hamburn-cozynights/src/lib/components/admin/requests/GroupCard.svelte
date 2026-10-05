<script lang="ts">
	/**
	 * One request group on the requests page (docs/admin/special-needs.md,
	 * "Groups"): guests who asked together with a shared code. The group has no
	 * status of its own: its buttons decide and book each member's own request
	 * (request-groups.ts), so every guest gets their own message, and each
	 * member's card further down still works on its own.
	 *
	 * - Approve all waiting: only waiting requests; decided ones stay.
	 * - Decline group: waiting and approved requests, except those with a spot
	 *   the crew booked (release it first).
	 * - The planner: one spot per member, first proposed for a place the crew
	 *   picks under "Where:" (JavaScript only; without it the proposal for the
	 *   snuggest fitting place stands). Rows on "Keep as is" change nothing;
	 *   what can be booked is booked, and a warning names who wasn't.
	 *
	 * The card's edge uses the state colours (src/routes/state.css): orange
	 * while a member waits, green when approved, grey otherwise. Never the
	 * class `group` (a Tailwind utility) or `request` (the layout test's card).
	 */
	import { onMount } from 'svelte';
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { needShort } from '$lib/accommodation';
	import { placeOptions, proposePlan, toPlace, type PlanMember } from '$lib/group-plan';
	import {
		GROUP_MAX,
		OTHER_NEED,
		STATUS_LABELS,
		isAccessNeed,
		requestKinds,
		type AdminGroupView,
		type AdminRequestView,
		type SpotInfo
	} from '$lib/special-needs';
	import SpotSelect from './SpotSelect.svelte';

	type Confirmation = { title: string; message: string; label: string };
	/** The page's enhance helper: confirmation, busy marker, toasts (admin/requests/+page.svelte). */
	type Act = (
		key: string,
		done: string | ((data: Record<string, unknown>) => string),
		confirmation?: (form: FormData) => Confirmation,
		options?: { reset?: boolean }
	) => SubmitFunction;

	let {
		group,
		requests,
		spots,
		specialFree,
		specialSummary,
		isBookingActive,
		busy,
		act
	}: {
		group: AdminGroupView;
		/** Every request of the page; the card takes its members from them. */
		requests: AdminRequestView[];
		/** The free spots an admin can book (listAssignableSpots). */
		spots: SpotInfo[];
		specialFree: number;
		specialSummary: string;
		isBookingActive: boolean;
		/** A step is running somewhere on the page: every button waits. */
		busy: string;
		act: Act;
	} = $props();

	// The "Where:" choice and the proposal need JavaScript; without it the
	// rows keep the proposal they were rendered with.
	let mounted = $state(false);
	onMount(() => (mounted = true));

	const members = $derived(
		group.memberIds
			.map((id) => requests.find((request) => request.id === id))
			.filter((request): request is AdminRequestView => !!request)
	);

	/** How the crew calls a member: like the server's warning does (request-groups.ts). */
	const nameOf = (request: AdminRequestView) =>
		request.ticket.name || request.burnerName || 'Ticket without a name';

	const crewSpot = (request: AdminRequestView) => !!request.spot?.assigned;
	const waiting = $derived(members.filter((m) => m.status === 'pending').length);
	const approved = $derived(members.filter((m) => m.status === 'approved').length);
	const declined = $derived(members.filter((m) => m.status === 'declined').length);
	const crewBooked = $derived(members.filter(crewSpot).length);
	const withNeeds = $derived(members.filter((m) => requestKinds(m.needs).access).length);
	const project = $derived(members.some((m) => requestKinds(m.needs).project));
	/** What "Decline group" declines: waiting, and approved without a spot from the crew. */
	const declinable = $derived(
		members.filter((m) => m.status === 'pending' || (m.status === 'approved' && !crewSpot(m)))
			.length
	);
	const keptOnDecline = $derived(
		members.filter((m) => m.status === 'approved' && crewSpot(m)).length
	);
	const edge = $derived(waiting > 0 ? 'filling' : approved > 0 ? 'open' : 'idle');

	// ── The planner ──────────────────────────────────────────────────────────
	const planMembers: PlanMember[] = $derived(
		members.map((m) => ({
			requestId: m.id,
			name: nameOf(m),
			needs: m.needs,
			declined: m.status === 'declined',
			crewSpotLabel: crewSpot(m) && m.spot ? m.spot.label : ''
		}))
	);
	const placing = $derived(toPlace(planMembers));
	const options = $derived(
		placeOptions(spots, placing.length, placing.filter((m) => requestKinds(m.needs).access).length)
	);
	/**
	 * null: the default, the snuggest place that fits everyone (sparing the ♿
	 * spots when one can), else anywhere.
	 */
	let chosenPlace = $state<string | null>(null);
	const place = $derived(
		chosenPlace !== null && options.some((option) => option.key === chosenPlace)
			? chosenPlace
			: (options.slice(1).find((option) => option.fits)?.key ?? '')
	);
	const proposal = $derived(proposePlan(planMembers, spots, place));
	/** What the crew picked by hand, by request id; the proposal fills the rest. */
	let edits = $state<Record<string, string>>({});
	const valueOf = (requestId: string) => edits[requestId] ?? proposal[requestId] ?? '';
	const toBook = $derived(
		planMembers.filter((m) => !m.declined && valueOf(m.requestId) !== '').length
	);

	// New page data (a booking, a decision, a spot taken elsewhere): the hand
	// picks may point at spots that are gone, so the fresh proposal wins.
	const signature = $derived(
		JSON.stringify([
			spots.map((spot) => spot.bedId),
			members.map((m) => [m.id, m.status, m.spot?.bedId ?? '', crewSpot(m)])
		])
	);
	$effect.pre(() => {
		void signature;
		edits = {};
	});

	function pickPlace(key: string) {
		chosenPlace = key;
		edits = {};
	}

	/** "No ladder, Quiet": what a member needs to sleep well, for the planner row. */
	function accessText(member: PlanMember): string {
		return member.needs
			.filter((need) => isAccessNeed(need) || need === OTHER_NEED.value)
			.map(needShort)
			.join(', ');
	}

	const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

	function when(value: string) {
		const date = new Date(value.replace(' ', 'T'));
		if (Number.isNaN(date.getTime())) return '';
		return new Intl.DateTimeFormat('en-GB', {
			timeZone: 'Europe/Berlin',
			day: 'numeric',
			month: 'short'
		}).format(date);
	}

	// ── Confirmations: built when the form is sent, from the current page ───
	function approveConfirmation(): Confirmation {
		return {
			title: 'Approve the group?',
			message: `${waiting} waiting ${plural(waiting, 'request is', 'requests are')} approved. Each guest gets their own message. Requests the crew already decided stay as they are. Then book their spots below, or one by one.`,
			label: `Approve ${waiting}`
		};
	}

	function declineConfirmation(): Confirmation {
		const kept =
			keptOnDecline > 0
				? ` ${keptOnDecline} ${plural(keptOnDecline, 'stays', 'stay')} approved: the crew booked a spot for them — release it first.`
				: '';
		return {
			title: 'Decline the group?',
			message: `${declinable} ${plural(declinable, 'request is', 'requests are')} declined, and each guest gets a message that the crew can't offer them a special-needs spot.${kept}`,
			label: `Decline ${declinable}`
		};
	}

	/** A picked spot in the dialog, ♿ marked like in the spot lists. */
	const spotText = (spot: SpotInfo | undefined) =>
		spot ? `${spot.special ? '♿ ' : ''}${spot.label}` : 'a spot';

	/** From what the form sends, so the dialog names exactly what gets booked. */
	function bookConfirmation(form: FormData): Confirmation {
		const picked = members
			.map((member) => ({ member, bedId: String(form.get(`bed_${member.id}`) ?? '') }))
			.filter(({ member, bedId }) => bedId && member.status !== 'declined');
		const list = picked
			.map(
				({ member, bedId }) =>
					`${nameOf(member)} → ${spotText(spots.find((spot) => spot.bedId === bedId))}`
			)
			.join('; ');
		const moving = picked.filter(({ member }) => member.spot && !member.spot.assigned).length;
		const approving = picked.filter(({ member }) => member.status === 'pending').length;
		const closed = isBookingActive ? '' : ', although booking is closed';
		const moves =
			moving > 0
				? ` ${moving} of them ${plural(moving, 'moves', 'move')} from a spot they booked themselves.`
				: '';
		const approves =
			approving > 0
				? ` ${approving} waiting ${plural(approving, 'request is', 'requests are')} approved as well.`
				: '';
		const n = picked.length;
		return {
			title: `Book ${n} ${plural(n, 'spot', 'spots')} for the group?`,
			message: `Booked right away${closed}: ${list}.${moves}${approves} Each guest gets a message with the booking pass.`,
			label: 'Book them'
		};
	}

	function removeConfirmation(requestId: string): Confirmation {
		const member = members.find((m) => m.id === requestId);
		return {
			title: `Take ${member ? nameOf(member) : 'this guest'} out of the group?`,
			message:
				"Their request stays as it is, without the group. They see it on their request page; they get no message. Their ticket can't join this group again, not even with its code.",
			label: 'Take out'
		};
	}

	const declineDone = (data: Record<string, unknown>) => {
		const skipped = Number(data.skipped) || 0;
		return `${Number(data.changed) || 0} declined.${skipped ? ` ${skipped} kept their crew-booked spot.` : ''}`;
	};

	const bookDone = (data: Record<string, unknown>) => {
		const booked = Number(data.booked) || 0;
		return `${booked} ${plural(booked, 'spot', 'spots')} booked for the group.`;
	};
</script>

<article class="request-group" id="group-{group.id}" data-state={edge}>
	<header>
		<h3>👥 {group.name}</h3>
		<p class="meta">
			{members.length} of {GROUP_MAX} · code <span class="code">{group.code}</span> · started {when(
				group.created
			)}
		</p>
		<ul class="chips" aria-label="The group at a glance">
			{#if waiting > 0}<li class="chip waiting">{waiting} waiting</li>{/if}
			{#if approved > 0}<li class="chip approved">{approved} approved</li>{/if}
			{#if declined > 0}<li class="chip">{declined} declined</li>{/if}
			{#if crewBooked > 0}<li class="chip crew">{crewBooked} booked by the crew</li>{/if}
			{#if withNeeds > 0}<li class="chip special">♿ {withNeeds} with something they need</li>{/if}
			{#if project}<li class="chip">🎨 project</li>{/if}
		</ul>
	</header>

	<ul class="members">
		{#each members as member (member.id)}
			<li class="member status-{member.status}">
				<div class="who">
					<span class="name">{member.ticket.name || 'Ticket without a name'}</span>
					<!-- Svelte trims spaces at a tag's edge: the separator is part of the text. -->
					{#if member.burnerName}<span class="burner">{` · 🔥 ${member.burnerName}`}</span>{/if}
				</div>
				<span class="badge">{STATUS_LABELS[member.status]}</span>
				<span class="spot">
					{#if member.spot}
						{member.spot.label} ({member.spot.assigned
							? 'booked by the crew'
							: 'booked by the guest'})
					{:else}
						No spot yet
					{/if}
				</span>
				<div class="tools">
					<a class="details-link" href="#request-{member.id}">Details ↓</a>
					<details class="more">
						<summary aria-label="More actions" title="More actions">⋯</summary>
						<!-- data-layout-overlay: the open menu floats over the rows below on purpose -->
						<div class="menu" data-layout-overlay>
							<form
								method="POST"
								action="?/removeFromGroup"
								use:enhance={act(member.id, 'Taken out of the group.', () =>
									removeConfirmation(member.id)
								)}
							>
								<input type="hidden" name="id" value={member.id} />
								<button class="menu-item" disabled={!!busy}>Take out of group</button>
							</form>
						</div>
					</details>
				</div>
			</li>
		{/each}
	</ul>

	{#if waiting > 0 || declinable > 0}
		<div class="actions">
			{#if waiting > 0}
				<form
					method="POST"
					action="?/approveGroup"
					use:enhance={act(
						`group-${group.id}`,
						(data) => `${Number(data.changed) || 0} approved.`,
						approveConfirmation
					)}
				>
					<input type="hidden" name="id" value={group.id} />
					<button class="btn primary" disabled={!!busy}>Approve all waiting ({waiting})</button>
				</form>
			{/if}
			{#if declinable > 0}
				<form
					method="POST"
					action="?/declineGroup"
					use:enhance={act(`group-${group.id}`, declineDone, declineConfirmation)}
				>
					<input type="hidden" name="id" value={group.id} />
					<button class="btn" disabled={!!busy}>Decline group</button>
				</form>
			{/if}
		</div>
	{/if}

	<form
		method="POST"
		action="?/assignGroup"
		class="plan"
		use:enhance={act(`group-${group.id}`, bookDone, bookConfirmation, { reset: false })}
	>
		<input type="hidden" name="id" value={group.id} />
		<h4>Book spots for the group</h4>
		{#if placing.length === 0}
			<p class="hint">Everyone in the group who isn't declined has a spot the crew booked.</p>
		{:else}
			{#if mounted}
				<!-- Not sent: it only fills the rows below with a proposal. -->
				<div class="where">
					<label for="where-{group.id}">Where:</label>
					<select
						id="where-{group.id}"
						value={place}
						onchange={(event) => pickPlace(event.currentTarget.value)}
					>
						{#each options as option (option.key)}
							<option value={option.key}>{option.label}</option>
						{/each}
					</select>
				</div>
			{/if}
			<ul class="plan-rows">
				{#each planMembers as member (member.requestId)}
					<li>
						{#if member.declined}
							<span class="plan-name">{member.name}</span>
							<span class="dim">Declined — not booked.</span>
						{:else}
							<label class="plan-name" for="plan-{member.requestId}">
								{member.name}{#if accessText(member)}<span class="plan-needs"
										>{` · ♿ ${accessText(member)}`}</span
									>{/if}
							</label>
							<SpotSelect
								name="bed_{member.requestId}"
								id="plan-{member.requestId}"
								{spots}
								needs={member.needs}
								{specialFree}
								{specialSummary}
								placeholder={member.crewSpotLabel
									? `Keep ${member.crewSpotLabel} (booked by the crew)`
									: 'Keep as is'}
								value={valueOf(member.requestId)}
								onpick={(bedId) => (edits[member.requestId] = bedId)}
							/>
						{/if}
					</li>
				{/each}
			</ul>
			<div class="plan-foot">
				<button class="btn primary" disabled={!!busy || (mounted && toBook === 0)}>
					Book {toBook}
					{plural(toBook, 'spot', 'spots')}
				</button>
				<p class="hint">
					Each guest gets their own message with the booking pass. Rows left on “Keep as is” don't
					change.
				</p>
			</div>
		{/if}
	</form>
</article>

<style>
	.request-group {
		background: #111;
		border: 1px solid #262626;
		border-left: 4px solid var(--state, #525252);
		border-radius: 16px;
		padding: 1rem 1.25rem;
		margin-bottom: 1rem;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		min-width: 0;
		scroll-margin-top: 5rem;
	}
	header {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		min-width: 0;
	}
	h3 {
		margin: 0;
		font-size: 1.05rem;
		font-weight: 800;
		overflow-wrap: anywhere;
	}
	.meta {
		margin: 0;
		color: #a3a3a3;
		font-size: 0.85rem;
		overflow-wrap: anywhere;
	}
	.code {
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
		color: #e5e5e5;
		letter-spacing: 0.05em;
	}

	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.chip {
		font-size: 0.8rem;
		font-weight: 700;
		padding: 0.2rem 0.6rem;
		border-radius: 999px;
		border: 1px solid #525252;
		color: #d4d4d4;
		overflow-wrap: anywhere;
	}
	.chip.waiting {
		border-color: var(--state-filling);
		color: var(--state-filling);
	}
	.chip.approved {
		border-color: var(--state-open);
		color: var(--state-open);
	}
	.chip.crew {
		border-color: var(--state-locked);
		color: var(--state-locked);
	}
	.chip.special {
		border-color: var(--state-special);
		color: #f9a8d4;
	}

	.members {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.member {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.35rem 0.75rem;
		padding: 0.5rem 0.75rem;
		border-radius: 12px;
		background: #0a0a0a;
		border: 1px solid #222;
		min-width: 0;
	}
	.who {
		flex: 1 1 14rem;
		min-width: 0;
		overflow-wrap: anywhere;
	}
	.name {
		font-weight: 800;
	}
	.burner {
		color: #a3a3a3;
	}
	.spot {
		flex: 1 1 14rem;
		min-width: 0;
		color: #a3a3a3;
		font-size: 0.85rem;
		overflow-wrap: anywhere;
	}
	.badge {
		flex: none;
		font-size: 0.75rem;
		font-weight: 800;
		padding: 0.25rem 0.6rem;
		border-radius: 999px;
		background: var(--state-filling-soft);
		color: #fdba74;
		border: 1px solid rgba(251, 146, 60, 0.4);
	}
	.status-approved .badge {
		background: var(--state-open-soft);
		color: #86efac;
		border-color: rgba(74, 222, 128, 0.5);
	}
	.status-declined .badge {
		background: #1f1f1f;
		color: #a3a3a3;
		border-color: #3f3f46;
	}
	.tools {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		margin-left: auto;
	}
	.details-link {
		display: inline-flex;
		align-items: center;
		min-height: 44px;
		padding: 0 0.4rem;
		color: #2dd4bf;
		font-size: 0.85rem;
		font-weight: 700;
		white-space: nowrap;
	}

	/* the ⋯ menu: a native <details>, so it works without JavaScript too */
	details.more {
		position: relative;
	}
	details.more summary {
		list-style: none;
		cursor: pointer;
		width: 44px;
		height: 44px;
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

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.6rem;
	}

	.plan {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		padding-top: 0.75rem;
		border-top: 1px solid #222;
		min-width: 0;
	}
	h4 {
		margin: 0;
		font-weight: 800;
		font-size: 0.8rem;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		color: #a3a3a3;
	}
	.where {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.4rem 0.75rem;
		min-width: 0;
	}
	.where label {
		font-weight: 700;
	}
	.where select {
		flex: 1 1 16rem;
		width: 100%;
		min-width: 0;
		min-height: 44px;
		padding: 0 0.75rem;
		border-radius: 10px;
		border: 1px solid #333;
		background: #0a0a0a;
		color: #fff;
		font: inherit;
	}
	.plan-rows {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}
	.plan-rows li {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.35rem 0.75rem;
		min-width: 0;
	}
	.plan-name {
		flex: 1 1 12rem;
		min-width: 0;
		font-weight: 700;
		overflow-wrap: anywhere;
	}
	.plan-needs {
		color: #f9a8d4;
		font-weight: 600;
	}
	.plan-foot {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem 1rem;
	}
	.plan-foot .hint {
		flex: 1 1 16rem;
		min-width: 0;
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
		line-height: 1.4;
		overflow-wrap: anywhere;
	}
	.dim {
		color: #a3a3a3;
	}
</style>
