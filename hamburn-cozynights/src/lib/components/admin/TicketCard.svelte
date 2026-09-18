<!--
@component
One ticket in the admin's ticket search: what it holds, its e-mail address and
name to edit in place, and the hand-over to a new holder ("passed on"). Saves
through ?/update of the ticket page and fires `saved` with the fresh ticket.
-->
<script lang="ts">
	import { applyAction, enhance } from '$app/forms';
	import { createEventDispatcher } from 'svelte';
	import { slide } from 'svelte/transition';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { toast } from '$lib/dialogs';
	import {
		TICKET_LIMITS,
		isValidGuestEmail,
		normalizeEmail,
		type TicketChangeOutcome,
		type TicketView
	} from '$lib/tickets';

	export let ticket: TicketView;

	const dispatch = createEventDispatcher<{ saved: TicketView }>();

	let email = ticket.email;
	let name = ticket.name;
	let newHolder = false;
	let saving = false;
	let error = '';

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

	/** What "passed on" does to this ticket, in the admin's words. */
	$: handOver = [
		ticket.spot ? 'The spot stays with the ticket.' : '',
		ticket.telegram ? 'Telegram updates to the old holder stop.' : '',
		ticket.pass ? 'The booking pass gets a new code: the old pass link stops working.' : '',
		ticket.burnerName ? `The burner name "${ticket.burnerName}" is forgotten.` : '',
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
				(outcome.confirmation ? `: ${outcome.ticket.email} gets a confirmation shortly.` : '.')
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

	const submit: SubmitFunction = ({ cancel }) => {
		if (!dirty || emailProblem || nameProblem) {
			cancel();
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
			} else if (result.type === 'error') {
				error = 'The server could not be reached. Nothing was saved; try again.';
			} else {
				// A redirect: the session ended.
				await applyAction(result);
			}
		};
	};
</script>

<article class="ticket" class:dirty>
	<header class="ticket-head">
		<div class="code-block">
			<span class="code" title={ticket.codeMasked ? 'Found by e-mail: the code stays hidden' : ''}>
				{ticket.code || '(no code)'}
			</span>
			{#if ticket.codeMasked}<span class="hidden-note">code hidden</span>{/if}
		</div>
		<ul class="chips" aria-label="Ticket state">
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
			{#if ticket.burnerName}<li>🔥 {ticket.burnerName}</li>{/if}
			{#if ticket.telegram}<li>💬 Telegram</li>{/if}
		</ul>
	</header>

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
					class:invalid={!!emailProblem}
					aria-invalid={!!emailProblem}
				/>
				{#if emailProblem}<small class="problem">{emailProblem}</small>{/if}
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
					class:invalid={!!nameProblem}
					aria-invalid={!!nameProblem}
				/>
				{#if nameProblem}<small class="problem">{nameProblem}</small>{/if}
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

		{#if error}<p class="error" role="alert">⚠️ {error}</p>{/if}

		<div class="buttons">
			{#if dirty}
				<button type="button" class="btn-ghost" on:click={() => reset(ticket)} disabled={saving}>
					Undo
				</button>
			{/if}
			<button
				type="submit"
				class="btn-save"
				class:warn={newHolder}
				disabled={!dirty || saving || !!emailProblem || !!nameProblem}
			>
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
	.field input.invalid {
		border-color: #ef4444;
	}
	.problem {
		color: #f87171;
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
	.error {
		margin: 0;
		color: #f87171;
		font-size: 0.85rem;
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
		.buttons {
			position: sticky;
			bottom: 0.5rem;
		}
		.btn-save {
			flex: 1;
		}
	}
</style>
