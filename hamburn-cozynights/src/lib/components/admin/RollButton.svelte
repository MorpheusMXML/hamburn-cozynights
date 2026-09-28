<!--
@component
🎲 next to a name field: rolls a funny name ($lib/place-names) into it. The
parent does the rolling in its `on:click`; the die only tumbles.
-->
<script lang="ts">
	import { lockAttrs, type LockHint } from '$lib/layout-lock';

	/** What the die does, for the tooltip and screen readers. */
	export let label = 'Roll a new name';
	export let lock: LockHint | null | undefined = null;

	let tumbling = false;

	function tumble() {
		tumbling = false;
		// The next frame restarts the animation on a quick second click.
		requestAnimationFrame(() => (tumbling = true));
	}
</script>

<button
	type="button"
	class="btn-roll-name"
	class:tumbling
	aria-label={label}
	title={label}
	on:click={tumble}
	on:click
	on:animationend={() => (tumbling = false)}
	{...lockAttrs(lock)}
>
	<span aria-hidden="true">🎲</span>
</button>

<style>
	.btn-roll-name {
		flex: 0 0 auto;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 44px;
		min-height: 44px;
		align-self: stretch;
		padding: 0 0.6rem;
		background: #050505;
		border: 1px solid #333;
		border-radius: 8px;
		font-size: 1.15rem;
		line-height: 1;
		cursor: pointer;
		transition:
			border-color 0.2s,
			box-shadow 0.2s;
	}
	.btn-roll-name:hover:not([data-locked]),
	.btn-roll-name:focus-visible {
		border-color: #f472b6;
		box-shadow: 0 0 12px rgba(244, 114, 182, 0.3);
		outline: none;
	}
	.tumbling span {
		display: inline-block;
		animation: tumble 0.45s cubic-bezier(0.3, 1.4, 0.5, 1);
	}
	@keyframes tumble {
		from {
			transform: rotate(-200deg) scale(0.7);
		}
		to {
			transform: rotate(0) scale(1);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.tumbling span {
			animation: none;
		}
	}
</style>
