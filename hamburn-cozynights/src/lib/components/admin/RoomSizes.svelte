<!--
@component
The size rows of the house generator (docs/admin/camp-layout.md): one row
per room size — "4 rooms × 6 beds", 🪜 for bunk beds — plus where the room
numbers start and whether every size opens its own block of numbers. The
line underneath counts live what IGNITE will build ($lib/house-plan), with
the room numbers it will use.

The parent binds `sizes`, `floors` and `firstNumber` and reads `plan` and
`problem` back (bind), so its button knows whether the plan can be built.
-->
<script lang="ts">
	import { tick } from 'svelte';
	import NumberStepper from './NumberStepper.svelte';
	import {
		PLAN_LIMITS,
		defaultFirstNumber,
		nextSize,
		numberRanges,
		planProblem,
		planRooms,
		planTotals,
		type PlanProblem,
		type RoomPlan,
		type RoomSize
	} from '$lib/house-plan';
	import { lockAttrs, type LockHint } from '$lib/layout-lock';

	export let sizes: RoomSize[];
	export let floors = false;
	/** The typed first room number; empty: the next free one. */
	export let firstNumber = '';
	/** Room numbers the house has already. */
	export let existing: number[] = [];
	/** What a room of this house is called: room, hut, tent, place. */
	export let word = 'room';
	export let plural = 'rooms';
	/** A new house may start without rooms; adding rooms needs one size at least. */
	export let allowEmpty = false;
	export let lock: LockHint | null | undefined = null;
	/** Out: the plan as it stands, and why it can't be built (null when it can). */
	export let plan: RoomPlan = { sizes, floors, firstNumber: null };
	export let problem: PlanProblem | null = null;
	/** Why the last try was refused (by the server, or the parent's own check); cleared by the next change. */
	export let refusal = '';
	/** Unique ids when a page holds more than one. */
	export let idPrefix = 'plan';

	$: typedFirst = firstNumber.trim();
	$: plan = {
		sizes,
		floors,
		firstNumber: typedFirst === '' ? null : /^\d{1,4}$/.test(typedFirst) ? Number(typedFirst) : NaN
	};
	$: problem = planProblem(plan, { existing, allowEmpty, word, plural });
	$: totals = planTotals(sizes);
	$: ranges = problem ? '' : numberRanges(planRooms(plan, existing).map((room) => room.number));
	$: placeholder = String(defaultFirstNumber(existing, floors));
	$: Word = word.charAt(0).toUpperCase() + word.slice(1);
	$: Plural = plural.charAt(0).toUpperCase() + plural.slice(1);

	// Any change makes the server's last word old news.
	const last = { plan: '' };
	$: forgetRefusal(JSON.stringify([sizes, floors, firstNumber]));

	function forgetRefusal(now: string) {
		if (last.plan && now !== last.plan) refusal = '';
		last.plan = now;
	}

	async function add() {
		if (lock || sizes.length >= PLAN_LIMITS.sizes) return;
		sizes = [...sizes, nextSize(sizes)];
		await tick();
		document.getElementById(`${idPrefix}-rooms-${sizes.length - 1}`)?.focus();
	}

	function remove(index: number) {
		if (lock) return;
		sizes = sizes.filter((_, i) => i !== index);
	}

	function toggleBunks(index: number) {
		if (lock) return;
		sizes[index] = { ...sizes[index], bunks: !sizes[index].bunks };
	}

	const rowOf = (p: PlanProblem | null) => (p?.row === undefined ? -1 : p.row);
</script>

<div class="room-sizes">
	<span class="group-label" id="{idPrefix}-label">{plural.toUpperCase()} & BEDS 🛌</span>

	{#if sizes.length > 0}
		<ul class="size-rows" aria-labelledby="{idPrefix}-label">
			<!-- Rows are positions: removing one moves the rows below it up. -->
			{#each sizes as size, i (i)}
				<li class="size-row" class:invalid={rowOf(problem) === i}>
					<span class="size-part">
						<NumberStepper
							id="{idPrefix}-rooms-{i}"
							bind:value={size.rooms}
							max={PLAN_LIMITS.roomsPerHouse}
							label="{Plural} of size {i + 1}"
							invalid={rowOf(problem) === i && problem?.field === 'rooms'}
							{lock}
						/>
						<span class="unit">{size.rooms === 1 ? word : plural}</span>
					</span>
					<span class="times" aria-hidden="true">×</span>
					<span class="size-part">
						<NumberStepper
							id="{idPrefix}-beds-{i}"
							bind:value={size.beds}
							max={PLAN_LIMITS.bedsPerRoom}
							label="Beds per {word} of size {i + 1}"
							invalid={rowOf(problem) === i && problem?.field === 'beds'}
							{lock}
						/>
						<span class="unit">{size.beds === 1 ? 'bed' : 'beds'}</span>
					</span>
					<span class="row-tools">
						<button
							type="button"
							class="btn-bunks"
							aria-pressed={size.bunks}
							aria-label="Bunk beds in size {i + 1}"
							title="Bunk beds: B1 + B2 stacked, B3 + B4, …"
							on:click={() => toggleBunks(i)}
							{...lockAttrs(lock)}><span aria-hidden="true">🪜</span></button
						>
						<button
							type="button"
							class="btn-remove"
							aria-label="Remove size {i + 1}"
							title="Remove this size"
							disabled={!lock && !allowEmpty && sizes.length === 1}
							on:click={() => remove(i)}
							{...lockAttrs(lock)}><span aria-hidden="true">✕</span></button
						>
					</span>
				</li>
			{/each}
		</ul>
	{/if}

	<button
		type="button"
		class="btn-add-size"
		disabled={!lock && sizes.length >= PLAN_LIMITS.sizes}
		on:click={add}
		{...lockAttrs(lock)}
	>
		+ {sizes.length > 0 ? 'ANOTHER' : 'ADD A'}
		{word.toUpperCase()} SIZE
	</button>

	{#if sizes.length > 0}
		<div class="numbering">
			<label class="first-number" for="{idPrefix}-first">
				<span>NUMBERS FROM #</span>
				<input
					id="{idPrefix}-first"
					type="text"
					inputmode="numeric"
					autocomplete="off"
					maxlength="4"
					bind:value={firstNumber}
					{placeholder}
					aria-invalid={problem?.field === 'firstNumber'}
					aria-describedby="{idPrefix}-summary"
					readonly={!!lock}
					{...lockAttrs(lock)}
				/>
			</label>
			<button
				type="button"
				class="btn-floors"
				aria-pressed={floors}
				title="Every size starts its own block of numbers: 1–4, then 11–16, then 21–…"
				on:click={() => !lock && (floors = !floors)}
				{...lockAttrs(lock)}
			>
				🏢 FLOOR BLOCKS
			</button>
		</div>
	{/if}

	<p class="plan-summary" id="{idPrefix}-summary" aria-live="polite">
		{#if problem}
			<!-- Once a try was refused for it, the alert below says it instead. -->
			{#if refusal !== problem.message}<span class="summary-problem">{problem.message}</span>{/if}
		{:else if totals.rooms === 0}
			<span class="summary-empty">Just the house, no {plural} yet: add them on its page later.</span
			>
		{:else}
			<!-- &nbsp;: Svelte trims plain spaces at the start of the {#if} block. -->
			<span class="totals"
				>= <strong>{totals.rooms}</strong>
				{totals.rooms === 1 ? word : plural}&nbsp;· <strong>{totals.spots}</strong>
				{totals.spots === 1 ? 'spot' : 'spots'}{#if totals.bunkBeds > 0}&nbsp;· <strong
						>{totals.bunkBeds}</strong
					>
					bunk {totals.bunkBeds === 1 ? 'bed' : 'beds'}{/if}</span
			>
			<span class="ranges">{ranges}</span>
			<span class="names-note">{Word} names are rolled, rename them any time.</span>
		{/if}
	</p>
	{#if refusal}
		<p class="field-error" role="alert">{refusal}</p>
	{/if}
</div>

<style>
	.room-sizes {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		min-width: 0;
	}
	.group-label {
		font-size: 0.7rem;
		font-weight: 900;
		color: #888;
		letter-spacing: 1px;
	}
	.size-rows {
		list-style: none;
		/* On a wide page the tools stay next to the numbers. */
		max-width: 34rem;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.45rem;
	}
	.size-row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.35rem 0.3rem;
		padding: 0.4rem;
		background: #080808;
		border: 1px solid #1c1c1c;
		border-radius: 10px;
		transition: border-color 0.2s;
	}
	.size-row.invalid {
		border-color: rgba(239, 68, 68, 0.6);
	}
	.size-part {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		min-width: 0;
	}
	.unit {
		color: #aaa;
		font-size: 0.75rem;
		font-weight: 700;
	}
	.times {
		color: #666;
		font-weight: 400;
	}
	.row-tools {
		display: inline-flex;
		align-items: center;
		gap: 0.2rem;
		margin-left: auto;
	}
	.btn-bunks,
	.btn-remove {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		height: 38px;
		padding: 0;
		border-radius: 8px;
		cursor: pointer;
		transition:
			border-color 0.2s,
			background 0.2s,
			box-shadow 0.2s,
			opacity 0.2s;
	}
	.btn-bunks {
		width: 36px;
		background: #050505;
		border: 1px solid #262626;
		font-size: 1.05rem;
		/* Off: a faded ladder; on: turquoise like the bunk tiles. */
		filter: grayscale(1);
		opacity: 0.55;
	}
	.btn-bunks[aria-pressed='true'] {
		filter: none;
		opacity: 1;
		border-color: #2dd4bf;
		background: rgba(45, 212, 191, 0.12);
		box-shadow: 0 0 10px rgba(45, 212, 191, 0.25);
	}
	.btn-remove {
		width: 26px;
		background: transparent;
		border: 1px solid transparent;
		color: #666;
		font-size: 0.85rem;
	}
	.btn-remove:hover:not(:disabled):not([data-locked]) {
		color: #f87171;
		border-color: rgba(248, 113, 113, 0.4);
	}
	.btn-remove:disabled {
		opacity: 0.25;
		cursor: default;
	}
	.btn-add-size {
		align-self: flex-start;
		min-height: 36px;
		padding: 0.4rem 0.8rem;
		background: transparent;
		border: 1px dashed #333;
		border-radius: 8px;
		color: #2dd4bf;
		font-size: 0.7rem;
		font-weight: 900;
		letter-spacing: 1px;
		cursor: pointer;
	}
	.btn-add-size:hover:not(:disabled):not([data-locked]) {
		border-color: #2dd4bf;
	}
	.btn-add-size:disabled {
		opacity: 0.35;
		cursor: default;
	}
	.numbering {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem 0.75rem;
	}
	.first-number {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.65rem;
		font-weight: 900;
		color: #888;
		letter-spacing: 1px;
	}
	.first-number input {
		width: 4.2rem;
		height: 40px;
		box-sizing: border-box;
		padding: 0 0.5rem;
		background: #050505;
		border: 1px solid #262626;
		border-radius: 8px;
		color: #fff;
		/* 16px: iOS Safari zooms into smaller fields */
		font-size: 1rem;
		font-weight: 800;
		font-variant-numeric: tabular-nums;
		letter-spacing: 0;
	}
	.first-number input::placeholder {
		color: #555;
	}
	.first-number input:focus {
		outline: none;
		border-color: #2dd4bf;
		box-shadow: 0 0 10px rgba(45, 212, 191, 0.2);
	}
	.first-number input[aria-invalid='true'] {
		border-color: #ef4444;
	}
	.btn-floors {
		min-height: 40px;
		padding: 0 0.75rem;
		background: #050505;
		border: 1px solid #262626;
		border-radius: 999px;
		color: #777;
		font-size: 0.65rem;
		font-weight: 900;
		letter-spacing: 1px;
		cursor: pointer;
		transition:
			border-color 0.2s,
			color 0.2s,
			background 0.2s;
	}
	.btn-floors[aria-pressed='true'] {
		border-color: #f472b6;
		color: #f472b6;
		background: rgba(244, 114, 182, 0.08);
	}
	.plan-summary {
		margin: 0;
		display: flex;
		flex-wrap: wrap;
		gap: 0.2rem 0.6rem;
		align-items: baseline;
		font-size: 0.8rem;
		line-height: 1.45;
		color: #bbb;
	}
	.totals strong {
		color: #2dd4bf;
		font-size: 0.95rem;
	}
	.ranges {
		color: #f472b6;
		font-family: monospace;
		font-size: 0.8rem;
		overflow-wrap: anywhere;
	}
	.names-note {
		flex-basis: 100%;
		color: #666;
		font-size: 0.7rem;
		font-style: italic;
	}
	.summary-problem {
		color: #fb923c;
		font-weight: 700;
	}
	.summary-empty {
		color: #888;
	}
	.field-error {
		margin: 0;
		font-size: 0.8rem;
	}
</style>
