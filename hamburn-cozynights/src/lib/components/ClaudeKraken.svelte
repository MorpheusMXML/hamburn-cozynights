<!--
@component
A small, friendly kraken bot: the credit icon for Claude, who co-wrote this
app with Morpheus. Inline SVG drawn in `currentColor`, so it takes the colour
of the text around it. The tentacles wiggle while the credit line is hovered,
unless the visitor prefers reduced motion.
-->
<script lang="ts">
	let { size = 18, label = 'Claude' }: { size?: number; label?: string } = $props();
</script>

<svg
	class="kraken"
	width={size}
	height={size}
	viewBox="0 0 24 24"
	role="img"
	aria-label={label}
	fill="none"
	stroke="currentColor"
	stroke-width="1.6"
	stroke-linecap="round"
	stroke-linejoin="round"
>
	<title>{label}</title>
	<!-- antenna -->
	<path d="M12 2.4v1.4" />
	<circle cx="12" cy="1.7" r="0.9" fill="currentColor" stroke="none" />
	<!-- head -->
	<rect x="4.5" y="3.8" width="15" height="10.4" rx="4.6" />
	<circle cx="9.4" cy="8.6" r="1.25" fill="currentColor" stroke="none" />
	<circle cx="14.6" cy="8.6" r="1.25" fill="currentColor" stroke="none" />
	<path d="M10.2 11.5q1.8 1.1 3.6 0" />
	<!-- tentacles, each with a little curl at the end -->
	<path class="t a" d="M7.2 14.2C6.9 16.8 5.6 18.5 3.4 19c-.9.2-1.4-.5-1-1" />
	<path class="t b" d="M10.3 14.2c-.1 3.2-.8 5.4-2.5 6.8-.7.6-1.5.2-1.3-.6" />
	<path class="t a" d="M13.7 14.2c.1 3.2.8 5.4 2.5 6.8.7.6 1.5.2 1.3-.6" />
	<path class="t b" d="M16.8 14.2c.3 2.6 1.6 4.3 3.8 4.8.9.2 1.4-.5 1-1" />
</svg>

<style>
	.kraken {
		display: inline-block;
		vertical-align: -0.22em;
		flex-shrink: 0;
	}

	.t {
		transform-box: fill-box;
		transform-origin: 50% 0;
	}

	@media (prefers-reduced-motion: no-preference) {
		.kraken:hover .t,
		:global(.made-in-hamburg:hover) .t {
			animation: wiggle 0.9s ease-in-out infinite alternate;
		}
		.kraken:hover .b,
		:global(.made-in-hamburg:hover) .b {
			animation-delay: -0.45s;
		}
	}

	@keyframes wiggle {
		from {
			transform: rotate(-8deg);
		}
		to {
			transform: rotate(8deg);
		}
	}
</style>
