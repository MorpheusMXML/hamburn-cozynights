<!--
The guest's swap requests (docs/guide/booking.md "Swap spots"). On top the
ones waiting for their answer: who asks, their vibe and note, the two spots as
tickets, how long is left — "Hold to swap" or "No thanks". Below, their own
requests with how each one ended, and the switch that pauses requests to them.
A yes plays the trade (SwapTrade): the tickets fly past each other, fireworks.
-->
<script lang="ts">
	import { deserialize, enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { onDestroy, onMount } from 'svelte';
	import { flip } from 'svelte/animate';
	import { fade, fly, scale } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import { toast } from '$lib/dialogs';
	import HoldToSwap from '$lib/components/swaps/HoldToSwap.svelte';
	import SwapTicket from '$lib/components/swaps/SwapTicket.svelte';
	import SwapTrade from '$lib/components/swaps/SwapTrade.svelte';
	import {
		SWAP_OPEN_MAX,
		formatTimeLeft,
		outcomeText,
		pauseText,
		swapVibe,
		type SwapSpot,
		type SwapView
	} from '$lib/swaps';

	let { data } = $props();

	const NO_CONNECTION =
		'We could not reach the server, so nothing was changed. Check your internet connection and try again.';
	const ACCEPT_TIMEOUT_MS = 20_000;

	let now = $state(Date.now());
	let ticker: ReturnType<typeof setInterval> | undefined;
	let calm = $state(false);
	onMount(() => {
		calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		ticker = setInterval(() => (now = Date.now()), 30_000);
	});
	onDestroy(() => clearInterval(ticker));

	let errors = $state<Record<string, string>>({});
	let busy = $state<Record<string, boolean>>({});
	let celebration = $state<{ gave: SwapSpot; gained: SwapSpot; name: string } | null>(null);
	let pauseBusy = $state(false);

	let pause = $derived(pauseText(data.pause));
	let incoming = $derived(data.incoming as SwapView[]);
	let outgoing = $derived(data.outgoing as SwapView[]);

	const toMs = (value: string) => Date.parse(String(value || '').replace(' ', 'T')) || 0;
	const left = (view: SwapView) => formatTimeLeft(toMs(view.expiresAt) - now);
	const ago = (view: SwapView) => {
		const elapsed = now - toMs(view.createdAt);
		return elapsed < 60_000 ? 'just now' : `${formatTimeLeft(elapsed)} ago`;
	};

	function failureOf(result: { type: string; data?: Record<string, unknown> }, fallback: string) {
		if (result.type === 'error') return NO_CONNECTION;
		return typeof result.data?.error === 'string' ? result.data.error : fallback;
	}

	/**
	 * The hold is complete: ask the server to swap. The app avoids
	 * requestSubmit() for old iOS Safari, so this posts the action itself
	 * (like the roulette's Leave No Trace).
	 */
	async function accept(view: SwapView): Promise<boolean> {
		errors[view.id] = '';
		const body = new FormData();
		body.set('id', view.id);
		const stop = new AbortController();
		const timer = setTimeout(() => stop.abort(), ACCEPT_TIMEOUT_MS);
		let result;
		try {
			const response = await fetch('?/accept', {
				method: 'POST',
				body,
				cache: 'no-store',
				signal: stop.signal,
				headers: { accept: 'application/json', 'x-sveltekit-action': 'true' }
			});
			result = deserialize(await response.text());
		} catch {
			errors[view.id] = stop.signal.aborted
				? 'The server did not answer. Reload the page and check where your spot is.'
				: NO_CONNECTION;
			return false;
		} finally {
			clearTimeout(timer);
		}
		if (result.type !== 'success' || !result.data) {
			errors[view.id] = failureOf(result, 'The swap did not go through. Nothing was changed.');
			await invalidateAll();
			return false;
		}
		celebration = {
			gave: result.data.gave as SwapSpot,
			gained: result.data.gained as SwapSpot,
			name: view.name
		};
		void invalidateAll();
		return true;
	}

	function answer(id: string, message: string): SubmitFunction {
		return () => {
			busy[id] = true;
			errors[id] = '';
			return async ({ result, update }) => {
				busy[id] = false;
				if (result.type === 'success') {
					toast(message, 'success');
				} else {
					errors[id] = failureOf(result, 'That did not work. Nothing was changed.');
				}
				await update({ reset: false });
			};
		};
	}

	const togglePause: SubmitFunction = () => {
		pauseBusy = true;
		return async ({ result, update }) => {
			pauseBusy = false;
			if (result.type === 'success') {
				toast(
					result.data?.swapsPaused
						? 'Paused: new swap requests don’t reach you now.'
						: 'Swap requests to you are on again.',
					'success'
				);
			} else {
				toast(failureOf(result, 'The switch did not change. Please try again.'), 'danger');
			}
			await update({ reset: false });
		};
	};
</script>

<svelte:head>
	<title>Swap spots · CozyNights</title>
</svelte:head>

<div class="swaps-page">
	<header class="page-head">
		<a class="back-link" href={data.myRoomId ? `/room/${data.myRoomId}` : '/map'}
			>← {data.myRoomId ? 'Back to my room' : 'Back to the map'}</a
		>
		<p class="kicker"><span aria-hidden="true">🔁</span> Swap spots</p>
		<h1>Swap requests</h1>
		<p class="lede">
			Fancy another spot? Open a room and tap a taken spot to ask its guest for a swap. Nothing
			moves until they say yes — then both spots swap at once.
		</p>
	</header>

	{#if pause}
		<div class="pause-banner" role="status">
			<span aria-hidden="true">⏸️</span>
			<p>{pause}</p>
		</div>
	{/if}

	<section class="block" aria-labelledby="for-you-title">
		<h2 id="for-you-title">
			For you
			{#if incoming.length > 0}<span class="count-badge">{incoming.length}</span>{/if}
		</h2>

		{#if incoming.length === 0}
			<p class="empty">
				{data.hasSpot
					? 'Nobody asked you for a swap right now. When someone does, you get a message and it shows up here.'
					: 'You hold no spot, so there is nothing to swap with you.'}
			</p>
		{/if}

		<div class="cards">
			{#each incoming as view, index (view.id)}
				{@const vibe = swapVibe(view.vibe)}
				<article
					class="req-card"
					animate:flip={{ duration: calm ? 0 : 300 }}
					in:fly={{
						y: calm ? 0 : 24,
						duration: calm ? 0 : 380,
						delay: calm ? 0 : index * 90,
						easing: cubicOut
					}}
					out:scale={{ start: 0.9, duration: calm ? 0 : 220 }}
				>
					<header class="req-head">
						<span class="avatar" aria-hidden="true">{vibe?.icon ?? '🔥'}</span>
						<div class="who">
							<strong>{view.name || 'A fellow burner'}</strong>
							<span>would love to swap · asked {ago(view)}</span>
						</div>
					</header>

					{#if vibe || view.note}
						<div class="message">
							{#if vibe}<span class="vibe-chip">{vibe.icon} {vibe.label}</span>{/if}
							{#if view.note}<blockquote class="bubble">{view.note}</blockquote>{/if}
						</div>
					{/if}

					<div class="trade">
						<SwapTicket spot={view.mine} kicker="You give" tone="mine" />
						<span class="swap-arrows" aria-hidden="true">⇄</span>
						<SwapTicket spot={view.other} kicker="You get" tone="theirs" name={view.name} />
					</div>

					<p class="timer">
						<span aria-hidden="true">⏳</span> Answer within <strong>{left(view)}</strong>
						<span class="peek"
							>· <a href="/room/{view.other.roomId}">Peek at {view.other.room || 'the room'}</a
							></span
						>
					</p>

					{#if errors[view.id]}
						<p class="card-error" role="alert">{errors[view.id]}</p>
					{/if}

					<div class="answer">
						<div class="hold-wrap">
							<HoldToSwap
								onconfirm={() => accept(view)}
								disabled={!!data.pause || !!busy[view.id]}
								spotLabel={view.other.spot}
							/>
						</div>
						<form
							method="POST"
							action="?/decline"
							use:enhance={answer(view.id, 'No swap. They’ll hear it kindly.')}
						>
							<input type="hidden" name="id" value={view.id} />
							<button type="submit" class="btn-no" disabled={!!busy[view.id]}>No thanks</button>
						</form>
					</div>
					<details class="more">
						<summary>More</summary>
						<form
							method="POST"
							action="?/decline"
							use:enhance={answer(
								view.id,
								'No swap — and new requests don’t reach you from now on.'
							)}
						>
							<input type="hidden" name="id" value={view.id} />
							<input type="hidden" name="pause" value="true" />
							<button type="submit" class="btn-link" disabled={!!busy[view.id]}>
								No thanks — and pause swap requests to me
							</button>
						</form>
					</details>
				</article>
			{/each}
		</div>
	</section>

	<section class="block" aria-labelledby="yours-title">
		<h2 id="yours-title">
			Your requests
			<small class="open-count">{data.openOut}/{SWAP_OPEN_MAX} open</small>
		</h2>

		{#if outgoing.length === 0}
			<p class="empty">
				{data.hasSpot
					? 'You haven’t asked anyone yet. Open a room, tap a taken spot and ask its guest.'
					: 'Book a spot first — a swap trades your spot for someone else’s.'}
				<a href="/map">To the map →</a>
			</p>
		{/if}

		<ul class="mine-list">
			{#each outgoing as view (view.id)}
				<li
					class="mine-row"
					data-status={view.status}
					animate:flip={{ duration: calm ? 0 : 300 }}
					in:fade={{ duration: calm ? 0 : 250 }}
				>
					<div class="mini-trade">
						<SwapTicket spot={view.mine} kicker="You give" tone="mine" compact />
						<span class="swap-arrows small" aria-hidden="true">⇄</span>
						<SwapTicket spot={view.other} kicker="You get" tone="theirs" name={view.name} compact />
					</div>
					<div class="row-foot">
						<span class="status-chip" data-status={view.status}>
							{#if view.status === 'pending'}<span class="dot" aria-hidden="true"></span>{/if}
							{outcomeText(view)}
						</span>
						{#if view.status === 'pending'}
							<span class="runs-out">runs out in {left(view)}</span>
							<form
								method="POST"
								action="?/withdraw"
								use:enhance={answer(view.id, 'Taken back. Nothing changed.')}
							>
								<input type="hidden" name="id" value={view.id} />
								<button type="submit" class="btn-link" disabled={!!busy[view.id]}
									>Take it back</button
								>
							</form>
						{/if}
					</div>
					{#if errors[view.id]}
						<p class="card-error" role="alert">{errors[view.id]}</p>
					{/if}
				</li>
			{/each}
		</ul>
	</section>

	<section class="pause-block block" aria-labelledby="pause-title">
		<h2 id="pause-title">Requests to you</h2>
		<p class="pause-state" class:off={data.paused}>
			{data.paused
				? '⏸️ Paused: new swap requests don’t reach you. Requests that already arrived can still be answered.'
				: '✅ On: other guests can ask you for a swap. You always decide.'}
		</p>
		<form method="POST" action="?/pause" use:enhance={togglePause}>
			<input type="hidden" name="paused" value={String(!data.paused)} />
			<button type="submit" class="btn-quiet" disabled={pauseBusy}>
				{data.paused ? 'Turn swap requests on' : 'Pause swap requests to me'}
			</button>
		</form>
	</section>
</div>

{#if celebration}
	<SwapTrade
		gave={celebration.gave}
		gained={celebration.gained}
		name={celebration.name}
		passCode={data.passCode}
		onclose={() => (celebration = null)}
	/>
{/if}

<style>
	.swaps-page {
		--swap-c: var(--swap, #38bdf8);
		max-width: 900px;
		margin: 0 auto;
		padding: clamp(1rem, 4vw, 2rem);
		padding-bottom: max(2rem, env(safe-area-inset-bottom));
		color: #fff;
	}
	.page-head {
		margin-bottom: clamp(1.25rem, 5vw, 2.25rem);
	}
	.back-link {
		display: inline-flex;
		align-items: center;
		min-height: 44px;
		margin-bottom: 0.5rem;
		color: #2dd4bf;
		text-decoration: none;
		font-weight: 900;
		font-size: 0.8rem;
		text-transform: uppercase;
		letter-spacing: 1px;
	}
	.back-link:hover {
		color: #fff;
	}
	.kicker {
		margin: 0 0 0.25rem;
		font-size: 0.75rem;
		font-weight: 900;
		letter-spacing: 3px;
		text-transform: uppercase;
		color: var(--swap-c);
	}
	h1 {
		margin: 0;
		font-size: clamp(2rem, 9vw, 3.4rem);
		line-height: 1.05;
		font-weight: 900;
		letter-spacing: -0.03em;
	}
	.lede {
		max-width: 60ch;
		margin: 0.75rem 0 0;
		color: #b5b5b5;
		line-height: 1.5;
	}

	.pause-banner {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		margin-bottom: 1.5rem;
		padding: 0.9rem 1.2rem;
		border-radius: 16px;
		border: 1px solid #333;
		border-left: 4px solid var(--state-closed, #d4d4d4);
		background: #111;
		color: #d4d4d4;
	}
	.pause-banner p {
		margin: 0;
		line-height: 1.45;
	}

	.block {
		margin-bottom: clamp(1.75rem, 6vw, 2.75rem);
	}
	h2 {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 0.6rem;
		margin: 0 0 1rem;
		font-size: 0.85rem;
		font-weight: 900;
		letter-spacing: 3px;
		text-transform: uppercase;
		color: #a3a3a3;
	}
	.count-badge {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 1.5rem;
		height: 1.5rem;
		padding: 0 0.4rem;
		border-radius: 999px;
		background: var(--swap-c);
		color: #04121c;
		letter-spacing: 0;
	}
	.open-count {
		font-size: 0.75rem;
		letter-spacing: 1px;
		color: #737373;
	}
	.empty {
		margin: 0;
		padding: 1rem 1.2rem;
		border-radius: 14px;
		border: 1px dashed #333;
		color: #a3a3a3;
		line-height: 1.5;
	}
	.empty a {
		color: #7dd3fc;
		font-weight: 800;
		white-space: nowrap;
	}

	.cards {
		display: grid;
		gap: 1rem;
	}
	.req-card {
		padding: clamp(1rem, 4vw, 1.5rem);
		border-radius: 20px;
		border: 1px solid #1f2937;
		border-top: 3px solid var(--swap-c);
		background:
			radial-gradient(120% 70% at 50% 0%, rgba(56, 189, 248, 0.08), transparent 60%), #0a0a0a;
		box-shadow: 0 16px 40px rgba(0, 0, 0, 0.45);
	}
	.req-head {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		margin-bottom: 0.9rem;
	}
	.avatar {
		flex: none;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 2.6rem;
		height: 2.6rem;
		border-radius: 50%;
		border: 1px solid rgba(56, 189, 248, 0.5);
		background: rgba(56, 189, 248, 0.1);
		font-size: 1.3rem;
	}
	.who {
		display: flex;
		flex-direction: column;
		min-width: 0;
		line-height: 1.3;
		overflow-wrap: anywhere;
	}
	.who strong {
		font-size: 1.1rem;
		color: #fde68a;
	}
	.who span {
		color: #a3a3a3;
		font-size: 0.85rem;
	}
	.message {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.55rem;
		margin-bottom: 1rem;
	}
	.vibe-chip {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.3rem 0.75rem;
		border-radius: 999px;
		border: 1px solid rgba(56, 189, 248, 0.45);
		background: rgba(56, 189, 248, 0.1);
		color: #e0f2fe;
		font-size: 0.82rem;
		font-weight: 700;
	}
	/* A speech bubble with its tail towards the name. */
	.bubble {
		position: relative;
		margin: 0.35rem 0 0;
		padding: 0.7rem 1rem;
		max-width: 100%;
		border-radius: 4px 16px 16px 16px;
		background: #1e293b;
		color: #f1f5f9;
		font-size: 0.95rem;
		line-height: 1.45;
		overflow-wrap: anywhere;
	}
	.bubble::before {
		content: '';
		position: absolute;
		left: 0;
		top: -8px;
		border: 8px solid transparent;
		border-left-color: #1e293b;
		border-bottom: 0;
	}

	.trade {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
		align-items: center;
		gap: 0.6rem;
		margin-bottom: 0.9rem;
	}
	.swap-arrows {
		color: var(--swap-c);
		font-size: 1.6rem;
		font-weight: 900;
		text-shadow: 0 0 12px rgba(56, 189, 248, 0.6);
		animation: nudge 2.4s ease-in-out infinite;
	}
	.swap-arrows.small {
		font-size: 1.1rem;
		animation: none;
	}
	@keyframes nudge {
		0%,
		100% {
			transform: translateX(-2px);
		}
		50% {
			transform: translateX(2px);
		}
	}
	.timer {
		margin: 0 0 1rem;
		color: #a3a3a3;
		font-size: 0.88rem;
		line-height: 1.45;
	}
	.timer strong {
		color: #fff;
	}
	.peek a {
		color: #7dd3fc;
	}
	.answer {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-start;
		gap: 0.75rem 1rem;
	}
	.hold-wrap {
		display: flex;
		flex-direction: column;
	}
	.btn-no {
		min-height: 52px;
		padding: 0 1.3rem;
		border-radius: 999px;
		border: 2px solid #444;
		background: transparent;
		color: #b5b5b5;
		font: inherit;
		font-weight: 900;
		font-size: 0.85rem;
		letter-spacing: 1px;
		text-transform: uppercase;
		cursor: pointer;
	}
	.btn-no:hover:not(:disabled) {
		border-color: #888;
		color: #fff;
	}
	.btn-no:disabled {
		opacity: 0.55;
		cursor: progress;
	}
	.more {
		margin-top: 0.6rem;
		color: #737373;
		font-size: 0.8rem;
	}
	.more summary {
		display: inline-flex;
		align-items: center;
		min-height: 36px;
		cursor: pointer;
	}
	.card-error {
		margin: 0 0 0.9rem;
		padding: 0.6rem 0.9rem;
		border-radius: 12px;
		border: 1px solid #f87171;
		background: rgba(248, 113, 113, 0.1);
		color: #fecaca;
		font-weight: 600;
		line-height: 1.45;
		overflow-wrap: anywhere;
	}

	.mine-list {
		display: grid;
		gap: 0.75rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.mine-row {
		padding: 0.85rem;
		border-radius: 16px;
		border: 1px solid #1f1f1f;
		background: #0a0a0a;
	}
	.mine-row:not([data-status='pending']) {
		opacity: 0.72;
	}
	.mini-trade {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
		align-items: center;
		gap: 0.5rem;
	}
	.row-foot {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.4rem 0.9rem;
		margin-top: 0.7rem;
		font-size: 0.82rem;
		color: #a3a3a3;
	}
	.status-chip {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.25rem 0.7rem;
		border-radius: 999px;
		border: 1px solid #333;
		font-weight: 900;
		font-size: 0.72rem;
		letter-spacing: 1px;
		text-transform: uppercase;
		color: #d4d4d4;
	}
	.status-chip[data-status='pending'] {
		border-color: rgba(56, 189, 248, 0.5);
		color: #bae6fd;
		background: rgba(56, 189, 248, 0.08);
	}
	.status-chip[data-status='accepted'] {
		border-color: var(--state-checked-in, #2dd4bf);
		color: #99f6e4;
		background: rgba(45, 212, 191, 0.1);
	}
	.status-chip[data-status='void'] {
		border-color: rgba(251, 146, 60, 0.5);
		color: #fdba74;
	}
	.status-chip .dot {
		width: 0.45rem;
		height: 0.45rem;
		border-radius: 50%;
		background: var(--swap-c);
		animation: blink 1.6s ease-in-out infinite;
	}
	@keyframes blink {
		50% {
			opacity: 0.3;
		}
	}
	.btn-link {
		min-height: 36px;
		padding: 0.25rem;
		border: none;
		background: none;
		color: #7dd3fc;
		font: inherit;
		font-weight: 800;
		text-decoration: underline;
		cursor: pointer;
	}
	.btn-link:disabled {
		opacity: 0.55;
		cursor: progress;
	}

	.pause-state {
		margin: 0 0 0.9rem;
		color: #b5b5b5;
		line-height: 1.5;
	}
	.pause-state.off {
		color: #fdba74;
	}
	.btn-quiet {
		min-height: 44px;
		padding: 0 1.2rem;
		border-radius: 12px;
		border: 2px solid #444;
		background: transparent;
		color: #d4d4d4;
		font: inherit;
		font-weight: 900;
		font-size: 0.8rem;
		letter-spacing: 1px;
		text-transform: uppercase;
		cursor: pointer;
	}
	.btn-quiet:hover:not(:disabled) {
		border-color: var(--swap-c);
		color: #fff;
	}

	@media (max-width: 460px) {
		.trade,
		.mini-trade {
			grid-template-columns: minmax(0, 1fr);
		}
		.swap-arrows {
			justify-self: center;
			transform: rotate(90deg);
			animation: none;
		}
		.answer {
			flex-direction: column;
			align-items: stretch;
		}
		.btn-no {
			width: 100%;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.swap-arrows,
		.status-chip .dot {
			animation: none;
		}
	}
</style>
