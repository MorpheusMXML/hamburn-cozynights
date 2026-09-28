<!--
@component
ADD ROOMS on a house page: the house generator's size rows for a house that
stands already (docs/admin/camp-layout.md). Numbers continue after the
house's last room, names are rolled, spots are B1 … Bn, stacked in pairs
with 🪜. The server creates all of it or nothing (?/createRooms).
-->
<script lang="ts">
	import type { SubmitFunction } from '@sveltejs/kit';
	import { enhance } from '$app/forms';
	import { toast } from '$lib/dialogs';
	import { revealInvalid } from '$lib/field-alert';
	import {
		formatSizes,
		planTotals,
		type PlanProblem,
		type RoomPlan,
		type RoomSize
	} from '$lib/house-plan';
	import { lockAttrs, type LockHint } from '$lib/layout-lock';
	import RoomSizes from './RoomSizes.svelte';

	/** The layout is locked: everything is read-only and says why when tried. */
	export let lock: LockHint | null = null;
	/** What a room of this house is called: room, hut, tent, place. */
	export let word = 'room';
	export let plural = 'rooms';
	/** Room numbers the house has already. */
	export let existing: number[] = [];
	/** The row the form starts with (suggestSize: one more of the house's usual room). */
	export let suggested: RoomSize;

	let sizes: RoomSize[] = [{ ...suggested }];
	let floors = false;
	let firstNumber = '';
	let plan: RoomPlan;
	let problem: PlanProblem | null = null;
	let refusal = '';
	let submitting = false;

	$: totals = planTotals(sizes);
	$: what = (totals.rooms === 1 ? word : plural).toUpperCase();

	/** "Glitter Grotto, Disco Den and 4 more" */
	function someNames(names: string[]): string {
		if (names.length <= 3) return names.join(', ');
		return `${names.slice(0, 3).join(', ')} and ${names.length - 3} more`;
	}

	// The form is `novalidate`: the plan's own check (in RoomSizes) speaks
	// English, and the server checks the same rules again.
	const handleSubmit: SubmitFunction = ({ formElement, cancel }) => {
		if (lock) {
			// LockHintHost stops the clicks; this is the net for anything else.
			cancel();
			return;
		}
		refusal = '';
		if (problem) {
			refusal = problem.message;
			cancel();
			revealInvalid(formElement);
			return;
		}

		submitting = true;
		return async ({ result, update }) => {
			submitting = false;
			if (result.type === 'success') {
				const made = (result.data ?? {}) as { rooms?: number; spots?: number; names?: string[] };
				const count = made.rooms ?? 0;
				toast(
					`🚪 ${count} ${count === 1 ? word : plural} with ${made.spots ?? 0} spots added: ${someNames(made.names ?? [])}.`,
					'success',
					7000
				);
				// Not a form reset: the steppers show state, and state starts over.
				await update({ reset: false });
				sizes = [{ ...suggested }];
				firstNumber = '';
			} else if (result.type === 'failure') {
				refusal =
					(result.data as { message?: string } | undefined)?.message ||
					`The ${plural} were not added. Reload the page and try again.`;
				revealInvalid(formElement);
			} else if (result.type === 'error') {
				refusal = `The ${plural} were not added because the server could not be reached. Check your connection and try again.`;
			} else {
				await update({ reset: false });
			}
		};
	};
</script>

<form
	method="POST"
	action="?/createRooms"
	class="add-rooms-form"
	novalidate
	use:enhance={handleSubmit}
>
	<input type="hidden" name="sizes" value={formatSizes(sizes)} />
	{#if floors}<input type="hidden" name="floors" value="on" />{/if}
	<input type="hidden" name="first_number" value={firstNumber.trim()} />

	<RoomSizes
		bind:sizes
		bind:floors
		bind:firstNumber
		bind:plan
		bind:problem
		bind:refusal
		{existing}
		{word}
		{plural}
		{lock}
		idPrefix="add-rooms"
	/>

	<button type="submit" class="btn-ignite" disabled={submitting} {...lockAttrs(lock)}>
		{submitting ? 'IGNITING…' : `IGNITE ${totals.rooms > 0 ? `${totals.rooms} ` : ''}${what} ✨`}
	</button>
</form>

<style>
	.add-rooms-form {
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
	}
	.btn-ignite {
		background: #2dd4bf;
		color: #000;
		min-height: 44px;
		padding: 0.9rem 1rem;
		border: none;
		border-radius: 8px;
		cursor: pointer;
		font-weight: 900;
		font-size: 0.8rem;
		letter-spacing: 1px;
		transition: all 0.2s;
		box-shadow: 0 0 15px rgba(45, 212, 191, 0.3);
	}
	.btn-ignite:hover:not(:disabled):not([data-locked]) {
		transform: scale(1.02);
		box-shadow: 0 0 25px rgba(45, 212, 191, 0.5);
	}
	.btn-ignite:disabled {
		opacity: 0.3;
		cursor: not-allowed;
		box-shadow: none;
		transform: none;
	}
</style>
