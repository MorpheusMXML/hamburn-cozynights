<!--
@component
A bunk bed as neon pixel art, in outline style: two frame posts, the bed ends,
a ladder on the right post and a tiny pillow at the left end of each mattress,
all drawn as crisp 2 px lines with a soft glow. The two mattresses are the
`upper` and `lower` snippets — on the room page each one is the spot's own
booking button, so the mattress IS the button and carries the status colour.

Every frame line is CSS, not SVG: the posts and bed ends are 2 px boxes, the
ladder's rails are 2 px borders and its rungs a repeating gradient with stops
on whole pixels. A stretched SVG would scale the rung spacing with the tile
height and thin or thicken the strokes with the width; boxes and gradients
sit on the pixel grid at every size, so the rungs never distort. Nothing here
is a status: the frame is always the same light grey, and only the mattresses
change colour with `upperState` and `lowerState` (data-state tokens from
src/routes/state.css: open, full, checked-in, locked, idle).

The mattress that is mine breathes a little: a glow overlay that animates
`opacity` only, and only when the visitor is fine with motion.
-->
<script lang="ts">
	import { onMount, type Snippet } from 'svelte';

	let {
		upper,
		lower,
		upperState = 'idle',
		lowerState = 'idle'
	}: {
		/** The upper mattress, usually the spot's card or button. */
		upper: Snippet;
		/** The lower mattress. */
		lower: Snippet;
		/** data-state of the upper mattress (state.css). */
		upperState?: string;
		/** data-state of the lower mattress (state.css). */
		lowerState?: string;
	} = $props();

	// The glow pulse on my mattress is off for visitors who prefer reduced
	// motion; the @media rule below covers the same case without JavaScript.
	let reduceMotion = $state(false);
	onMount(() => {
		reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
	});
</script>

<div class="pixel-bunk" class:pulse={!reduceMotion}>
	<span class="post" aria-hidden="true"></span>
	<span class="ladder" aria-hidden="true"></span>
	<div class="level upper">
		<div class="mattress" data-state={upperState}>
			{@render upper()}
		</div>
	</div>
	<div class="frame-gap" aria-hidden="true"></div>
	<div class="level lower">
		<div class="mattress" data-state={lowerState}>
			{@render lower()}
		</div>
	</div>
</div>

<style>
	/*
	 * Geometry, in whole pixels so every line lands on the pixel grid:
	 *
	 *   x = 4   the left post (2 px)
	 *   x = 10  the pillow square (6 px, 2 px outline)
	 *   x = 22  the left edge of a level; its mattress starts 4 px further in
	 *           so the 3 px pixel border fits
	 *   right: 18 … 4  the ladder (14 px wide, both rails 2 px); its right rail
	 *           is the right post
	 *
	 * The bed ends run from the left post to the ladder's left rail.
	 */
	.pixel-bunk {
		--line: #e5e5e5;
		--glow: drop-shadow(0 0 3px rgba(229, 229, 229, 0.5));
		--frame-gap: 14px;
		position: relative;
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		grid-template-rows: auto var(--frame-gap) auto;
		min-width: 0;
		padding: 8px 24px 8px 22px;
		background:
			radial-gradient(120% 90% at 50% 0%, rgba(229, 229, 229, 0.05), transparent 60%), #0b0b0b;
		border-radius: 12px;
	}

	.post,
	.ladder {
		position: absolute;
		top: 0;
		bottom: 0;
		pointer-events: none;
		filter: var(--glow);
	}
	.post {
		left: 4px;
		width: 2px;
		background: var(--line);
	}
	.ladder {
		right: 4px;
		width: 14px;
		box-sizing: border-box;
		border-left: 2px solid var(--line);
		border-right: 2px solid var(--line);
		/* One rung every 10 px, 2 px thick; the stops sit on whole pixels. */
		background: repeating-linear-gradient(to bottom, transparent 0 8px, var(--line) 8px 10px);
		background-clip: padding-box;
	}

	.level {
		position: relative;
		display: grid;
		min-width: 0;
		/* Room for the mattress's 3 px pixel border, and for the bed end. */
		padding: 4px 4px 8px;
	}
	/* The pillow: a tiny outlined pixel square between the post and the mattress. */
	.level::before {
		content: '';
		position: absolute;
		left: -12px;
		top: 50%;
		width: 6px;
		height: 6px;
		margin-top: -3px;
		box-sizing: border-box;
		border: 2px solid var(--line);
		filter: var(--glow);
		pointer-events: none;
	}
	/* The bed end: a 2 px bar under the mattress, post to ladder. */
	.level::after {
		content: '';
		position: absolute;
		left: -18px;
		right: -6px;
		bottom: 2px;
		height: 2px;
		background: var(--line);
		filter: var(--glow);
		pointer-events: none;
	}

	.frame-gap {
		min-height: var(--frame-gap);
	}

	/* The mattress: an edgy box in its status colour. It has no padding of its
	   own; the snippet (the booking button) fills it, so the whole box is the
	   button. */
	.mattress {
		position: relative;
		display: grid;
		min-width: 0;
		border-radius: 0;
		background: var(--state-soft, transparent);
		box-shadow:
			0 0 0 3px var(--state, var(--state-idle)),
			inset 0 0 0 1px rgba(0, 0, 0, 0.6);
	}
	.mattress > :global(*) {
		min-width: 0;
	}
	/* The glow overlay of the mattress that is mine, animated on opacity alone. */
	.mattress::after {
		content: '';
		position: absolute;
		inset: -3px;
		box-shadow: 0 0 14px 3px var(--state, transparent);
		opacity: 0;
		pointer-events: none;
	}

	@media (prefers-reduced-motion: no-preference) {
		.pulse .mattress[data-state='checked-in']::after {
			animation: bunk-glow var(--state-beat, 2.8s) ease-in-out infinite;
		}
	}

	@keyframes bunk-glow {
		0%,
		100% {
			opacity: 0.25;
		}
		50% {
			opacity: 0.8;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.mattress::after {
			animation: none;
			opacity: 0;
		}
	}

	@media (forced-colors: active) {
		.post,
		.level::after {
			background: CanvasText;
		}
		.ladder,
		.level::before {
			border-color: CanvasText;
		}
		.post,
		.ladder,
		.level::before,
		.level::after {
			filter: none;
		}
	}
</style>
