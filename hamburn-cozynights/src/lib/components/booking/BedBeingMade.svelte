<!--
  A spot someone else is booking right now ($lib/spot-hold): a little bed whose
  pillow gets fluffed while the duvet flaps and a feather drifts off. Pure
  decoration (aria-hidden); the card's text says what is going on. Only
  transform and opacity move, and with reduced motion the bed just sits there.
-->
<script lang="ts">
	let { size = 44 }: { size?: number } = $props();
</script>

<svg
	class="bed-being-made"
	viewBox="0 0 48 40"
	width={size}
	height={(size * 40) / 48}
	aria-hidden="true"
	focusable="false"
>
	<ellipse cx="25" cy="36.5" rx="21" ry="1.8" fill="rgba(0, 0, 0, 0.35)" />
	<rect x="3" y="12" width="4" height="24" rx="1.5" fill="#737373" />
	<rect x="43" y="22" width="3" height="14" rx="1.2" fill="#737373" />
	<rect x="3" y="30" width="43" height="4" rx="1" fill="#525252" />
	<rect x="7" y="24" width="36" height="7" rx="2.5" fill="#d6d3d1" />
	<path class="duvet" d="M18 25.5 q6 -5 12 -1.5 t13 -1 v7.5 h-25 z" />
	<rect class="pillow" x="8" y="17.5" width="12" height="7" rx="3.5" fill="#fafaf9" />
	<ellipse class="feather f1" cx="15" cy="16" rx="1.9" ry="0.7" fill="#fff" />
	<ellipse class="feather f2" cx="12" cy="15" rx="1.6" ry="0.6" fill="#fff" />
	<ellipse class="feather f3" cx="17" cy="15.5" rx="1.7" ry="0.65" fill="#fff" />
</svg>

<style>
	.bed-being-made {
		display: block;
		overflow: visible;
	}
	.duvet {
		fill: var(--state, #fb923c);
		transform-box: fill-box;
		transform-origin: 100% 100%;
		animation: bbm-flap 1.8s ease-in-out 0.3s infinite;
	}
	.pillow {
		transform-box: fill-box;
		transform-origin: 50% 100%;
		animation: bbm-fluff 1.8s ease-in-out infinite;
	}
	.feather {
		opacity: 0;
		transform-box: fill-box;
		transform-origin: center;
		animation: bbm-feather 2.7s ease-out infinite;
	}
	.f2 {
		--dx: -4px;
		animation-delay: 0.9s;
	}
	.f3 {
		--dx: 6px;
		animation-delay: 1.8s;
	}

	@keyframes bbm-fluff {
		0%,
		60%,
		100% {
			transform: scale(1, 1);
		}
		15% {
			transform: scale(1.14, 0.8);
		}
		32% {
			transform: scale(0.9, 1.15);
		}
		48% {
			transform: scale(1.05, 0.95);
		}
	}
	@keyframes bbm-flap {
		0%,
		60%,
		100% {
			transform: rotate(0deg) translateY(0);
		}
		25% {
			transform: rotate(-9deg) translateY(-3px);
		}
		45% {
			transform: rotate(2deg) translateY(0.5px);
		}
	}
	@keyframes bbm-feather {
		0% {
			opacity: 0;
			transform: translate(0, 0) rotate(0deg);
		}
		12% {
			opacity: 0.95;
		}
		100% {
			opacity: 0;
			transform: translate(var(--dx, 3px), -14px) rotate(160deg);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.duvet,
		.pillow,
		.feather {
			animation: none;
		}
	}
</style>
