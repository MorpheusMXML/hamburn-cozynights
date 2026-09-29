<script lang="ts">
	import type { PageData, SubmitFunction } from './$types';
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import { toast } from '$lib/dialogs';
	import { revealInvalid } from '$lib/field-alert';
	import { layoutLock, lockAttrs } from '$lib/layout-lock';
	import { roomWord, type HouseKind } from '$lib/accommodation';
	import {
		DEFAULT_SIZE,
		formatSizes,
		type PlanProblem,
		type RoomPlan,
		type RoomSize
	} from '$lib/house-plan';
	import { rollHouseName } from '$lib/place-names';
	import LayoutLockNotice from '$lib/components/admin/LayoutLockNotice.svelte';
	import RollButton from '$lib/components/admin/RollButton.svelte';
	import HouseKindChips from '$lib/components/admin/HouseKindChips.svelte';
	import RoomSizes from '$lib/components/admin/RoomSizes.svelte';

	export let data: PageData;
	$: ({ x, y, isLayoutLocked, phase, isSuperuser, booking } = data);
	// Live Booking and Closed: no new houses; the form stays and says why.
	$: addLock = isLayoutLocked ? layoutLock(phase, isSuperuser)('add houses') : null;

	type Failure = { error?: string; field?: string };
	// Without JavaScript the failed action's result arrives here.
	export let form: Failure | null = null;

	// The house generator (docs/admin/camp-layout.md): a rolled name, the kind
	// and the size rows.
	let name = data.isLayoutLocked ? '' : data.rolledName;
	let rolled = name;
	let kind: HouseKind | '' = '';
	let sizes: RoomSize[] = [{ ...DEFAULT_SIZE }];
	let floors = false;
	let firstNumber = '';
	let plan: RoomPlan;
	let problem: PlanProblem | null = null;
	let refusal = '';

	let nameError = '';
	let formError = '';
	let submitting = false;

	$: showFailure(form);

	function showFailure(failure: Failure | null | undefined) {
		nameError = formError = '';
		if (!failure?.error) return;
		if (failure.field === 'name') nameError = failure.error;
		else if (failure.field === 'sizes' || failure.field === 'firstNumber') refusal = failure.error;
		else formError = failure.error;
	}

	function rollName() {
		if (addLock) return;
		name = rollHouseName(kind, [...data.houseNames, name]);
		rolled = name;
		nameError = '';
	}

	// A new kind rolls a fitting name, unless the name was typed.
	let lastKind: HouseKind | '' = '';
	$: kindChanged(kind);
	function kindChanged(next: HouseKind | '') {
		if (next === lastKind) return;
		lastKind = next;
		if (name === rolled) rollName();
	}

	// The form is `novalidate`: the browser's own validation bubbles follow the
	// browser language, these messages are always English. The server checks
	// the same rules again.
	const handleSubmit: SubmitFunction = ({ formElement, cancel }) => {
		if (addLock) {
			// LockHintHost stops the clicks; this is the net for anything else.
			cancel();
			return;
		}
		showFailure(null);
		refusal = '';
		if (!name.trim()) nameError = 'Enter a name for the house.';
		if (problem) refusal = problem.message;
		if (nameError || problem) {
			cancel();
			revealInvalid(formElement);
			return;
		}

		submitting = true;
		return async ({ result, update }) => {
			submitting = false;
			if (result.type === 'success') {
				const made = (result.data ?? {}) as { rooms?: number; spots?: number };
				toast(
					made.rooms
						? `🛖 "${name.trim()}" is up: ${made.rooms} ${roomWord(kind, made.rooms !== 1)}, ${made.spots ?? 0} spots. Drag its pin to the right place.`
						: `🛖 "${name.trim()}" was created. Drag its pin to the right place.`,
					'success',
					7000
				);
				await goto('/admin/camp', { invalidateAll: true });
			} else if (result.type === 'failure') {
				showFailure(result.data as Failure);
				revealInvalid(formElement);
			} else if (result.type === 'error') {
				formError =
					'The house was not created because the server could not be reached. Check your connection and try again.';
			} else {
				await update();
			}
		};
	};
</script>

<svelte:head>
	<title>New house · CozyNights</title>
</svelte:head>

<div class="edit-container">
	<nav class="breadcrumbs" aria-label="Breadcrumb">
		<a href="/admin/camp">Map & houses</a> <span class="sep">/</span>
		<span class="current">New house</span>
	</nav>
	<h1>Add New House 🛖</h1>
	<p class="coords-display">Location: 📍 X: {x} / Y: {y}</p>
	<p class="hint">You can drag the pin to another place on the Control Center map afterwards.</p>

	<div class="lock-slot">
		<LayoutLockNotice
			locked={isLayoutLocked}
			{phase}
			{isSuperuser}
			next={booking?.next}
			blocks="Houses can't be added."
		/>
	</div>

	<form method="POST" action="?/create" class="edit-form" novalidate use:enhance={handleSubmit}>
		<input type="hidden" name="x" value={x} />
		<input type="hidden" name="y" value={y} />
		<input type="hidden" name="kind" value={kind} />
		<input type="hidden" name="sizes" value={formatSizes(sizes)} />
		{#if floors}<input type="hidden" name="floors" value="on" />{/if}
		<input type="hidden" name="first_number" value={firstNumber.trim()} />

		<div class="form-group">
			<label for="name">House name</label>
			<div class="name-row">
				<input
					type="text"
					id="name"
					name="name"
					bind:value={name}
					placeholder="e.g. Eagle's Nest"
					autocomplete="off"
					maxlength="100"
					aria-invalid={!!nameError}
					aria-describedby={nameError ? 'name-error' : 'name-hint'}
					on:input={() => (nameError = '')}
					readonly={!!addLock}
					{...lockAttrs(addLock)}
				/>
				<RollButton label="Roll a new house name" lock={addLock} on:click={rollName} />
			</div>
			<p class="hint" id="name-hint">
				Rolled for you: keep it, roll again 🎲 or type your own. Rooms get rolled names too.
			</p>
			{#if nameError}
				<p class="field-error" id="name-error" role="alert">{nameError}</p>
			{/if}
		</div>

		<HouseKindChips bind:kind lock={addLock} />

		<RoomSizes
			bind:sizes
			bind:floors
			bind:firstNumber
			bind:plan
			bind:problem
			bind:refusal
			allowEmpty
			word={roomWord(kind)}
			plural={roomWord(kind, true)}
			lock={addLock}
			idPrefix="new-house"
		/>

		{#if formError}
			<p class="form-error" role="alert">{formError}</p>
		{/if}

		<div class="actions">
			<a href="/admin/camp" class="btn-cancel">Cancel</a>
			<button type="submit" class="btn-save" disabled={submitting} {...lockAttrs(addLock)}>
				{submitting ? 'Saving…' : 'Save House'}
			</button>
		</div>
	</form>
</div>

<style>
	.edit-container {
		max-width: 600px;
		margin: 4rem auto;
		padding: 2rem;
		background: #111;
		border-radius: 12px;
		border: 1px solid #333;
		box-sizing: border-box;
	}
	.breadcrumbs {
		font-size: 0.75rem;
		font-weight: 900;
		letter-spacing: 1px;
		color: #666;
		text-transform: uppercase;
		margin-bottom: 1rem;
	}
	.breadcrumbs a {
		color: #2dd4bf;
		text-decoration: none;
	}
	.breadcrumbs .current {
		color: #f472b6;
	}
	.sep {
		margin: 0 0.5rem;
		color: #333;
	}
	h1 {
		margin: 0 0 1rem;
		font-size: clamp(1.5rem, 6vw, 2rem);
	}
	.coords-display {
		color: #4ade80;
		font-family: monospace;
		background: rgba(74, 222, 128, 0.1);
		padding: 0.5rem;
		border-radius: 4px;
		display: inline-block;
		margin: 0;
	}
	.hint {
		margin: 0.5rem 0 0;
		color: #888;
		font-size: 0.8rem;
		line-height: 1.4;
	}
	.lock-slot {
		margin-top: 1.5rem;
	}
	.lock-slot :global(.lock-notice) {
		margin-bottom: 0;
	}
	.edit-form {
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
		margin-top: 2rem;
	}
	.form-group {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	label {
		font-weight: 700;
		font-size: 0.9rem;
	}
	.name-row {
		display: flex;
		gap: 0.5rem;
		min-width: 0;
	}
	.name-row input {
		flex: 1 1 auto;
	}
	input {
		background: #222;
		border: 1px solid #444;
		color: white;
		padding: 0.8rem;
		border-radius: 6px;
		/* 16px: iOS Safari zooms into smaller fields */
		font-size: 1rem;
		min-width: 0;
	}
	input:focus {
		outline: none;
		border-color: #2dd4bf;
	}
	.field-error {
		font-size: 0.85rem;
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 1rem;
		justify-content: flex-end;
		align-items: center;
	}
	.btn-save {
		background: #22c55e;
		color: #03150a;
		border: none;
		min-height: 44px;
		padding: 0.8rem 1.5rem;
		border-radius: 6px;
		cursor: pointer;
		font-weight: bold;
		font-size: 0.95rem;
	}
	.btn-save:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}
	.btn-cancel {
		color: #aaa;
		text-decoration: none;
		padding: 0.8rem;
		min-height: 44px;
		box-sizing: border-box;
		display: inline-flex;
		align-items: center;
	}

	@media (max-width: 640px) {
		.edit-container {
			margin: 1rem auto;
			padding: 1.25rem 1rem;
		}
	}
</style>
