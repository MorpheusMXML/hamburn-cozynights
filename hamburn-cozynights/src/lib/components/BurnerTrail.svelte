<!--
@component
Full-viewport WebGL cursor FX: neon hue-cycling ribbon, ember sparks, click
shockwaves and a soft spotlight. Disabled when the user prefers reduced motion.
Fingers leave no trail on phones and tablets (the ribbon would chase every
scroll of a spot list); a mouse on a touch-screen laptop still does.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { createBurnerTrail } from '$lib/fx/burnerTrail';

	let canvas: HTMLCanvasElement;

	onMount(() => {
		const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
		// The primary pointer is a mouse or trackpad: only then follow touches too.
		const finePointer = window.matchMedia('(pointer: fine)');
		let destroy: (() => void) | null = null;

		const sync = () => {
			if (reducedMotion.matches) {
				destroy?.();
				destroy = null;
			} else if (!destroy) {
				destroy = createBurnerTrail(canvas, { touch: finePointer.matches });
			}
		};

		sync();
		reducedMotion.addEventListener('change', sync);
		return () => {
			reducedMotion.removeEventListener('change', sync);
			destroy?.();
		};
	});
</script>

<canvas bind:this={canvas} class="burner-trail" aria-hidden="true"></canvas>

<style>
	.burner-trail {
		position: fixed;
		inset: 0;
		width: 100vw;
		height: 100vh;
		pointer-events: none;
		z-index: 9999;
		contain: strict;
	}
</style>
