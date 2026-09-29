<!--
Updates on Telegram for the signed-in ticket (docs/guide/booking.md): what the
bot sends, the button that connects the chat, and the switch to turn it off.
-->
<script lang="ts">
	import { enhance } from '$app/forms';
	import PassTicket from '$lib/components/PassTicket.svelte';
	import { toast } from '$lib/dialogs';
	import type { ActionData, PageData } from './$types';

	export let data: PageData;
	export let form: ActionData;

	let busy = false;
	$: failure = form && 'error' in form ? form.error : '';
</script>

<svelte:head>
	<title>Updates on Telegram · CozyNights</title>
</svelte:head>

<div class="container">
	<header>
		<a class="back-link" href={data.roomId ? `/room/${data.roomId}` : '/map'}
			>← {data.roomId ? 'Back to your room' : 'Back to the map'}</a
		>
		<h1><span aria-hidden="true">✈️</span> Updates on Telegram</h1>
		<p class="intro">
			The CozyNights bot writes to you in your own chat, nobody else's: every change of your spot,
			with your booking pass.
		</p>
	</header>

	{#if failure}
		<p class="error" role="alert">{failure}</p>
	{/if}

	{#if !data.bot}
		<section class="card off">
			<h2>Not available right now</h2>
			<p>Telegram updates aren't set up on this server.</p>
			{#if data.email}
				<p>Confirmations go to <strong>{data.email}</strong>, the address of your ticket.</p>
			{/if}
		</section>
	{:else if data.connected}
		<section class="card on">
			<h2><span aria-hidden="true">✅</span> Updates on Telegram are on</h2>
			<ul>
				<li>Every change of your spot arrives as a message, with your pass and its QR code.</li>
				<li>Send <code>/pass</code> in the chat to see your booking pass again.</li>
				<li>Send <code>/stop</code> there, or turn it off here, to end the updates.</li>
			</ul>
			<form
				method="POST"
				action="?/disconnect"
				use:enhance={() => {
					busy = true;
					return async ({ result, update }) => {
						busy = false;
						if (result.type === 'success') toast('Telegram updates are off.', 'success');
						else if (result.type === 'error') toast('We could not reach the server.', 'danger');
						await update();
					};
				}}
			>
				<button type="submit" class="btn-secondary" disabled={busy}>Turn off</button>
			</form>
		</section>
	{:else}
		<section class="card">
			<h2>What you get</h2>
			<ul>
				<li>
					<strong>Every change of your spot</strong> the moment it is settled — also when the crew has
					to move you.
				</li>
				<li>
					<strong>Your booking pass</strong>: its code, the link and the QR code as a picture, ready
					to show when you arrive. <code>/pass</code> sends it again any time.
				</li>
				<li>
					<strong>The crew's answer</strong> if you sent a special-needs request.
				</li>
			</ul>
			<!-- A plain post into a new tab: the answer is a redirect to t.me. -->
			<form method="POST" action="?/connect" target="_blank" rel="noopener">
				<button type="submit" class="btn-telegram">
					<span aria-hidden="true">✈️</span> Get updates on Telegram
				</button>
			</form>
			<p class="hint">
				Opens Telegram: tap <strong>START</strong> there and the bot answers with your spot. The
				link works once and for {data.linkMinutes} minutes. Reload this page afterwards.
			</p>
			<p class="hint">
				Optional. We only store the ID of that chat with your booking, until the contacts are
				deleted after the event; <code>/stop</code> ends it any time. Telegram is run from outside
				the EU — see the <a href="/privacy">privacy policy</a>.
			</p>
		</section>
	{/if}

	{#if data.pass}
		<section class="card pass" aria-label="Your booking pass">
			<h2>Your booking pass</h2>
			<PassTicket pass={data.pass} />
		</section>
	{/if}
</div>

<style>
	.container {
		max-width: 720px;
		margin: 0 auto;
		padding: clamp(1rem, 4vw, 2rem);
		padding-bottom: max(2rem, env(safe-area-inset-bottom));
		color: #fff;
	}
	header {
		margin-bottom: clamp(1.25rem, 5vw, 2rem);
	}
	.back-link {
		display: inline-flex;
		align-items: center;
		min-height: 44px;
		color: #2dd4bf;
		text-decoration: none;
		font-weight: 900;
		font-size: 0.8rem;
		text-transform: uppercase;
		letter-spacing: 1px;
	}
	h1 {
		margin: 0.5rem 0;
		font-size: clamp(1.75rem, 7vw, 2.5rem);
		font-weight: 900;
		color: #229ed9;
		overflow-wrap: anywhere;
	}
	.intro {
		color: #b5b5b5;
		line-height: 1.5;
		margin: 0;
	}
	.error {
		color: #fecaca;
		font-weight: 700;
		margin: 0 0 1rem;
	}
	.card {
		background: #111;
		border: 1px solid #222;
		border-left: 4px solid #229ed9;
		border-radius: 20px;
		padding: clamp(1rem, 5vw, 1.75rem);
		margin-bottom: clamp(1rem, 4vw, 1.5rem);
	}
	.card.on {
		border-left-color: #2dd4bf;
	}
	.card.off,
	.card.pass {
		border-left-color: #444;
	}
	.card h2 {
		margin: 0 0 0.75rem;
		font-size: 1.2rem;
		font-weight: 900;
	}
	.card p,
	.card li {
		color: #c8c8c8;
		line-height: 1.5;
		overflow-wrap: anywhere;
	}
	.card p {
		margin: 0 0 0.75rem;
	}
	ul {
		margin: 0 0 1.25rem;
		padding-left: 1.2rem;
		display: grid;
		gap: 0.4rem;
	}
	strong,
	code {
		color: #fff;
	}
	form {
		margin: 0 0 1rem;
	}
	.btn-telegram,
	.btn-secondary {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.4em;
		min-height: 44px;
		padding: 0 1.25rem;
		border-radius: 10px;
		font: inherit;
		font-weight: 800;
		cursor: pointer;
	}
	.btn-telegram {
		background: #229ed9;
		border: none;
		color: #fff;
	}
	.btn-telegram:hover {
		background: #1d8cc2;
	}
	.btn-secondary {
		background: transparent;
		border: 1px solid #2dd4bf;
		color: #2dd4bf;
	}
	.btn-secondary:disabled {
		opacity: 0.6;
		cursor: progress;
	}
	.hint {
		font-size: 0.85rem;
		color: #a3a3a3 !important;
	}
	.hint a {
		color: #2dd4bf;
	}
</style>
