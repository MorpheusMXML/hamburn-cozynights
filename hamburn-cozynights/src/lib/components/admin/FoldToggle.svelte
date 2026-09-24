<!--
@component
The title of a panel that folds away, as a button inside the panel's own
heading (`<h3><FoldToggle …>ADD SPOT ➕</FoldToggle></h3>`), so each page keeps
its look: laser dot, lock chip, colours. Folded, a short summary of what is set
stands under the title. The page shows or hides the body itself:
`{#if open}<div id={controls}>…</div>{/if}`.
Used for the forms on the admin house and room pages (docs/admin/camp-layout.md).
-->
<script lang="ts">
	export let open = false;
	/** The id of the body this button shows and hides. */
	export let controls: string;
	/** What is set, shown only while folded, e.g. "🛖 Hut group · ♿ 🔥". */
	export let summary = '';
</script>

<button
	type="button"
	class="fold-toggle"
	aria-expanded={open}
	aria-controls={controls}
	on:click={() => (open = !open)}
>
	<span class="fold-text">
		<span class="fold-title"><slot /></span>
		{#if !open && summary}<span class="fold-summary">{summary}</span>{/if}
	</span>
	<span class="fold-sign" aria-hidden="true">{open ? '−' : '+'}</span>
</button>

<style>
	.fold-toggle {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		width: 100%;
		min-height: 44px;
		padding: 0;
		background: none;
		border: none;
		color: inherit;
		font: inherit;
		letter-spacing: inherit;
		text-align: left;
		cursor: pointer;
	}
	.fold-toggle:focus-visible {
		outline: 2px solid #2dd4bf;
		outline-offset: 4px;
		border-radius: 6px;
	}
	.fold-text {
		flex: 1 1 auto;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
	/* Title and a chip beside it (STAGING ONLY) wrap together. */
	.fold-title {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.4rem 0.6rem;
	}
	.fold-summary {
		color: #999;
		font-size: 0.75rem;
		font-weight: 600;
		letter-spacing: 0;
		overflow-wrap: anywhere;
	}
	.fold-sign {
		flex-shrink: 0;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		border-radius: 50%;
		border: 1px solid #333;
		background: #141414;
		color: #2dd4bf;
		font-weight: 900;
		font-size: 1.05rem;
		line-height: 1;
		transition:
			background 0.2s,
			border-color 0.2s;
	}
	.fold-toggle:hover .fold-sign {
		border-color: #2dd4bf;
		background: rgba(45, 212, 191, 0.12);
	}
</style>
