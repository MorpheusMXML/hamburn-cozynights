<!--
@component
A panel whose content folds away. The whole header (+/− sign, title, a short
summary) toggles it; the `actions` slot beside it (e.g. "select all") does not.
Used on the ticket page and in the template review.
-->
<script lang="ts">
	import { slide } from 'svelte/transition';

	export let title: string;
	export let icon = '';
	/** Short info next to the title, e.g. "12 new · 3 changed". */
	export let summary = '';
	export let open = true;
	/** Smaller header, for panels inside panels. */
	export let nested = false;
	/** Colour of the left edge. */
	export let tone: 'default' | 'new' | 'changed' | 'removed' | 'muted' = 'default';

	const id = `fold-${Math.random().toString(36).slice(2, 10)}`;
</script>

<section class="fold" class:nested class:open data-tone={tone}>
	<header class="fold-header">
		<button
			type="button"
			class="fold-head"
			aria-expanded={open}
			aria-controls={id}
			on:click={() => (open = !open)}
		>
			<span class="sign" aria-hidden="true">{open ? '−' : '+'}</span>
			{#if icon}<span class="icon" aria-hidden="true">{icon}</span>{/if}
			<span class="title">{title}</span>
			{#if summary}<span class="summary">{summary}</span>{/if}
		</button>
		{#if $$slots.actions}
			<div class="actions"><slot name="actions" /></div>
		{/if}
	</header>
	{#if open}
		<div class="fold-body" {id} transition:slide={{ duration: 180 }}>
			<slot />
		</div>
	{/if}
</section>

<style>
	.fold {
		background: #0d0d0d;
		border: 1px solid #222;
		border-left: 4px solid #2dd4bf;
		border-radius: 16px;
		overflow: hidden;
	}
	.fold[data-tone='new'] {
		border-left-color: #4ade80;
	}
	.fold[data-tone='changed'] {
		border-left-color: #fb923c;
	}
	.fold[data-tone='removed'] {
		border-left-color: #f87171;
	}
	.fold[data-tone='muted'] {
		border-left-color: #444;
	}
	.fold.nested {
		background: #080808;
		border-radius: 12px;
	}

	.fold-header {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding-right: 0.75rem;
	}
	.fold-head {
		flex: 1 1 auto;
		min-width: 0;
		min-height: 52px;
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 0.25rem 0.7rem;
		padding: 0.75rem 1rem;
		background: transparent;
		border: none;
		color: #e5e5e5;
		text-align: left;
		cursor: pointer;
		font: inherit;
	}
	.nested .fold-head {
		min-height: 46px;
		padding: 0.55rem 0.85rem;
	}
	.fold-head:focus-visible {
		outline: 2px solid #2dd4bf;
		outline-offset: -2px;
		border-radius: 12px;
	}
	.sign {
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
	.fold-head:hover .sign {
		border-color: #2dd4bf;
		background: rgba(45, 212, 191, 0.12);
	}
	.icon {
		font-size: 1.15rem;
	}
	.title {
		font-weight: 900;
		letter-spacing: 0.5px;
		text-transform: uppercase;
		font-size: 0.85rem;
	}
	.nested .title {
		font-size: 0.75rem;
	}
	.summary {
		color: #999;
		font-size: 0.8rem;
		font-weight: 600;
	}
	.actions {
		flex-shrink: 0;
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	.fold-body {
		padding: 0 1rem 1rem;
	}
	.nested .fold-body {
		padding: 0 0.6rem 0.6rem;
	}

	@media (max-width: 640px) {
		.fold-body {
			padding: 0 0.7rem 0.8rem;
		}
		.nested .fold-body {
			padding: 0 0.35rem 0.5rem;
		}
	}
</style>
