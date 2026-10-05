<script lang="ts">
	/**
	 * A house's floor plans (src/lib/floor-plans.ts) behind one quiet button:
	 * it opens the pictures in a dialog, each one a link to the full picture
	 * for zooming in. Nothing at all when the house has no plans.
	 */
	import type { FloorPlan } from '$lib/floor-plans';

	export let plans: FloorPlan[] = [];
	export let houseName = '';

	let dialog: HTMLDialogElement;

	$: label = plans.length === 1 ? 'Floor plan' : 'Floor plans';
</script>

{#if plans.length > 0}
	<button
		type="button"
		class="floor-plan-button"
		aria-haspopup="dialog"
		on:click={() => dialog.showModal()}
	>
		<span aria-hidden="true">🗺️</span>
		{label}
	</button>

	<dialog bind:this={dialog} class="floor-plans" aria-labelledby="floor-plans-title">
		<div class="floor-plans-head">
			<h2 id="floor-plans-title">{label}{houseName ? ` · ${houseName}` : ''}</h2>
			<form method="dialog">
				<button type="submit" class="close" aria-label="Close the floor plans">&times;</button>
			</form>
		</div>
		{#each plans as plan, index (index)}
			<figure>
				<a href={plan.image} target="_blank" rel="noopener" title="Open the full picture">
					<img
						src={plan.image}
						alt={plan.caption ? `Floor plan: ${plan.caption}` : `Floor plan of ${houseName}`}
						loading="lazy"
					/>
				</a>
				{#if plan.caption}<figcaption>{plan.caption}</figcaption>{/if}
			</figure>
		{/each}
		<p class="hint">Tap a plan to open it full size and zoom in.</p>
	</dialog>
{/if}

<style>
	.floor-plan-button {
		align-self: flex-start;
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		margin-top: 0.5rem;
		padding: 0.2rem 0.65rem;
		border: 1px dashed rgba(255, 255, 255, 0.25);
		border-radius: 999px;
		background: transparent;
		color: #b9c2cb;
		font: inherit;
		font-size: 0.8rem;
		cursor: pointer;
	}

	.floor-plan-button:hover,
	.floor-plan-button:focus-visible {
		border-color: rgba(0, 255, 224, 0.55);
		color: #b8fff4;
	}

	/* The global reset takes the margins away, which centre a modal dialog. */
	.floor-plans {
		margin: auto;
		width: min(100% - 2rem, 900px);
		max-height: calc(100dvh - 2rem);
		padding: 1rem 1.25rem 1.25rem;
		border: 1px solid #2dd4bf;
		border-radius: 16px;
		background: #0b0b0b;
		color: #f5f5f5;
		box-shadow: 0 0 40px rgba(45, 212, 191, 0.25);
	}

	.floor-plans::backdrop {
		background: rgba(0, 0, 0, 0.75);
		backdrop-filter: blur(4px);
	}

	.floor-plans-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		margin-bottom: 0.75rem;
	}

	h2 {
		margin: 0;
		min-width: 0;
		font-size: 1rem;
		font-weight: 900;
		letter-spacing: 1px;
		text-transform: uppercase;
		color: #2dd4bf;
		overflow-wrap: anywhere;
	}

	form {
		margin: 0;
	}

	.close {
		width: 2.25rem;
		height: 2.25rem;
		border: 1px solid #333;
		border-radius: 50%;
		background: transparent;
		color: #f5f5f5;
		font-size: 1.25rem;
		line-height: 1;
		cursor: pointer;
	}

	figure {
		margin: 0 0 1rem;
	}

	figure a {
		display: block;
		border-radius: 10px;
		overflow: hidden;
		background: #fff;
	}

	img {
		display: block;
		width: 100%;
		height: auto;
	}

	figcaption {
		margin-top: 0.4rem;
		font-size: 0.85rem;
		color: #b9c2cb;
		overflow-wrap: anywhere;
	}

	.hint {
		margin: 0;
		font-size: 0.75rem;
		color: #8a8a8a;
	}
</style>
