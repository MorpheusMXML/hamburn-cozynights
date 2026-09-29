<!--
@component
The name plate under the reels (/random-bed): the burner name that goes with
the spot. Keep the one the ticket already has, type your own, or roll one:
🎲 runs a small reel through rolled names (the same source the server draws
from, $lib/burner-names) and drops the result into the field, where it can
still be changed. The field is the booking form's `guestName`.
-->
<script lang="ts">
	import { tick } from 'svelte';
	import { randomBurnerName } from '$lib/burner-names';
	import { tickTimes } from '$lib/roulette';

	let {
		value = $bindable(''),
		locked = false,
		ontick,
		onrolled
	}: {
		value?: string;
		/** A booking is on its way: the name can't change now. */
		locked?: boolean;
		/** One name flew past (for the clicker sound). */
		ontick?: () => void;
		/** The roll stopped on a name. */
		onrolled?: () => void;
	} = $props();

	const ROLL_MS = 950;
	const ROLL_ROWS = 14;

	let strip = $state<string[] | null>(null);
	let stripEl = $state<HTMLDivElement>();
	let timers: ReturnType<typeof setTimeout>[] = [];

	$effect(() => () => timers.forEach(clearTimeout));

	/** Rolls a random burner name into the field. */
	export async function roll(): Promise<void> {
		if (strip || locked) return;
		const final = randomBurnerName();
		const rows = [final];
		for (let i = 1; i < ROLL_ROWS - 1; i++) {
			rows.push(randomBurnerName());
		}
		rows.push(value.trim() || '…');
		const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		if (!still) {
			strip = rows;
			await tick();
		}
		if (stripEl && typeof stripEl.animate === 'function') {
			timers.forEach(clearTimeout);
			timers = tickTimes(ROLL_ROWS - 1, ROLL_MS).map((t) => setTimeout(() => ontick?.(), t));
			const shift = (-(rows.length - 1) / rows.length) * 100;
			await stripEl
				.animate([{ transform: `translateY(${shift}%)` }, { transform: 'translateY(0%)' }], {
					duration: ROLL_MS,
					// ease-out quad, the curve tickTimes() clicks along
					easing: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)',
					fill: 'forwards'
				})
				.finished.catch(() => {});
		}
		value = final;
		strip = null;
		onrolled?.();
	}
</script>

<div class="plate" class:rolling={strip !== null}>
	<label class="plate-title" for="guestName">Your burner name</label>
	<div class="plate-row">
		<div class="field">
			<input
				id="guestName"
				name="guestName"
				type="text"
				bind:value
				maxlength="80"
				autocomplete="off"
				autocapitalize="words"
				spellcheck="false"
				enterkeyhint="done"
				placeholder="Type a name or roll one"
				aria-describedby="guestName-hint"
				readonly={locked || strip !== null}
			/>
			{#if strip}
				<div class="name-reel" aria-hidden="true" data-layout-ignore>
					<div class="name-strip" bind:this={stripEl} style="--rows: {strip.length}">
						{#each strip as row, i (i)}
							<span>{row}</span>
						{/each}
					</div>
				</div>
			{/if}
		</div>
		<button
			type="button"
			class="dice"
			onclick={() => roll()}
			disabled={locked || strip !== null}
			aria-label="Roll a random burner name"
			title="Roll a random burner name"><span aria-hidden="true">🎲</span></button
		>
	</div>
	<small id="guestName-hint" class="plate-hint"
		>Everyone sees this name next to your spot. Keep it, type your own or roll the dice.</small
	>
</div>

<style>
	.plate {
		--h: 3.1rem;
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		text-align: left;
	}
	.plate-title {
		font-size: 0.68rem;
		font-weight: 900;
		letter-spacing: 0.2em;
		text-transform: uppercase;
		color: #f9a8d4;
	}
	.plate-row {
		display: flex;
		gap: 0.55rem;
	}
	.field {
		position: relative;
		flex: 1 1 auto;
		min-width: 0;
	}
	input {
		width: 100%;
		height: var(--h);
		padding: 0 0.9rem;
		border: 2px solid #3f3450;
		border-radius: 12px;
		background: #0b0910;
		color: #fff;
		font-size: 1.05rem;
		font-weight: 800;
	}
	input::placeholder {
		color: #8a8196;
		font-weight: 600;
	}
	input:focus {
		outline: none;
		border-color: #f472b6;
		box-shadow: 0 0 0 3px rgba(244, 114, 182, 0.25);
	}

	/* The name roll, over the field while it runs. */
	.name-reel {
		position: absolute;
		inset: 0;
		overflow: hidden;
		border: 2px solid #f472b6;
		border-radius: 12px;
		background: #0b0910;
		box-shadow: 0 0 18px rgba(244, 114, 182, 0.35);
	}
	.name-strip {
		position: absolute;
		inset: 0 0 auto;
		height: calc(var(--rows) * (var(--h) - 4px));
		display: flex;
		flex-direction: column;
		will-change: transform;
	}
	.name-strip span {
		flex: none;
		height: calc(var(--h) - 4px);
		display: flex;
		align-items: center;
		padding: 0 0.8rem;
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
		font-size: 1.05rem;
		font-weight: 800;
		color: #fff;
	}

	.dice {
		flex: none;
		width: var(--h);
		height: var(--h);
		border: 2px solid #f472b6;
		border-radius: 12px;
		background: linear-gradient(145deg, #3b0f2e, #1a0d24);
		font-size: 1.45rem;
		line-height: 1;
		cursor: pointer;
		box-shadow: 0 0 14px rgba(244, 114, 182, 0.3);
	}
	.dice:hover:not(:disabled) {
		transform: rotate(-12deg) scale(1.06);
	}
	.dice:focus-visible {
		outline: 3px solid #fde68a;
		outline-offset: 3px;
	}
	.dice:disabled {
		cursor: progress;
		opacity: 0.75;
	}
	.rolling .dice span {
		display: inline-block;
		animation: tumble 0.3s linear infinite;
	}
	@keyframes tumble {
		to {
			transform: rotate(360deg);
		}
	}

	.plate-hint {
		font-size: 0.78rem;
		line-height: 1.4;
		color: #a39bb0;
	}

	@media (prefers-reduced-motion: reduce) {
		.rolling .dice span {
			animation: none;
		}
	}
</style>
