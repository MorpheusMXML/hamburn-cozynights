<!--
@component
A padlock that opens and closes. When `locked` turns true the shackle swings
down with a small spring and the body gives a click; `rattle` shakes it once
as it appears (the lock hint uses that). It takes the text colour.
-->
<script lang="ts">
	export let locked = true;
	export let size = 16;
	export let rattle = false;
</script>

<svg
	class="lock-glyph"
	class:open={!locked}
	class:rattle
	width={size}
	height={size}
	viewBox="0 0 24 24"
	aria-hidden="true"
	focusable="false"
>
	<path class="shackle" d="M7.5 11V8.5a4.5 4.5 0 0 1 9 0V11" />
	<rect class="body" x="4.5" y="10.5" width="15" height="10.5" rx="2.5" />
	<path class="keyhole" d="M12 14.4v2.8" />
</svg>

<style>
	.lock-glyph {
		flex: none;
		overflow: visible;
		vertical-align: -0.15em;
	}
	.shackle {
		fill: none;
		stroke: currentColor;
		stroke-width: 2.4;
		stroke-linecap: round;
		/* Swings around its right leg, in the icon's own units. */
		transform-box: view-box;
		transform-origin: 16.5px 11px;
		transition: transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1);
	}
	.open .shackle {
		transform: translateY(-2.5px) rotate(28deg);
	}
	.body {
		fill: currentColor;
		transform-box: fill-box;
		transform-origin: 50% 100%;
	}
	/* The click when it shuts (also once when a locked page opens). */
	.lock-glyph:not(.open) .body {
		animation: lock-glyph-clack 0.3s 0.28s ease-out;
	}
	.keyhole {
		stroke: var(--lock-glyph-hole, #0b0b0b);
		stroke-width: 2.2;
		stroke-linecap: round;
	}
	.rattle {
		transform-origin: 50% 30%;
		animation: lock-glyph-rattle 0.55s 0.12s ease-in-out;
	}

	@keyframes lock-glyph-clack {
		40% {
			transform: scale(1.08, 0.88);
		}
	}
	@keyframes lock-glyph-rattle {
		20% {
			transform: rotate(-18deg);
		}
		45% {
			transform: rotate(14deg);
		}
		70% {
			transform: rotate(-7deg);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.shackle {
			transition: none;
		}
		.lock-glyph:not(.open) .body,
		.rattle {
			animation: none;
		}
	}
</style>
