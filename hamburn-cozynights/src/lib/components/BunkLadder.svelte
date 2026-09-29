<!--
@component
The ladder between the two levels of a bunk bed, drawn as an SVG: two rails
and a few rungs. With `draw` the rungs appear one after the other, which is
the moment two spots become one bed; visitors who prefer reduced motion get
the finished ladder at once. Decorative: the text next to it says
"upper bunk" and "lower bunk".
-->
<script lang="ts">
	/** Animate the rungs in (the stacking moment). */
	export let draw = false;
	/** Orientation: the ladder stands upright between the levels. */
	export let rungs = 4;
	/** Height in CSS pixels; the width follows. */
	export let height = 44;

	$: width = Math.round(height * 0.55);
	$: railInset = Math.round(width * 0.2);
	$: step = height / (rungs + 1);
</script>

<svg
	class="bunk-ladder"
	class:draw
	viewBox="0 0 {width} {height}"
	{width}
	{height}
	aria-hidden="true"
	focusable="false"
>
	<line class="rail" x1={railInset} y1="1" x2={railInset} y2={height - 1} />
	<line class="rail" x1={width - railInset} y1="1" x2={width - railInset} y2={height - 1} />
	{#each Array.from({ length: rungs }, (_, i) => i) as i (i)}
		<line
			class="rung"
			style="--i: {i}"
			x1={railInset}
			y1={Math.round(step * (i + 1))}
			x2={width - railInset}
			y2={Math.round(step * (i + 1))}
		/>
	{/each}
</svg>

<style>
	.bunk-ladder {
		display: block;
		overflow: visible;
		stroke: #2dd4bf;
		stroke-width: 2;
		stroke-linecap: round;
		filter: drop-shadow(0 0 4px rgba(45, 212, 191, 0.55));
	}

	.rail {
		opacity: 0.85;
	}

	.rung {
		transform-origin: center;
	}

	@media (prefers-reduced-motion: no-preference) {
		.draw .rung {
			animation: rung-in 0.35s cubic-bezier(0.2, 0.9, 0.3, 1.3) both;
			animation-delay: calc(0.12s + var(--i) * 0.09s);
		}
		.draw .rail {
			animation: rail-in 0.3s ease-out both;
		}
	}

	@keyframes rung-in {
		from {
			transform: scaleX(0);
			opacity: 0;
		}
		to {
			transform: scaleX(1);
			opacity: 1;
		}
	}

	@keyframes rail-in {
		from {
			opacity: 0;
		}
		to {
			opacity: 0.85;
		}
	}

	@media (forced-colors: active) {
		.bunk-ladder {
			stroke: CanvasText;
			filter: none;
		}
	}
</style>
