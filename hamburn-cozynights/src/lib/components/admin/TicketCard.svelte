<!--
@component
One ticket in the admin's ticket search: what it holds, its e-mail address and
name to edit in place, the hand-over to a new holder ("passed on"), — for
an unpaid ticket — "Mark as paid" when the payment was confirmed in person, and
for a booked one Move (the spot picker the page opens through `pickSpot`) and
Release. Saves through ?/update, ?/markPaid, ?/move and ?/release of the ticket
page and fires `saved` with the fresh ticket.
-->
<script lang="ts">
	import { applyAction, enhance } from '$app/forms';
	import { createEventDispatcher, tick } from 'svelte';
	import { slide } from 'svelte/transition';
	import type { ActionResult, SubmitFunction } from '@sveltejs/kit';
	import { confirmDialog, toast } from '$lib/dialogs';
	import { revealInvalid } from '$lib/field-alert';
	import { formatBerlin } from '$lib/booking-phase';
	import type { SpotInfo } from '$lib/special-needs';
	import {
		TICKET_LIMITS,
		isValidGuestEmail,
		normalizeEmail,
		type TicketChangeOutcome,
		type TicketPaidOutcome,
		type TicketSpotOutcome,
		type TicketView
	} from '$lib/tickets';

	export let ticket: TicketView;
	/**
	 * Opens the page's spot picker for this ticket and answers with the spot
	 * picked (null: cancelled). Unset without JavaScript: no Move or Release then.
	 */
	export let pickSpot: ((ticket: TicketView) => Promise<SpotInfo | null>) | null = null;

	const dispatch = createEventDispatcher<{ saved: TicketView }>();

	let email = ticket.email;
	let name = ticket.name;
	let newHolder = false;
	let saving = false;
	let marking = false;
	let error = '';
	// Move and Release: loading the picker, then the two forms.
	let choosing = false;
	let moving = false;
	let releasing = false;
	let moveTo: SpotInfo | null = null;
	let moveForm: HTMLFormElement;
	let card: HTMLElement;
	let spotError = '';
	$: spotBusy = choosing || moving || releasing;
	// Punish late: half an address is not an error yet. A field turns red once
	// it was left, or when saving was tried — and turns back the moment it's fixed.
	let emailLeft = false;
	let nameLeft = false;
	let triedToSave = false;

	// A fresh ticket (saved, or found again): start from what is stored. The
	// page hands every card a new object when any card saves, so compare the
	// content: typing in this card must survive a save in another one.
	let shownTicket = '';
	$: if (JSON.stringify(ticket) !== shownTicket) reset(ticket);
	function reset(fresh: TicketView) {
		shownTicket = JSON.stringify(fresh);
		email = fresh.email;
		name = fresh.name;
		newHolder = false;
		error = '';
		spotError = '';
		emailLeft = nameLeft = triedToSave = false;
	}

	$: cleanEmail = normalizeEmail(email);
	$: emailChanged = cleanEmail !== ticket.email.toLowerCase();
	$: nameChanged = name.trim() !== ticket.name;
	$: dirty = emailChanged || nameChanged || newHolder;
	$: emailProblem =
		cleanEmail && !isValidGuestEmail(cleanEmail)
			? 'That is not a valid e-mail address. Leave it empty for a ticket without e-mails.'
			: '';
	$: nameProblem =
		name.trim().length > TICKET_LIMITS.nameLength
			? `At most ${TICKET_LIMITS.nameLength} characters.`
			: '';
	$: showEmailProblem = !!emailProblem && (emailLeft || triedToSave);
	$: showNameProblem = !!nameProblem && (nameLeft || triedToSave);

	/** What "passed on" does to this ticket, in the admin's words. */
	$: handOver = [
		ticket.spot ? 'The spot stays with the ticket.' : '',
		ticket.telegram ? 'Telegram updates to the old holder stop.' : '',
		ticket.passCode ? 'The booking pass gets a new code: the old pass link stops working.' : '',
		ticket.burnerName ? `The burner name "${ticket.burnerName}" is forgotten.` : '',
		ticket.spot?.checkIn
			? 'The check-in is reset: the new holder checks in with the new pass when they arrive.'
			: '',
		'A special-needs request of the old holder is deleted (a spot the crew booked stays with the ticket).',
		!emailChanged && cleanEmail
			? "The address is still the old one: no e-mail goes out, and later updates would reach the old holder. Enter the new holder's address."
			: '',
		emailChanged && ticket.spot && cleanEmail && !emailProblem
			? `${cleanEmail} gets a confirmation with the spot and the new pass.`
			: '',
		ticket.signedIn
			? 'Whoever knows the code can still sign in with it: it is the ticket. A new code only comes from the ticket shop.'
			: ''
	].filter(Boolean);

	function savedMessage(outcome: TicketChangeOutcome): string {
		if (outcome.newHolder) {
			return (
				'🔁 Ticket handed over' +
				(outcome.confirmation ? `: ${outcome.ticket.email} gets a confirmation shortly.` : '.') +
				(outcome.requestRemoved ? ' Their special-needs request was deleted.' : '') +
				(outcome.checkInReset ? ' The check-in was reset.' : '')
			);
		}
		if (outcome.emailChanged && !outcome.ticket.email) {
			return '✉️ Address removed: this ticket gets no e-mails now.';
		}
		if (outcome.confirmation) {
			return `✉️ Saved: ${outcome.ticket.email} gets a confirmation of the spot shortly.`;
		}
		return '✅ Saved.';
	}

	function paidMessage(outcome: TicketPaidOutcome): string {
		if (!outcome.changed) {
			return outcome.paid ? 'This ticket is already paid.' : 'This ticket is already unpaid.';
		}
		return outcome.paid
			? '💳 Marked paid: the code signs in now.'
			: "💳 Set back to unpaid: the code can't sign in any more.";
	}

	/** "Mark as paid" and taking such a mark back: asks first, then ?/markPaid. */
	const submitPaid: SubmitFunction = async ({ cancel, formData }) => {
		const paid = formData.get('paid') !== '0';
		const ok = paid
			? await confirmDialog(
					'Only when the Membership Team confirmed the payment. The code can sign in and book right away. The ticket shop still lists the order as pending: mark it paid there too — until then, the ticket list offers to set this ticket back, unticked.',
					{ title: '💳 Mark this ticket paid?', tone: 'warning', confirmLabel: 'Mark as paid' }
				)
			: await confirmDialog(
					"The code can't sign in any more, and a guest who is signed in is signed out. The spot stays with the ticket.",
					{ title: '💳 Set back to unpaid?', tone: 'danger', confirmLabel: 'Set back to unpaid' }
				);
		if (!ok) {
			cancel();
			return;
		}
		marking = true;
		error = '';
		return async ({ result }) => {
			marking = false;
			if (result.type === 'success') {
				const outcome = result.data?.paid as TicketPaidOutcome | undefined;
				if (!outcome) return;
				toast(paidMessage(outcome), outcome.changed ? 'success' : 'info', 7000);
				reset({ ...outcome.ticket, code: ticket.code, codeMasked: ticket.codeMasked });
				dispatch('saved', outcome.ticket);
			} else if (result.type === 'failure') {
				error =
					(result.data as { error?: string } | undefined)?.error ??
					`The server refused the change (${result.status}). Nothing was saved.`;
			} else if (result.type === 'error') {
				error = 'The server could not be reached. Nothing was saved; try again.';
			} else {
				await applyAction(result);
			}
		};
	};

	/**
	 * Whether a message can reach the guest at all: a ticket without an address
	 * and without Telegram gets none, whatever changes.
	 */
	const reachable = (shown: TicketView) => !!shown.email || shown.telegram;
	const NOBODY_TOLD = 'The ticket has no e-mail address and no Telegram: tell the guest yourself.';

	/** "B1 · Dorm #2 · Villa": the spot as everywhere in the admin area. */
	$: spotLabel = ticket.spot
		? [ticket.spot.spot, ticket.spot.room, ticket.spot.house].filter(Boolean).join(' · ')
		: '';

	/** Move: the page's picker first, then ?/move with the spot picked. */
	async function chooseSpot() {
		if (!pickSpot || spotBusy) return;
		spotError = '';
		choosing = true;
		let picked: SpotInfo | null = null;
		try {
			picked = await pickSpot(ticket);
		} finally {
			choosing = false;
		}
		if (!picked || !moveForm?.isConnected) return;
		moveTo = picked;
		await tick();
		// The confirmation hands the focus back here, not to the closed picker.
		moveForm.querySelector('button')?.focus();
		moveForm.requestSubmit();
	}

	/** What a move or release answered: the fresh ticket, or why not. */
	async function spotResult(result: ActionResult) {
		if (result.type === 'success') {
			const outcome = result.data?.spotChanged as TicketSpotOutcome | undefined;
			if (!outcome) return;
			const told = reachable(outcome.ticket) ? 'The guest gets a message shortly.' : NOBODY_TOLD;
			toast(
				outcome.to
					? `🔀 Moved to ${outcome.to}. ${told}`
					: `🛏️ Released: ${outcome.from} is free. ${told}`,
				'success',
				7000
			);
			reset({ ...outcome.ticket, code: ticket.code, codeMasked: ticket.codeMasked });
			dispatch('saved', outcome.ticket);
			// Release takes its button away: the focus stays on this card.
			if (!outcome.to) {
				await tick();
				card?.focus();
			}
		} else if (result.type === 'failure') {
			spotError =
				(result.data as { error?: string } | undefined)?.error ??
				`The server refused it (${result.status}). Nothing changed.`;
		} else if (result.type === 'error') {
			spotError = 'The server could not be reached. Nothing changed; try again.';
		} else {
			await applyAction(result);
		}
	}

	const submitMove: SubmitFunction = async ({ cancel, formData }) => {
		const spot = moveTo;
		if (!spot || !ticket.spot) {
			cancel();
			return;
		}
		// A locked 🔒 spot is out of service: booked only when confirmed here.
		if (spot.locked) formData.set('blockedOk', spot.bedId);
		else formData.delete('blockedOk');
		const ok = await confirmDialog(
			(spot.locked ? `🔒 ${spot.label} is blocked (out of service). ` : '') +
				`The booking moves from ${spotLabel} to ${spot.label} right away` +
				(ticket.spot.checkIn ? ', and the check-in moves along' : '') +
				'. ' +
				(reachable(ticket)
					? 'The guest gets a message with the new spot and the booking pass.'
					: NOBODY_TOLD),
			{
				title: spot.locked ? '🔀 Move to a blocked spot?' : '🔀 Move the booking?',
				tone: 'warning',
				confirmLabel: spot.locked ? 'Move it anyway' : 'Move'
			}
		);
		if (!ok) {
			moveTo = null;
			cancel();
			return;
		}
		moving = true;
		spotError = '';
		return async ({ result }) => {
			moving = false;
			moveTo = null;
			await spotResult(result);
		};
	};

	const submitRelease: SubmitFunction = async ({ cancel }) => {
		if (!ticket.spot) {
			cancel();
			return;
		}
		const ok = await confirmDialog(
			`The ticket loses ${spotLabel} right away` +
				(ticket.spot.checkIn ? ', and the check-in at arrival is dropped' : '') +
				'. ' +
				(reachable(ticket)
					? 'The guest gets a message and can book again while booking is open.'
					: `${NOBODY_TOLD} They can book again while booking is open.`) +
				(ticket.spot.viaRequest
					? ' Their special-needs request stays approved and needs a new spot on Special-needs requests.'
					: ''),
			{ title: '🛏️ Release the booking?', tone: 'danger', confirmLabel: 'Release' }
		);
		if (!ok) {
			cancel();
			return;
		}
		releasing = true;
		spotError = '';
		return async ({ result }) => {
			releasing = false;
			await spotResult(result);
		};
	};

	const submit: SubmitFunction = ({ cancel, formElement }) => {
		if (!dirty) {
			cancel();
			return;
		}
		if (emailProblem || nameProblem) {
			// The button stays clickable on purpose: a greyed-out Save doesn't say
			// why. Clicking it shows what to fix and puts the cursor there.
			triedToSave = true;
			cancel();
			revealInvalid(formElement);
			return;
		}
		saving = true;
		error = '';
		return async ({ result }) => {
			saving = false;
			if (result.type === 'success') {
				const outcome = result.data?.updated as TicketChangeOutcome | undefined;
				if (!outcome) return;
				toast(savedMessage(outcome), 'success', 7000);
				// Also when the stored ticket looks the same as before (nothing to forget).
				reset({ ...outcome.ticket, code: ticket.code, codeMasked: ticket.codeMasked });
				dispatch('saved', outcome.ticket);
			} else if (result.type === 'failure') {
				error =
					(result.data as { error?: string } | undefined)?.error ??
					`The server refused the change (${result.status}). Nothing was saved.`;
				revealInvalid(formElement);
			} else if (result.type === 'error') {
				error = 'The server could not be reached. Nothing was saved; try again.';
			} else {
				// A redirect: the session ended.
				await applyAction(result);
			}
		};
	};
</script>

<article class="ticket" class:dirty bind:this={card} tabindex="-1">
	<header class="ticket-head">
		<div class="code-block">
			<span class="code" title={ticket.codeMasked ? 'Found by e-mail: the code stays hidden' : ''}>
				{ticket.code || '(no code)'}
			</span>
			{#if ticket.codeMasked}<span class="hidden-note">code hidden</span>{/if}
		</div>
		<ul class="chips" aria-label="Ticket state">
			{#if ticket.unpaid}
				<li
					class="bad"
					title="The ticket shop lists the order as not paid yet: the code can't sign in until a later ticket list shows it as paid, or an admin marks it paid."
				>
					💳 Unpaid
				</li>
			{/if}
			<li class:good={ticket.signedIn}>{ticket.signedIn ? '✓ Signed in' : 'Never signed in'}</li>
			{#if ticket.spot}
				<li class="good">
					<a href="/admin/room/{ticket.spot.roomId}"
						>🛏 {[ticket.spot.house, ticket.spot.room, ticket.spot.spot]
							.filter(Boolean)
							.join(' · ')}</a
					>
				</li>
			{:else}
				<li>No spot</li>
			{/if}
			{#if ticket.spot?.checkIn}
				<li class="good" title={ticket.spot.checkIn.by ? `by ${ticket.spot.checkIn.by}` : ''}>
					✅ Checked in {formatBerlin(ticket.spot.checkIn.at, { year: false })}
				</li>
			{/if}
			{#if ticket.passCode}
				<li>
					<a
						href="/pass/{ticket.passCode}"
						title="Open the booking pass — check the guest in when their phone is dead"
						>🎫 {ticket.passCode}</a
					>
				</li>
			{/if}
			{#if ticket.burnerName}<li>🔥 {ticket.burnerName}</li>{/if}
			{#if ticket.telegram}<li>💬 Telegram</li>{/if}
		</ul>
	</header>

	{#if ticket.unpaid || ticket.paidByHand}
		<form
			class="payment"
			class:unpaid={ticket.unpaid}
			method="POST"
			action="?/markPaid"
			use:enhance={submitPaid}
		>
			<input type="hidden" name="id" value={ticket.id} />
			<input type="hidden" name="paid" value={ticket.unpaid ? '1' : '0'} />
			<p>
				{#if ticket.unpaid}
					<strong>💳 Not paid yet</strong>
					<small
						>The ticket shop lists the order as pending: the code can't sign in. Did the Membership
						Team confirm the payment? Then mark it paid.</small
					>
				{:else if ticket.paidByHand}
					<strong>✋ Paid by hand</strong>
					<small
						>Marked paid {formatBerlin(ticket.paidByHand.at, { year: false })}{ticket.paidByHand.by
							? ` by ${ticket.paidByHand.by}`
							: ''}. Until the ticket shop says paid too, the ticket list asks before it sets it
						back.</small
					>
				{/if}
			</p>
			<button
				type="submit"
				class={ticket.unpaid ? 'btn-paid' : 'btn-ghost'}
				disabled={dirty || marking}
				title={dirty ? 'Save or undo the changes below first' : ''}
			>
				{marking ? 'Saving…' : ticket.unpaid ? '✓ Mark as paid' : 'Set back to unpaid'}
			</button>
		</form>
	{/if}

	{#if ticket.spot && pickSpot}
		<div class="spot-row" class:crew={ticket.spot.viaRequest}>
			<p>
				<strong>🛏 {spotLabel}</strong>
				<small
					>{ticket.spot.viaRequest
						? '♿ The crew booked it for their special-needs request. '
						: ''}Move it to another free spot, or release it. {reachable(ticket)
						? 'The guest gets a message either way.'
						: NOBODY_TOLD}</small
				>
			</p>
			<div class="spot-buttons">
				<form method="POST" action="?/move" bind:this={moveForm} use:enhance={submitMove}>
					<input type="hidden" name="id" value={ticket.id} />
					<input type="hidden" name="from" value={ticket.spot.bedId} />
					<input type="hidden" name="bedId" value={moveTo?.bedId ?? ''} />
					<button
						type="button"
						class="btn-save"
						disabled={dirty || spotBusy}
						title={dirty ? 'Save or undo the changes below first' : ''}
						on:click={chooseSpot}
					>
						{choosing ? 'Loading…' : moving ? 'Moving…' : '🔀 Move…'}
					</button>
				</form>
				<form method="POST" action="?/release" use:enhance={submitRelease}>
					<input type="hidden" name="id" value={ticket.id} />
					<input type="hidden" name="from" value={ticket.spot.bedId} />
					<button
						type="submit"
						class="btn-ghost btn-release"
						disabled={dirty || spotBusy}
						title={dirty ? 'Save or undo the changes below first' : ''}
					>
						{releasing ? 'Releasing…' : 'Release'}
					</button>
				</form>
			</div>
		</div>
		{#if spotError}<p class="form-error" role="alert">{spotError}</p>{/if}
	{/if}

	<form method="POST" action="?/update" use:enhance={submit} novalidate>
		<input type="hidden" name="id" value={ticket.id} />
		<input type="hidden" name="newHolder" value={newHolder ? '1' : ''} />

		<div class="fields">
			<label class="field">
				<span>E-mail for confirmations</span>
				<input
					type="text"
					name="email"
					inputmode="email"
					autocomplete="off"
					autocapitalize="off"
					spellcheck="false"
					placeholder="no address: no e-mails"
					bind:value={email}
					class:changed={emailChanged}
					aria-invalid={showEmailProblem}
					aria-describedby={showEmailProblem ? `ticket-${ticket.id}-email-error` : undefined}
					on:blur={() => (emailLeft = true)}
				/>
				{#if showEmailProblem}
					<small class="field-error" id="ticket-{ticket.id}-email-error">{emailProblem}</small>
				{/if}
			</label>
			<label class="field">
				<span>Name <em>(for the greeting)</em></span>
				<input
					type="text"
					name="name"
					autocomplete="off"
					placeholder="no name: mails say “Hi,”"
					bind:value={name}
					class:changed={nameChanged}
					aria-invalid={showNameProblem}
					aria-describedby={showNameProblem ? `ticket-${ticket.id}-name-error` : undefined}
					on:blur={() => (nameLeft = true)}
				/>
				{#if showNameProblem}
					<small class="field-error" id="ticket-{ticket.id}-name-error">{nameProblem}</small>
				{/if}
			</label>
		</div>

		<label class="hand-over" class:on={newHolder}>
			<input type="checkbox" bind:checked={newHolder} />
			<span>
				<strong>🔁 Ticket passed on to someone else</strong>
				<small>Swapped or sold on: forget what belonged to the old holder.</small>
			</span>
		</label>
		{#if newHolder}
			<ul class="effects" transition:slide={{ duration: 150 }}>
				{#each handOver as line}<li>{line}</li>{/each}
			</ul>
		{/if}

		{#if error}<p class="form-error" role="alert">{error}</p>{/if}

		<!-- data-bottom-bar: sticky on a phone, so the footer's legal pill stays at the end. -->
		<div class="buttons" data-bottom-bar>
			{#if dirty}
				<button type="button" class="btn-ghost" on:click={() => reset(ticket)} disabled={saving}>
					Undo
				</button>
			{/if}
			<button type="submit" class="btn-save" class:warn={newHolder} disabled={!dirty || saving}>
				{saving ? 'Saving…' : newHolder ? 'Save & hand over' : 'Save'}
			</button>
		</div>
	</form>
</article>

<style>
	.ticket {
		background: #111;
		border: 1px solid #262626;
		border-radius: 16px;
		padding: 1rem 1.1rem;
		display: flex;
		flex-direction: column;
		gap: 0.9rem;
		transition: border-color 0.2s;
	}
	.ticket.dirty {
		border-color: #fb923c;
	}
	.ticket:focus {
		outline: none;
	}
	.ticket:focus-visible {
		outline: 2px solid #2dd4bf;
		outline-offset: 2px;
	}
	.ticket-head {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.6rem;
	}
	.code-block {
		display: flex;
		align-items: baseline;
		gap: 0.6rem;
		min-width: 0;
	}
	.code {
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 1.2rem;
		font-weight: 800;
		color: #2dd4bf;
		overflow-wrap: anywhere;
	}
	.hidden-note {
		font-size: 0.7rem;
		color: #888;
		text-transform: uppercase;
		letter-spacing: 1px;
		font-weight: 800;
	}
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.chips li {
		padding: 0.25rem 0.6rem;
		border-radius: 999px;
		border: 1px solid #333;
		background: #0a0a0a;
		color: #aaa;
		font-size: 0.75rem;
		font-weight: 700;
	}
	.chips li.good {
		border-color: rgba(74, 222, 128, 0.4);
		color: #86efac;
	}
	.chips li.bad {
		border-color: rgba(248, 113, 113, 0.5);
		color: #fca5a5;
	}
	.chips a {
		color: inherit;
		text-decoration: none;
	}
	.chips a:hover {
		text-decoration: underline;
	}

	form {
		display: flex;
		flex-direction: column;
		gap: 0.8rem;
	}
	.fields {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.8rem;
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		min-width: 0;
	}
	.field > span {
		font-size: 0.7rem;
		font-weight: 800;
		text-transform: uppercase;
		letter-spacing: 1px;
		color: #999;
	}
	.field em {
		font-style: normal;
		text-transform: none;
		letter-spacing: 0;
		font-weight: 600;
		color: #666;
	}
	.field input {
		min-height: 46px;
		padding: 0.6rem 0.8rem;
		background: #050505;
		border: 1px solid #333;
		border-radius: 10px;
		color: #fff;
		font-size: 1rem;
	}
	.field input:focus {
		outline: none;
		border-color: #2dd4bf;
		box-shadow: 0 0 0 3px rgba(45, 212, 191, 0.15);
	}
	.field input.changed {
		border-color: #fb923c;
	}
	.field .field-error {
		font-size: 0.75rem;
	}

	.hand-over {
		display: flex;
		align-items: flex-start;
		gap: 0.7rem;
		padding: 0.7rem 0.8rem;
		border: 1px solid #2a2a2a;
		border-radius: 12px;
		background: #0a0a0a;
		cursor: pointer;
	}
	.hand-over.on {
		border-color: #fb923c;
		background: rgba(251, 146, 60, 0.07);
	}
	.hand-over input {
		width: 20px;
		height: 20px;
		margin-top: 0.1rem;
		flex-shrink: 0;
		accent-color: #fb923c;
		color: #f97316;
	}
	.hand-over span {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
	}
	.hand-over strong {
		font-size: 0.85rem;
		color: #fff;
	}
	.hand-over small {
		font-size: 0.75rem;
		color: #999;
	}
	.effects {
		margin: 0;
		padding: 0.2rem 0 0 1.4rem;
		color: #fdba74;
		font-size: 0.8rem;
		line-height: 1.5;
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
	}

	/* A form too: row here, not the column of the address form below. */
	.payment {
		display: flex;
		flex-direction: row;
		align-items: center;
		justify-content: space-between;
		gap: 0.8rem;
		padding: 0.7rem 0.8rem;
		border: 1px solid rgba(74, 222, 128, 0.35);
		border-radius: 12px;
		background: #0a0a0a;
	}
	.payment.unpaid {
		border-color: rgba(248, 113, 113, 0.5);
		background: rgba(248, 113, 113, 0.06);
	}
	.payment p {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		margin: 0;
		min-width: 0;
	}
	.payment strong {
		font-size: 0.85rem;
		color: #fff;
	}
	.payment small {
		font-size: 0.75rem;
		color: #999;
		overflow-wrap: anywhere;
	}
	.payment button {
		flex-shrink: 0;
	}
	.btn-paid {
		min-height: 44px;
		padding: 0 1.3rem;
		border-radius: 10px;
		font-weight: 900;
		letter-spacing: 0.5px;
		cursor: pointer;
		font-size: 0.85rem;
		background: #4ade80;
		color: #000;
		border: none;
	}
	.btn-paid:disabled,
	.payment .btn-ghost:disabled {
		opacity: 0.35;
		cursor: not-allowed;
	}

	/* The booking: like the payment row, with Move and Release on the right. */
	.spot-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.8rem;
		padding: 0.7rem 0.8rem;
		border: 1px solid #2a2a2a;
		border-radius: 12px;
		background: #0a0a0a;
	}
	.spot-row.crew {
		border-color: rgba(167, 139, 250, 0.45);
	}
	.spot-row p {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		margin: 0;
		min-width: 0;
	}
	.spot-row strong {
		font-size: 0.85rem;
		color: #fff;
		overflow-wrap: anywhere;
	}
	.spot-row small {
		font-size: 0.75rem;
		color: #999;
		overflow-wrap: anywhere;
	}
	.spot-buttons {
		display: flex;
		gap: 0.5rem;
		flex-shrink: 0;
	}
	.spot-buttons form {
		display: contents;
	}
	.spot-buttons button:disabled {
		opacity: 0.35;
		cursor: not-allowed;
	}
	.btn-release:hover:not(:disabled) {
		color: #fca5a5;
		border-color: rgba(248, 113, 113, 0.6);
	}

	.buttons {
		display: flex;
		justify-content: flex-end;
		gap: 0.6rem;
	}
	.btn-save,
	.btn-ghost {
		min-height: 44px;
		padding: 0 1.3rem;
		border-radius: 10px;
		font-weight: 900;
		letter-spacing: 0.5px;
		cursor: pointer;
		font-size: 0.85rem;
	}
	.btn-save {
		background: #2dd4bf;
		color: #000;
		border: none;
	}
	.btn-save.warn {
		background: #fb923c;
	}
	.btn-save:disabled {
		opacity: 0.35;
		cursor: not-allowed;
	}
	.btn-ghost {
		background: transparent;
		color: #aaa;
		border: 1px solid #333;
	}
	.btn-ghost:hover {
		color: #fff;
		border-color: #666;
	}

	@media (max-width: 640px) {
		.ticket {
			padding: 0.85rem 0.8rem;
		}
		.fields {
			grid-template-columns: 1fr;
		}
		.payment,
		.spot-row {
			flex-direction: column;
			align-items: stretch;
		}
		.spot-buttons button {
			flex: 1;
		}
		.buttons {
			position: sticky;
			bottom: 0.5rem;
		}
		.btn-save {
			flex: 1;
		}
	}
</style>
