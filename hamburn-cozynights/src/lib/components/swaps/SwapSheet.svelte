<!--
@component
The swap sheet of a room page: a guest who holds a spot taps a taken one and
asks its guest to trade. The two spots face each other as tickets ("You
give" / "You get") with the ⇄ circling between them; below, a vibe to pick
and a short note (both optional). Sending posts ?/askSwap on the room page;
then the note flies off as a paper plane and the sheet says what happens next.
A spot the guest asked for already shows the waiting request with "Take it
back" (?/withdrawSwap).

Nothing here says whether the other spot could be swapped at all: every taken
spot gets the same sheet (docs/admin/swaps.md, privacy).

Escape or the backdrop closes it (not while sending); Tab stays inside. With
reduced motion there is no orbit, no plane and no slide-in.
-->
<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { onDestroy, onMount, tick } from 'svelte';
	import { fade, fly } from 'svelte/transition';
	import { backOut, cubicOut } from 'svelte/easing';
	import SwapTicket from './SwapTicket.svelte';
	import {
		SWAP_HOURS,
		SWAP_NOTE_MAX,
		SWAP_OPEN_MAX,
		SWAP_VIBES,
		cleanSwapNote,
		swapNoteProblem,
		type SwapSpot
	} from '$lib/swaps';

	let {
		mine,
		target,
		name = '',
		askedId = '',
		openCount = 0,
		onclose
	}: {
		/** The guest's own spot: what they give. */
		mine: SwapSpot;
		/** The taken spot they tapped: what they would get. */
		target: SwapSpot;
		/** Its guest's burner name ('' when they have none). */
		name?: string;
		/** The guest's open request for this spot, if they asked already. */
		askedId?: string;
		/** How many requests of the guest are open. */
		openCount?: number;
		onclose: () => void;
	} = $props();

	const NO_CONNECTION =
		'We could not reach the server, so nothing was sent. Check your internet connection and try again.';

	type Stage = 'compose' | 'sending' | 'sent' | 'asked' | 'withdrawing' | 'withdrawn';
	let stage = $state<Stage>('compose');
	let requestId = $state('');
	let vibe = $state('');
	let note = $state('');
	let error = $state('');
	let calm = $state(false);
	let dialog = $state<HTMLDivElement>();
	let previousFocus: HTMLElement | null = null;

	// Opened on a spot the guest asked for already: show that request.
	$effect.pre(() => {
		if (askedId && stage === 'compose' && !requestId) {
			requestId = askedId;
			stage = 'asked';
		}
	});

	let who = $derived(name || 'the guest here');
	let cleaned = $derived(cleanSwapNote(note));
	let noteProblem = $derived(swapNoteProblem(cleaned));
	let full = $derived(stage === 'compose' && openCount >= SWAP_OPEN_MAX);
	let busy = $derived(stage === 'sending' || stage === 'withdrawing');
	let days = SWAP_HOURS % 24 === 0 ? `${SWAP_HOURS / 24} days` : `${SWAP_HOURS} hours`;

	onMount(() => {
		calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		previousFocus = document.activeElement as HTMLElement | null;
		document.body.style.overflow = 'hidden';
		void tick().then(() => dialog?.focus());
	});

	onDestroy(() => {
		if (typeof window === 'undefined') return;
		document.body.style.overflow = '';
		if (previousFocus?.isConnected) previousFocus.focus();
	});

	function close() {
		if (!busy) onclose();
	}

	function keydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			event.preventDefault();
			close();
		} else if (event.key === 'Tab' && dialog) {
			const items = [
				...dialog.querySelectorAll<HTMLElement>(
					'button:not([disabled]), a[href], textarea:not([disabled]), input:not([disabled])'
				)
			].filter((el) => el.offsetParent !== null);
			if (items.length === 0) return;
			const first = items[0];
			const last = items[items.length - 1];
			if (
				event.shiftKey &&
				(document.activeElement === first || document.activeElement === dialog)
			) {
				event.preventDefault();
				last.focus();
			} else if (!event.shiftKey && document.activeElement === last) {
				event.preventDefault();
				first.focus();
			}
		}
	}

	function failure(result: { type: string; data?: Record<string, unknown> }, fallback: string) {
		if (result.type === 'error') return NO_CONNECTION;
		return typeof result.data?.error === 'string' ? result.data.error : fallback;
	}

	const send: SubmitFunction = ({ formData, cancel }) => {
		if (full || noteProblem || busy) {
			cancel();
			return;
		}
		formData.set('vibe', vibe);
		formData.set('note', cleaned);
		error = '';
		stage = 'sending';
		return async ({ result }) => {
			if (result.type === 'success') {
				requestId = String(result.data?.swapAsked ?? '');
				stage = 'sent';
				await invalidateAll();
				return;
			}
			stage = 'compose';
			error = failure(result, 'Your swap request could not be sent. Please try again.');
			// Someone may have moved meanwhile: show the room as it is now.
			await invalidateAll();
		};
	};

	const withdraw: SubmitFunction = ({ cancel }) => {
		if (busy || !requestId) {
			cancel();
			return;
		}
		error = '';
		stage = 'withdrawing';
		return async ({ result }) => {
			if (result.type === 'success') {
				stage = 'withdrawn';
				await invalidateAll();
				return;
			}
			stage = 'asked';
			error = failure(result, 'Your request could not be taken back. Please try again.');
			await invalidateAll();
		};
	};
</script>

<svelte:window onkeydown={keydown} />

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div
	class="swap-backdrop"
	onclick={close}
	transition:fade={{ duration: calm ? 0 : 160 }}
	role="presentation"
>
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
	<div
		class="swap-sheet"
		class:calm
		bind:this={dialog}
		onclick={(event) => event.stopPropagation()}
		role="dialog"
		aria-modal="true"
		aria-labelledby="swap-sheet-title"
		tabindex="-1"
		transition:fly={{ y: calm ? 0 : 40, duration: calm ? 0 : 320, easing: backOut }}
	>
		<p class="kicker"><span aria-hidden="true">🔁</span> Swap request</p>
		<h2 id="swap-sheet-title">
			{#if stage === 'sent'}
				Sent! Fingers crossed.
			{:else if stage === 'asked' || stage === 'withdrawing'}
				You asked for this spot
			{:else if stage === 'withdrawn'}
				Taken back
			{:else}
				Ask {who} to swap?
			{/if}
		</h2>

		<div class="trade" class:sent={stage === 'sent'} class:gone={stage === 'withdrawn'}>
			<div
				class="side mine"
				in:fly={{ x: calm ? 0 : -40, duration: calm ? 0 : 420, delay: 80, easing: cubicOut }}
			>
				<SwapTicket spot={mine} kicker="You give" tone="mine" />
			</div>
			<div class="orbit" aria-hidden="true">
				<svg viewBox="0 0 48 48">
					<path class="arc a" d="M10 20 A 15 15 0 0 1 38 20" />
					<path class="arc b" d="M38 28 A 15 15 0 0 1 10 28" />
					<path class="head a" d="M34 14 l4 6 l-7 1" />
					<path class="head b" d="M14 34 l-4 -6 l7 -1" />
				</svg>
			</div>
			<div
				class="side theirs"
				in:fly={{ x: calm ? 0 : 40, duration: calm ? 0 : 420, delay: 140, easing: cubicOut }}
			>
				<SwapTicket spot={target} kicker="You get" tone="theirs" {name} />
			</div>
			{#if stage === 'sent' && !calm}
				<span class="plane" aria-hidden="true">✈️</span>
				<span class="trail" aria-hidden="true"></span>
			{/if}
		</div>

		{#if error}
			<p class="swap-error" role="alert">{error}</p>
		{/if}

		{#if stage === 'compose' || stage === 'sending'}
			{#if full}
				<p class="note-box">
					You have {SWAP_OPEN_MAX} open swap requests already. Take one back on
					<a href="/swaps">your swap page</a>, or wait for an answer.
				</p>
			{/if}
			<form method="POST" action="?/askSwap" use:enhance={send}>
				<input type="hidden" name="bedId" value={target.bedId} />
				<fieldset class="vibes" disabled={busy || full}>
					<legend>Why? <span class="optional">(optional)</span></legend>
					<div class="vibe-chips">
						{#each SWAP_VIBES as option (option.value)}
							<label class="vibe" class:on={vibe === option.value}>
								<input
									type="radio"
									name="vibe-choice"
									value={option.value}
									checked={vibe === option.value}
									onclick={() => (vibe = vibe === option.value ? '' : option.value)}
								/>
								<span aria-hidden="true">{option.icon}</span>
								{option.label}
							</label>
						{/each}
					</div>
				</fieldset>

				<label class="note-label" for="swap-note">
					A few words for {who} <span class="optional">(optional)</span>
				</label>
				<textarea
					id="swap-note"
					bind:value={note}
					maxlength={SWAP_NOTE_MAX}
					rows="2"
					placeholder="Hey! Would you swap? 🙏"
					aria-describedby="swap-note-hint"
					disabled={busy || full}
				></textarea>
				<div class="note-meta">
					<small id="swap-note-hint">
						Only {who} sees it, in the app — never in an e-mail. No links; no need to say why.
					</small>
					<small class="count" class:low={SWAP_NOTE_MAX - note.length < 20} aria-hidden="true"
						>{note.length}/{SWAP_NOTE_MAX}</small
					>
				</div>
				{#if noteProblem}
					<p class="swap-error" role="alert">{noteProblem}</p>
				{/if}

				<ul class="rules">
					<li>They get a message and have {days} to answer.</li>
					<li>Nothing moves unless they say yes — until then you keep your spot.</li>
					<li>A yes swaps both spots at once. Burner names stay with their people.</li>
				</ul>

				<div class="actions">
					<button type="submit" class="btn-send" disabled={busy || full || !!noteProblem}>
						{stage === 'sending' ? 'Sending…' : 'Send swap request'}
						<span aria-hidden="true">✈️</span>
					</button>
					<button type="button" class="btn-quiet" onclick={close} disabled={busy}>Cancel</button>
				</div>
			</form>
		{:else if stage === 'sent'}
			<p class="next" in:fade={{ duration: calm ? 0 : 300, delay: calm ? 0 : 500 }}>
				{#if name}<strong>{name}</strong>{:else}The guest here{/if} gets a message now. If they say yes,
				your spots swap by themselves and you both get the news. The request runs out after {days}.
			</p>
			<div class="actions">
				<a class="btn-send" href="/swaps">See my requests</a>
				<button type="button" class="btn-quiet" onclick={close}>Close</button>
			</div>
		{:else if stage === 'asked' || stage === 'withdrawing'}
			<p class="next">
				<span class="waiting-chip"
					><span class="dot" aria-hidden="true"></span>Waiting for an answer</span
				>
				It runs out by itself after {days}. Your spot stays yours until {who} says yes.
			</p>
			<form method="POST" action="?/withdrawSwap" use:enhance={withdraw} class="actions">
				<input type="hidden" name="id" value={requestId} />
				<button type="submit" class="btn-take-back" disabled={busy}>
					{stage === 'withdrawing' ? 'Taking back…' : 'Take it back'}
				</button>
				<a class="btn-quiet" href="/swaps">All my requests</a>
				<button type="button" class="btn-quiet" onclick={close} disabled={busy}>Close</button>
			</form>
		{:else}
			<p class="next">Nothing changed, and {who} won't be bothered. You can ask again anytime.</p>
			<div class="actions">
				<button type="button" class="btn-quiet" onclick={close}>Close</button>
			</div>
		{/if}
	</div>
</div>

<style>
	.swap-backdrop {
		position: fixed;
		inset: 0;
		z-index: 120;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1rem;
		background: rgba(0, 0, 0, 0.82);
		backdrop-filter: blur(12px);
		overscroll-behavior: contain;
	}
	.swap-sheet {
		--swap-c: var(--swap, #38bdf8);
		position: relative;
		width: 100%;
		max-width: 560px;
		max-height: calc(100vh - 2rem);
		max-height: calc(100dvh - 2rem);
		overflow-y: auto;
		overflow-x: hidden;
		padding: clamp(1.25rem, 5vw, 2.25rem);
		border-radius: clamp(20px, 6vw, 28px);
		border: 1px solid #1f2937;
		border-top: 4px solid var(--swap-c);
		background: radial-gradient(120% 60% at 50% 0%, rgba(56, 189, 248, 0.1), transparent 60%), #000;
		box-shadow: 0 40px 100px rgba(0, 0, 0, 0.8);
		color: #fff;
	}
	.swap-sheet:focus {
		outline: none;
	}
	.kicker {
		margin: 0 0 0.35rem;
		font-size: 0.72rem;
		font-weight: 900;
		letter-spacing: 3px;
		text-transform: uppercase;
		color: var(--swap-c);
	}
	h2 {
		margin: 0 0 1.25rem;
		font-size: clamp(1.45rem, 6.5vw, 2rem);
		font-weight: 900;
		letter-spacing: -0.03em;
		line-height: 1.1;
		overflow-wrap: anywhere;
	}

	/* The two tickets face each other, the ⇄ circles between them. */
	.trade {
		position: relative;
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
		align-items: center;
		gap: 0.5rem;
		margin-bottom: 1.25rem;
	}
	.side {
		min-width: 0;
		transition:
			transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1),
			opacity 0.4s ease;
	}
	.orbit {
		width: 2.6rem;
		height: 2.6rem;
		color: var(--swap-c);
		filter: drop-shadow(0 0 6px rgba(56, 189, 248, 0.6));
		animation: orbit 3.2s linear infinite;
	}
	.orbit svg {
		width: 100%;
		height: 100%;
		fill: none;
		stroke: currentColor;
		stroke-width: 3.5;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
	.orbit .b {
		color: #2dd4bf;
		stroke: #2dd4bf;
	}
	@keyframes orbit {
		to {
			transform: rotate(360deg);
		}
	}
	/* Sent: the tickets lean in, as if handing something over, and the plane leaves. */
	.trade.sent .mine {
		transform: translateX(6px) rotate(-2deg);
	}
	.trade.sent .theirs {
		transform: translateX(-6px) rotate(2deg);
	}
	.trade.sent .orbit {
		animation-duration: 0.9s;
	}
	.trade.gone .side {
		opacity: 0.45;
	}
	.plane {
		position: absolute;
		left: 50%;
		top: 50%;
		font-size: 1.8rem;
		pointer-events: none;
		animation: fly-away 1.6s cubic-bezier(0.5, 0, 0.3, 1) forwards;
	}
	@keyframes fly-away {
		0% {
			transform: translate(-50%, -50%) scale(0.4) rotate(0deg);
			opacity: 0;
		}
		15% {
			transform: translate(-50%, -80%) scale(1.15) rotate(-10deg);
			opacity: 1;
		}
		60% {
			transform: translate(90px, -150px) scale(1) rotate(-25deg);
			opacity: 1;
		}
		100% {
			transform: translate(260px, -330px) scale(0.6) rotate(-35deg);
			opacity: 0;
		}
	}
	.trail {
		position: absolute;
		left: 50%;
		top: 50%;
		width: 170px;
		height: 110px;
		border-top: 2px dashed rgba(56, 189, 248, 0.55);
		border-radius: 100% 0 0 0;
		transform-origin: 0 0;
		transform: rotate(-38deg);
		pointer-events: none;
		animation: trail-fade 1.8s ease-out forwards;
	}
	@keyframes trail-fade {
		0% {
			clip-path: inset(0 100% 0 0);
			opacity: 0;
		}
		30% {
			opacity: 1;
		}
		70% {
			clip-path: inset(0 0 0 0);
			opacity: 0.8;
		}
		100% {
			clip-path: inset(0 0 0 0);
			opacity: 0;
		}
	}

	/* Phones: the tickets stack, the ⇄ turns into ⇅. */
	@media (max-width: 460px) {
		.trade {
			grid-template-columns: minmax(0, 1fr);
			justify-items: stretch;
		}
		.orbit {
			justify-self: center;
			width: 2.2rem;
			height: 2.2rem;
		}
		.trade.sent .mine {
			transform: translateY(4px);
		}
		.trade.sent .theirs {
			transform: translateY(-4px);
		}
	}

	.vibes {
		border: 0;
		padding: 0;
		margin: 0 0 1rem;
		min-width: 0;
	}
	legend,
	.note-label {
		display: block;
		margin-bottom: 0.55rem;
		font-size: 0.72rem;
		font-weight: 900;
		letter-spacing: 2px;
		text-transform: uppercase;
		color: #a3a3a3;
	}
	.optional {
		letter-spacing: 0;
		text-transform: none;
		font-weight: 600;
		color: #737373;
	}
	.vibe-chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.45rem;
	}
	.vibe {
		position: relative;
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		min-height: 40px;
		padding: 0.35rem 0.8rem;
		border-radius: 999px;
		border: 1px solid #2a2a2a;
		background: #0b0b0b;
		color: #d4d4d4;
		font-size: 0.82rem;
		font-weight: 700;
		cursor: pointer;
		transition:
			transform 0.15s ease,
			border-color 0.15s ease,
			background 0.15s ease;
	}
	.vibe input {
		position: absolute;
		opacity: 0;
		inset: 0;
		margin: 0;
		cursor: pointer;
	}
	.vibe:hover {
		border-color: rgba(56, 189, 248, 0.6);
	}
	.vibe:has(input:focus-visible) {
		outline: 2px solid #fff;
		outline-offset: 2px;
	}
	.vibe.on {
		border-color: var(--swap-c);
		background: rgba(56, 189, 248, 0.14);
		color: #fff;
		animation: vibe-pop 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);
	}
	@keyframes vibe-pop {
		0% {
			transform: scale(0.92);
		}
		100% {
			transform: scale(1);
		}
	}
	fieldset:disabled .vibe {
		opacity: 0.5;
		cursor: not-allowed;
	}

	textarea {
		width: 100%;
		min-width: 0;
		resize: vertical;
		min-height: 3.6rem;
		padding: 0.8rem 1rem;
		border-radius: 12px;
		border: 1px solid #333;
		background: #0a0a0a;
		color: #fff;
		font: inherit;
		font-size: 1rem;
		line-height: 1.4;
	}
	textarea::placeholder {
		color: #6b6b6b;
	}
	textarea:focus {
		outline: none;
		border-color: var(--swap-c);
		box-shadow: 0 0 20px rgba(56, 189, 248, 0.2);
	}
	.note-meta {
		display: flex;
		justify-content: space-between;
		gap: 0.75rem;
		margin: 0.4rem 0 1rem;
		color: #8a8a8a;
		font-size: 0.78rem;
		line-height: 1.4;
	}
	.count {
		flex: none;
		font-variant-numeric: tabular-nums;
	}
	.count.low {
		color: #fb923c;
	}

	.rules {
		margin: 0 0 1.25rem;
		padding-left: 1.1rem;
		list-style: disc;
		color: #a3a3a3;
		font-size: 0.82rem;
		line-height: 1.5;
	}
	.note-box {
		margin: 0 0 1rem;
		padding: 0.75rem 1rem;
		border-radius: 12px;
		border: 1px solid rgba(251, 146, 60, 0.5);
		background: rgba(251, 146, 60, 0.08);
		color: #fed7aa;
		font-size: 0.9rem;
		line-height: 1.45;
	}
	.note-box a {
		color: #fff;
	}
	.swap-error {
		margin: 0 0 1rem;
		padding: 0.7rem 1rem;
		border-radius: 12px;
		border: 1px solid #f87171;
		background: rgba(248, 113, 113, 0.1);
		color: #fecaca;
		font-weight: 600;
		line-height: 1.45;
		overflow-wrap: anywhere;
	}
	.next {
		margin: 0 0 1.25rem;
		color: #b5b5b5;
		line-height: 1.5;
		overflow-wrap: anywhere;
	}
	.next strong {
		color: #fff;
	}
	.waiting-chip {
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
		margin: 0 0.5rem 0.4rem 0;
		padding: 0.25rem 0.7rem;
		border-radius: 999px;
		border: 1px solid rgba(56, 189, 248, 0.5);
		background: rgba(56, 189, 248, 0.1);
		color: #bae6fd;
		font-size: 0.75rem;
		font-weight: 900;
		letter-spacing: 1px;
		text-transform: uppercase;
	}
	.waiting-chip .dot {
		width: 0.5rem;
		height: 0.5rem;
		border-radius: 50%;
		background: var(--swap-c);
		animation: blink 1.6s ease-in-out infinite;
	}
	@keyframes blink {
		50% {
			opacity: 0.3;
		}
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
	}
	.btn-send,
	.btn-quiet,
	.btn-take-back {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		min-height: 48px;
		padding: 0 1.25rem;
		border-radius: 12px;
		font: inherit;
		font-weight: 900;
		font-size: 0.85rem;
		letter-spacing: 1px;
		text-transform: uppercase;
		text-decoration: none;
		cursor: pointer;
		transition:
			transform 0.15s ease,
			box-shadow 0.2s ease,
			background 0.2s ease;
	}
	.btn-send {
		flex: 1 1 14rem;
		border: none;
		background: linear-gradient(90deg, #2dd4bf, var(--swap-c));
		color: #04121c;
		box-shadow: 0 10px 24px rgba(56, 189, 248, 0.25);
	}
	.btn-send:hover:not(:disabled) {
		transform: translateY(-2px);
		box-shadow: 0 14px 30px rgba(56, 189, 248, 0.4);
	}
	.btn-quiet {
		flex: 0 1 auto;
		border: 2px solid #444;
		background: transparent;
		color: #b5b5b5;
	}
	.btn-quiet:hover:not(:disabled) {
		border-color: #888;
		color: #fff;
	}
	.btn-take-back {
		flex: 1 1 12rem;
		border: 2px solid #fb923c;
		background: transparent;
		color: #fdba74;
	}
	.btn-take-back:hover:not(:disabled) {
		background: #fb923c;
		color: #000;
	}
	.btn-send:disabled,
	.btn-quiet:disabled,
	.btn-take-back:disabled {
		opacity: 0.55;
		cursor: progress;
	}
	.btn-send:focus-visible,
	.btn-quiet:focus-visible,
	.btn-take-back:focus-visible {
		outline: 2px solid #fff;
		outline-offset: 2px;
	}

	.calm .orbit,
	.calm .vibe.on,
	.calm .waiting-chip .dot {
		animation: none;
	}
	.calm .side {
		transition: none;
	}
	@media (prefers-reduced-motion: reduce) {
		.orbit,
		.vibe.on,
		.waiting-chip .dot,
		.plane,
		.trail {
			animation: none;
		}
	}
</style>
