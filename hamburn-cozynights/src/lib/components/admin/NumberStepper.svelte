<!--
@component
A whole number with − and +, for the size rows of the house generator. The
number can be typed too: ↑/↓ step by one, with Shift by five. A typed value
out of range is kept as typed, so the plan's check can say what is wrong;
leaving the field puts an empty or unreadable one back to the last good value.
-->
<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import { lockAttrs, type LockHint } from '$lib/layout-lock';

	export let value: number;
	export let min = 1;
	export let max = 50;
	/** The field's name for screen readers, e.g. "Rooms of size 1". */
	export let label: string;
	export let id: string | undefined = undefined;
	export let invalid = false;
	export let lock: LockHint | null | undefined = null;

	const dispatch = createEventDispatcher<{ change: number }>();

	let text = String(value);
	let focused = false;
	let lastGood = value;

	// Steps and outside changes show up in the field, unless someone is typing there.
	$: if (!focused && Number.isFinite(value)) text = String(value);
	$: if (Number.isInteger(value) && value >= min && value <= max) lastGood = value;

	function set(next: number) {
		value = Math.min(max, Math.max(min, next));
		text = String(value);
		dispatch('change', value);
	}

	function step(by: number) {
		if (lock) return;
		set((Number.isFinite(value) ? value : lastGood) + by);
	}

	function typed() {
		const clean = text.trim();
		value = /^\d{1,4}$/.test(clean) ? Number(clean) : NaN;
		dispatch('change', value);
	}

	function keydown(event: KeyboardEvent) {
		if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
		event.preventDefault();
		step((event.key === 'ArrowUp' ? 1 : -1) * (event.shiftKey ? 5 : 1));
	}

	function blur() {
		focused = false;
		if (!Number.isFinite(value)) set(lastGood);
	}
</script>

<span class="stepper" class:invalid>
	<button
		type="button"
		class="step"
		tabindex="-1"
		aria-label="{label}: one less"
		disabled={!lock && Number.isFinite(value) && value <= min}
		on:click={() => step(-1)}
		{...lockAttrs(lock)}>−</button
	>
	<input
		{id}
		type="text"
		inputmode="numeric"
		autocomplete="off"
		aria-label={label}
		aria-invalid={invalid}
		bind:value={text}
		on:input={typed}
		on:keydown={keydown}
		on:focus={() => (focused = true)}
		on:blur={blur}
		readonly={!!lock}
		{...lockAttrs(lock)}
	/>
	<button
		type="button"
		class="step"
		tabindex="-1"
		aria-label="{label}: one more"
		disabled={!lock && Number.isFinite(value) && value >= max}
		on:click={() => step(1)}
		{...lockAttrs(lock)}>+</button
	>
</span>

<style>
	.stepper {
		display: inline-flex;
		align-items: stretch;
		flex: 0 0 auto;
		height: 38px;
		background: #050505;
		border: 1px solid #262626;
		border-radius: 8px;
		overflow: hidden;
		transition:
			border-color 0.2s,
			box-shadow 0.2s;
	}
	.stepper:focus-within {
		border-color: #2dd4bf;
		box-shadow: 0 0 10px rgba(45, 212, 191, 0.2);
	}
	.stepper.invalid {
		border-color: #ef4444;
	}
	.step {
		width: 24px;
		padding: 0;
		background: transparent;
		border: none;
		color: #2dd4bf;
		font-size: 1.05rem;
		font-weight: 900;
		cursor: pointer;
	}
	.step:hover:not(:disabled):not([data-locked]) {
		background: rgba(45, 212, 191, 0.12);
	}
	.step:disabled {
		color: #333;
		cursor: default;
	}
	input {
		width: 2rem;
		min-width: 0;
		padding: 0;
		background: transparent;
		border: none;
		border-left: 1px solid #1c1c1c;
		border-right: 1px solid #1c1c1c;
		color: #fff;
		text-align: center;
		/* 16px: iOS Safari zooms into smaller fields */
		font-size: 1rem;
		font-weight: 800;
		font-variant-numeric: tabular-nums;
	}
	/* The box shows the focus (:focus-within); the forms plugin would paint the edges blue. */
	input:focus {
		outline: none;
		border-color: #1c1c1c;
		box-shadow: none;
	}
	/* Locked: the number stays readable (the fields' padlock would cover it),
	   and one padlock on the + button speaks for the whole stepper. */
	.stepper input[data-locked] {
		padding: 0 !important;
		background-image: none !important;
	}
	.stepper .step:first-child[data-locked]::before {
		display: none;
	}
	@media (max-width: 640px) {
		.stepper {
			height: 44px;
		}
		.step {
			width: 36px;
		}
	}
</style>
