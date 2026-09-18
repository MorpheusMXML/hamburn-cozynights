<!--
@component
The landing page title as a burning effigy: timber letters catch fire, burn
down, collapse and rise again (see `$lib/fx/effigy`). The cursor or a finger
can light them too.

The real heading stays in the page for screen readers and search engines; the
canvas is decoration. Visitors who prefer reduced motion get the standing
title without animation, everyone else a pause button, because an endless
animation needs one (WCAG 2.2.2). `paused` is bindable and remembered in this
browser.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { createEffigyBurn, type EffigyController } from '$lib/fx/effigy/effigyBurn';
	import type { Phase } from '$lib/fx/effigy/simulation';
	import { DEFAULT_LINES, effigyAspect } from '$lib/fx/effigy/structure';

	/** Pauses the animation (bindable). */
	export let paused = false;

	const STORAGE_KEY = 'cozynights:title-motion';
	const aspect = effigyAspect(DEFAULT_LINES);

	let box: HTMLDivElement;
	let canvas: HTMLCanvasElement;
	let controller: EffigyController | null = null;
	/** The canvas has drawn its first frame: the text heading steps back. */
	let live = false;
	/** An animation is running at all (not reduced motion, canvas available). */
	let animated = false;
	let mounted = false;
	/** Current phase of the burn cycle, exposed as data-phase (for tests). */
	let phase: Phase | null = null;

	onMount(() => {
		try {
			paused = localStorage.getItem(STORAGE_KEY) === 'paused';
		} catch {
			/* storage blocked: start playing */
		}

		const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
		const start = () => {
			controller?.destroy();
			live = false;
			controller = createEffigyBurn(canvas, box, {
				still: reducedMotion.matches,
				onReady: () => (live = true),
				onPhase: (value) => (phase = value)
			});
			animated = !!controller && !reducedMotion.matches;
			controller?.setPaused(paused);
		};
		start();
		mounted = true;
		reducedMotion.addEventListener('change', start);

		return () => {
			reducedMotion.removeEventListener('change', start);
			controller?.destroy();
			delete document.documentElement.dataset.motion;
		};
	});

	$: if (mounted) applyPaused(paused);

	function applyPaused(value: boolean) {
		controller?.setPaused(value);
		// layout.css pauses the page's decorative CSS animations along with it.
		if (value) document.documentElement.dataset.motion = 'paused';
		else delete document.documentElement.dataset.motion;
		try {
			localStorage.setItem(STORAGE_KEY, value ? 'paused' : 'running');
		} catch {
			/* storage blocked: not remembered, still works */
		}
	}
</script>

<div class="effigy" class:live bind:this={box} data-phase={phase} style="aspect-ratio: {aspect}">
	<h1 class="effigy-heading"><span>Hamburn</span> <span>CozyNights</span></h1>
	<canvas bind:this={canvas} class="effigy-canvas" aria-hidden="true"></canvas>
	{#if animated}
		<button
			type="button"
			class="motion-toggle"
			aria-label="Pause animation"
			aria-pressed={paused}
			title={paused ? 'Play the animation' : 'Pause the animation'}
			on:click={() => (paused = !paused)}
		>
			{#if paused}
				<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2.5v11l9-5.5z" /></svg>
			{:else}
				<svg viewBox="0 0 16 16" aria-hidden="true"
					><rect x="3.5" y="2.5" width="3" height="11" rx="0.5" /><rect
						x="9.5"
						y="2.5"
						width="3"
						height="11"
						rx="0.5"
					/></svg
				>
			{/if}
		</button>
	{/if}
</div>

<style>
	.effigy {
		position: relative;
		width: min(100%, 820px);
		margin: 0 auto;
		container-type: inline-size;
	}

	/* Without JavaScript (or until the canvas is ready) the heading is the title. */
	.effigy-heading {
		position: absolute;
		inset: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		font-family: 'JetBrains Mono', monospace;
		font-size: 10.5cqw;
		font-weight: 900;
		line-height: 1.1;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: #e2ac74;
		text-shadow:
			0 0 18px rgba(255, 120, 40, 0.45),
			0 2px 0 #3a2416;
		transition: opacity 0.8s ease;
	}

	/* Transparent, not hidden: screen readers and search engines still read it. */
	.effigy.live .effigy-heading {
		opacity: 0;
		pointer-events: none;
		user-select: none;
	}

	.effigy-heading span {
		display: block;
	}

	.effigy-canvas {
		position: absolute;
		pointer-events: none;
		opacity: 0;
		transition: opacity 0.4s ease;
	}

	.effigy.live .effigy-canvas {
		opacity: 1;
	}

	.motion-toggle {
		position: absolute;
		right: 0;
		bottom: -3rem;
		width: 44px;
		height: 44px;
		display: grid;
		place-items: center;
		padding: 0;
		border-radius: 999px;
		border: 1px solid #333;
		background: rgba(0, 0, 0, 0.6);
		color: #b5b5b5;
		cursor: pointer;
		z-index: 2;
	}

	.motion-toggle:hover {
		color: #fff;
		border-color: #2dd4bf;
	}

	.motion-toggle:focus-visible {
		outline: 2px solid #fff;
		outline-offset: 3px;
	}

	.motion-toggle svg {
		width: 16px;
		height: 16px;
		fill: currentColor;
	}
</style>
