<!--
@component
What a guest can do with their booking pass besides showing it
(docs/admin/passes.md): add it to Apple Wallet or Google Wallet — the wallet
pass updates itself when the spot changes — and get every change on Telegram.

- `wallet`: the wallets set up on this server ([] shows no wallet button).
  Phones only see their own: there is no Google Wallet on an iPhone and no
  Apple Wallet on Android; computers see both.
- `telegram`: null hides the offer. `connected` shows that it is on instead.
  `form` posts straight to the Telegram page's connect action into a new tab
  (only for a signed-in guest: it needs the ticket code); without it the
  offer is a link to /telegram, which asks for the ticket code first.
-->
<script lang="ts">
	import { onMount } from 'svelte';

	type Platform = 'apple' | 'google';

	let {
		code,
		wallet = [],
		telegram = null,
		compact = false
	}: {
		code: string;
		wallet?: Platform[];
		telegram?: { connected: boolean; form?: boolean } | null;
		compact?: boolean;
	} = $props();

	let device = $state<'ios' | 'android' | 'other'>('other');
	onMount(() => {
		const ua = navigator.userAgent;
		// iPads report themselves as a Mac with a touch screen
		const ios =
			/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
		device = ios ? 'ios' : /Android/.test(ua) ? 'android' : 'other';
	});

	const apple = $derived(wallet.includes('apple') && device !== 'android');
	const google = $derived(wallet.includes('google') && device !== 'ios');
</script>

{#if apple || google || telegram}
	<div class="pass-actions" class:compact>
		{#if apple || google}
			<div class="wallets">
				<!-- Files and a redirect to Google, not pages: the router must not take them. -->
				{#if apple}
					<a
						class="wallet apple"
						href="/pass/{code}/wallet/apple"
						data-sveltekit-reload
						rel="nofollow"
					>
						Add to Apple Wallet
					</a>
				{/if}
				{#if google}
					<a
						class="wallet google"
						href="/pass/{code}/wallet/google"
						data-sveltekit-reload
						rel="nofollow"
					>
						Add to Google Wallet
					</a>
				{/if}
			</div>
		{/if}
		{#if telegram}
			{#if telegram.connected}
				<p class="telegram-on">
					<span aria-hidden="true">✈️</span> Updates on Telegram are on — send <code>/pass</code> in the
					chat to see this pass.
				</p>
			{:else if telegram.form}
				<!-- A plain post into a new tab: the answer is a redirect to t.me. -->
				<form method="POST" action="/telegram?/connect" target="_blank" rel="noopener">
					<button type="submit" class="telegram">
						<span aria-hidden="true">✈️</span> Get updates on Telegram
					</button>
				</form>
			{:else}
				<a class="telegram" href="/telegram">
					<span aria-hidden="true">✈️</span> Get updates on Telegram
				</a>
			{/if}
		{/if}
	</div>
{/if}

<style>
	.pass-actions {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.6rem;
		margin-top: 0.9rem;
	}
	.pass-actions.compact {
		align-items: center;
	}
	.wallets {
		display: flex;
		flex-wrap: wrap;
		gap: 0.6rem;
	}
	.compact .wallets {
		justify-content: center;
	}
	.wallet,
	.telegram {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.45em;
		min-height: 44px;
		padding: 0 1.1rem;
		border-radius: 10px;
		font: inherit;
		font-size: 0.9rem;
		font-weight: 800;
		line-height: 1.2;
		text-align: center;
		text-decoration: none;
		cursor: pointer;
	}
	/* Wallet buttons in black, the way both wallets show their own buttons. */
	.wallet {
		background: #000;
		border: 1px solid #5a5a5a;
		color: #fff;
	}
	.wallet:hover,
	.wallet:focus-visible {
		border-color: #fff;
	}
	.telegram {
		background: #229ed9;
		border: none;
		color: #fff;
	}
	.telegram:hover {
		background: #1d8cc2;
	}
	.telegram-on {
		margin: 0;
		color: #b5b5b5;
		font-size: 0.85rem;
		line-height: 1.45;
		overflow-wrap: anywhere;
	}
	.telegram-on code {
		color: #fff;
	}
	form {
		margin: 0;
	}
</style>
