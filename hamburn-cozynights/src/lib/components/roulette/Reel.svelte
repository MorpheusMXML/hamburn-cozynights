<!--
@component
One reel of the Destiny Roulette's slot machine (/random-bed): a window with
the reel's title above it. At rest it shows `value` in full, wrapped over as
many lines as it needs. `run()` spins a strip of rows through the window with
the Web Animations API (transform only, on the compositor) and resolves when
the reel has locked into place; the page then shows the landed value.
The strip is decoration: screen readers get the page's announcement, and the
layout test skips it (its rows are cut off on purpose while they fly by).
-->
<script lang="ts">
	import { tick } from 'svelte';

	let {
		title,
		value,
		kind,
		decorative = false
	}: {
		title: string;
		value: string;
		/** house, room or spot: the colour of the landed value. */
		kind: string;
		/** The face is a symbol (machine resting or sold out), not a real value. */
		decorative?: boolean;
	} = $props();

	let strip = $state<string[] | null>(null);
	let stripEl = $state<HTMLDivElement>();
	let running: Animation | null = null;

	/**
	 * Spins `rows` (the landing row first) through the window along
	 * `keyframes` and resolves once the reel has locked into place.
	 */
	export function run(rows: string[], keyframes: Keyframe[], duration: number): Promise<void> {
		running?.cancel();
		strip = rows;
		return tick()
			.then(() => {
				if (!stripEl || typeof stripEl.animate !== 'function') return;
				running = stripEl.animate(keyframes, { duration, fill: 'forwards' });
				return running.finished.then(
					() => {},
					() => {} // cancelled: a new run, or the page moved on
				);
			})
			.finally(() => {
				running = null;
				strip = null;
			});
	}
</script>

<div class="reel {kind}" class:spinning={strip !== null}>
	<span class="reel-title">{title}</span>
	<div class="window">
		{#if strip}
			<div
				class="strip"
				bind:this={stripEl}
				style="--rows: {strip.length}"
				aria-hidden="true"
				data-layout-ignore
			>
				{#each strip as row, i (i)}
					<span class="row">{row}</span>
				{/each}
			</div>
		{:else}
			<span class="face" class:long={value.length > 14} aria-hidden={decorative || undefined}
				>{value}</span
			>
		{/if}
	</div>
</div>

<style>
	.reel {
		--row: 3.3rem;
		--glow: #5eead4;
		--glow-soft: rgba(94, 234, 212, 0.45);
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		min-width: 0;
	}
	.reel.room {
		--glow: #f9a8d4;
		--glow-soft: rgba(249, 168, 212, 0.45);
	}
	.reel.spot {
		--glow: #fde68a;
		--glow-soft: rgba(253, 230, 138, 0.45);
	}

	.reel-title {
		/* letter-spacing adds space after the last letter too: pad the start to centre */
		padding-left: 0.3em;
		font-size: 0.62rem;
		font-weight: 900;
		letter-spacing: 0.3em;
		text-transform: uppercase;
		text-align: center;
		color: #fcd34d;
		text-shadow: 0 0 6px rgba(251, 191, 36, 0.55);
	}

	/* The reel behind the glass: a drum, dark at the top and bottom edge. */
	.window {
		position: relative;
		min-height: var(--row);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0.4rem 0.65rem;
		border-radius: 12px;
		overflow: hidden;
		background: linear-gradient(
			180deg,
			#08070b 0%,
			#1d1826 20%,
			#2b2536 50%,
			#1d1826 80%,
			#08070b 100%
		);
		box-shadow:
			inset 0 0 0 1px rgba(255, 255, 255, 0.07),
			inset 0 8px 14px rgba(0, 0, 0, 0.75),
			inset 0 -8px 14px rgba(0, 0, 0, 0.75);
	}
	/* The payline: where the reel has to stop. */
	.window::before {
		content: '';
		position: absolute;
		left: 6px;
		right: 6px;
		top: 50%;
		height: 1px;
		background: rgba(244, 114, 182, 0.45);
		box-shadow: 0 0 8px rgba(244, 114, 182, 0.8);
		pointer-events: none;
	}
	/* The drum's curve over the rows. */
	.window::after {
		content: '';
		position: absolute;
		inset: 0;
		background: linear-gradient(
			180deg,
			rgba(0, 0, 0, 0.8),
			rgba(0, 0, 0, 0.25) 22%,
			transparent 36%,
			transparent 64%,
			rgba(0, 0, 0, 0.25) 78%,
			rgba(0, 0, 0, 0.8)
		);
		pointer-events: none;
	}

	.spinning .window {
		height: var(--row);
		padding: 0;
	}
	.strip {
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		height: calc(var(--rows) * var(--row));
		display: flex;
		flex-direction: column;
		will-change: transform;
	}
	.row {
		flex: none;
		height: var(--row);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0 0.65rem;
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
		font-size: clamp(1.05rem, 5vw, 1.4rem);
		font-weight: 900;
		color: #f5f5f5;
	}

	.face {
		position: relative;
		z-index: 1;
		max-width: 100%;
		font-size: clamp(1.05rem, 5vw, 1.4rem);
		line-height: 1.15;
		font-weight: 900;
		text-align: center;
		color: #fff;
		text-shadow:
			0 0 10px var(--glow),
			0 0 22px var(--glow-soft);
		overflow-wrap: anywhere;
	}
	.spot .face {
		font-size: clamp(1.4rem, 7vw, 2rem);
	}
	.face.long,
	.spot .face.long {
		font-size: clamp(0.92rem, 3.9vw, 1.08rem);
	}

	/* Side by side on a wide machine: narrower windows, smaller type. */
	@container machine (min-width: 36rem) {
		.face,
		.row {
			font-size: 1.15rem;
		}
		.spot .face {
			font-size: 1.6rem;
		}
		.face.long,
		.spot .face.long {
			font-size: 0.95rem;
		}
	}
</style>
