<!--
@component
Frame of the legal pages (/impressum, /datenschutz): a readable German text
column on the app's dark background. The texts live in the routes; operator
details come from the server's .env (see `$lib/server/legal`).

These pages are German on purpose, unlike the rest of the app: they are
written for German law. `translate="yes"` lets visitors have them
translated, which the rest of the app blocks.
-->
<script lang="ts">
	export let title: string;
	/** Date of the current version ("Stand"). */
	export let updated = '';
	/** Required LEGAL_* variables still missing on this server. */
	export let missing: string[] = [];
</script>

<main class="legal" lang="de" translate="yes">
	<a class="back" href="/">← Zur Startseite</a>
	<article>
		<h1>{title}</h1>
		{#if updated}
			<p class="updated">Stand: {updated}</p>
		{/if}
		{#if missing.length}
			<p class="config-warning" role="note">
				<strong>Hinweis für die Betreiber:</strong> Auf diesem Server fehlen noch Angaben ({missing.join(
					', '
				)}). Sie gehören in die .env des Servers, siehe die Admin-Doku „Legal pages“.
			</p>
		{/if}
		<slot />
	</article>
</main>

<style>
	.legal {
		max-width: 48rem;
		margin: 0 auto;
		padding: clamp(1.25rem, 5vw, 3.5rem) 1rem 1rem;
		color: #e7e5e4;
		font-family: 'Inter', system-ui, sans-serif;
		line-height: 1.65;
	}

	.back {
		display: inline-flex;
		align-items: center;
		min-height: 44px;
		margin-bottom: 0.75rem;
		color: #5eead4;
		font-weight: 700;
		text-decoration: none;
	}

	.back:hover {
		color: #fff;
	}

	.back:focus-visible,
	article :global(a:focus-visible) {
		outline: 2px solid #fff;
		outline-offset: 2px;
		border-radius: 4px;
	}

	article {
		background: rgba(10, 10, 10, 0.85);
		border: 1px solid #262626;
		border-radius: 20px;
		padding: clamp(1.25rem, 4vw, 2.5rem);
		backdrop-filter: blur(8px);
		overflow-wrap: anywhere;
	}

	h1 {
		margin: 0 0 0.25rem;
		color: #fff;
		font-size: clamp(1.75rem, 5vw, 2.4rem);
		font-weight: 900;
		line-height: 1.2;
	}

	.updated {
		margin: 0 0 1.5rem;
		color: #a3a3a3;
		font-size: 0.85rem;
	}

	.config-warning {
		margin: 0 0 1.5rem;
		padding: 0.75rem 1rem;
		border: 1px solid #f87171;
		border-radius: 12px;
		background: rgba(127, 29, 29, 0.35);
		color: #fecaca;
		font-size: 0.9rem;
	}

	article :global(h2) {
		margin: 2.25rem 0 0.5rem;
		color: #2dd4bf;
		font-size: 1.2rem;
		font-weight: 800;
		line-height: 1.3;
	}

	article :global(h3) {
		margin: 1.4rem 0 0.35rem;
		color: #f5f5f4;
		font-size: 1rem;
		font-weight: 700;
	}

	article :global(p),
	article :global(ul),
	article :global(address) {
		margin: 0 0 0.9rem;
		font-size: 0.98rem;
	}

	article :global(ul) {
		padding-left: 1.2rem;
		list-style: disc;
	}

	article :global(li) {
		margin-bottom: 0.35rem;
	}

	article :global(address) {
		font-style: normal;
	}

	article :global(a) {
		color: #5eead4;
		text-decoration: underline;
		text-underline-offset: 3px;
	}

	article :global(a:hover) {
		color: #fff;
	}

	article :global(.lead) {
		color: #d6d3d1;
		font-weight: 600;
	}

	article :global(code) {
		padding: 0.1em 0.35em;
		border-radius: 6px;
		background: rgba(255, 255, 255, 0.07);
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.85em;
	}

	article :global(.missing) {
		color: #fca5a5;
		font-style: italic;
	}

	article :global(.callout) {
		padding: 0.9rem 1rem;
		border-left: 3px solid #f472b6;
		border-radius: 0 12px 12px 0;
		background: rgba(244, 114, 182, 0.08);
	}
</style>
