<!--
@component
Fireworks for a freshly booked spot: neon rockets rise from the booked card
(or from the bottom of the screen), burst like the cursor's click burst, and a
fire finale blooms in the colours of the effigy title (see `$lib/fx/fireworks`).
Dispatches `finale` when the big one bursts and `done` when the sky is dark
again (or calls `onfinale` / `ondone`, for pages written with runes). Visitors
who prefer reduced motion get no show: `done` fires right away.
-->
<script lang="ts">
	import { createEventDispatcher, onMount } from 'svelte';
	import { createFireworks, type Point } from '$lib/fx/fireworks';

	/** Where the first rockets rise from, in viewport pixels (the booked card). */
	export let origin: Point | null = null;
	/** Stacking order: above the page by default, higher to play over a success overlay. */
	export let zIndex = 200;
	/** The same moments as the `finale` and `done` events, as callbacks. */
	export let onfinale: (() => void) | undefined = undefined;
	export let ondone: (() => void) | undefined = undefined;

	const dispatch = createEventDispatcher<{ finale: void; done: void }>();
	let canvas: HTMLCanvasElement;

	function finale() {
		dispatch('finale');
		onfinale?.();
	}

	function done() {
		dispatch('done');
		ondone?.();
	}

	onMount(() => {
		const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		const show = reducedMotion
			? null
			: createFireworks(canvas, { origin, onFinale: finale, onDone: done });
		if (show) return () => show.destroy();
		// No show (reduced motion or no WebGL): let the page move on.
		const skip = setTimeout(done, 0);
		return () => clearTimeout(skip);
	});
</script>

<canvas bind:this={canvas} class="success-fireworks" style="z-index: {zIndex}" aria-hidden="true"
></canvas>

<style>
	.success-fireworks {
		position: fixed;
		inset: 0;
		width: 100vw;
		height: 100vh;
		pointer-events: none;
		contain: strict;
	}
</style>
