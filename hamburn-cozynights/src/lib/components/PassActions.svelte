<!--
@component
What a guest can do with their booking pass besides showing it
(docs/admin/passes.md): get every change on Telegram.

- `telegram`: null hides the offer. `connected` shows that it is on instead.
  `form` posts straight to the Telegram page's connect action into a new tab
  (only for a signed-in guest: it needs the ticket code); without it the
  offer is a link to /telegram, which asks for the ticket code first.
-->
<script lang="ts">
	let {
		telegram = null,
		compact = false
	}: {
		telegram?: { connected: boolean; form?: boolean } | null;
		compact?: boolean;
	} = $props();
</script>

{#if telegram}
	<div class="pass-actions" class:compact>
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
