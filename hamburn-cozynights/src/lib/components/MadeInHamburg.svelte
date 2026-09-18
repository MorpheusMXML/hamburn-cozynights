<!--
@component
The credit line at the bottom of every page: made with love in Hamburg by
Claude (the kraken) and Morpheus. `SiteFooter` shows it together with the
legal links; the full-screen pages (landing, map) place it themselves.
-->
<script lang="ts">
	import ClaudeKraken from './ClaudeKraken.svelte';

	const MORPHEUS_URL = 'https://github.com/MorpheusMXML';
</script>

<p class="made-in-hamburg">
	<span>Made with <span class="heart" role="img" aria-label="love">♥</span> in Hamburg by</span>
	<span class="makers">
		<ClaudeKraken />
		<span class="amp" aria-hidden="true">&amp;</span>
		<a class="morpheus" href={MORPHEUS_URL} target="_blank" rel="noopener">Morpheus</a>
	</span>
</p>

<style>
	.made-in-hamburg {
		display: inline-flex;
		flex-wrap: wrap;
		justify-content: center;
		align-items: center;
		gap: 0.15rem 0.4rem;
		margin: 0;
		font-family: 'Inter', system-ui, sans-serif;
		font-size: 0.74rem;
		font-weight: 600;
		letter-spacing: 0.02em;
		color: #737373;
	}

	.makers {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		color: #a3a3a3;
	}

	.heart {
		display: inline-block;
		color: #f472b6;
		text-shadow: 0 0 8px rgba(244, 114, 182, 0.55);
	}

	.amp {
		color: #525252;
	}

	.morpheus {
		display: inline-flex;
		align-items: center;
		min-height: 28px;
		padding: 0 0.15rem;
		border-radius: 6px;
		color: #a3a3a3;
		text-decoration: none;
	}

	.morpheus:hover {
		color: #fff;
		text-decoration: underline;
		text-underline-offset: 3px;
	}

	.morpheus:focus-visible {
		outline: 2px solid #fff;
		outline-offset: 2px;
	}

	@media (prefers-reduced-motion: no-preference) {
		.made-in-hamburg:hover .heart {
			animation: heartbeat 1.1s ease-in-out infinite;
		}
	}

	@keyframes heartbeat {
		0%,
		100% {
			transform: scale(1);
		}
		15% {
			transform: scale(1.25);
		}
		30% {
			transform: scale(1);
		}
		45% {
			transform: scale(1.18);
		}
	}
</style>
