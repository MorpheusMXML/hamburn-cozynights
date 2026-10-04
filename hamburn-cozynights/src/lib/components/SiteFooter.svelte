<!--
@component
The footer of every page: legal links (German law wants the legal notice and
the privacy policy reachable from everywhere), the "made in Hamburg" credit
and the version. The root layout renders it; full-screen pages use `compact`
inside their own overlay (map) or place the parts themselves (landing page).

It is as big as the moment needs. While a page scrolls, only the legal links
show, as a slim pill at the bottom of the screen (`position: sticky`, no
JavaScript); at the end of the page the pill lands in its place and the
credit and the version unroll below it. A page with a bar of its own at the
bottom (`data-bottom-bar`, the admin save and action bars) leaves the pill at
the end, so the two never cover each other.

`compact` (the map, which never scrolls) is one slim row: the legal links,
the version from 400 px and the credit from 768 px, where they fit beside them.
-->
<script lang="ts">
	import LegalLinks from './LegalLinks.svelte';
	import MadeInHamburg from './MadeInHamburg.svelte';
	import VersionBadge from './VersionBadge.svelte';

	let { compact = false }: { compact?: boolean } = $props();
</script>

{#if compact}
	<footer class="site-footer compact">
		<LegalLinks />
		<MadeInHamburg />
		<VersionBadge size="footer" />
	</footer>
{:else}
	<!-- Next to the footer, not in it: a sticky element floats only within its
	     parent, and the parent here is the whole page (.app-root). The layout
	     test lets it lie over the text it floats past. -->
	<div class="legal-pill" data-layout-overlay>
		<LegalLinks />
	</div>
	<footer class="site-footer">
		<MadeInHamburg />
		<!-- The version, so a bug report can name the build it saw. -->
		<VersionBadge size="footer" />
	</footer>
{/if}

<style>
	/* Over the page, under the top bars, the admin drawer and every dialog. */
	.legal-pill {
		position: sticky;
		bottom: max(8px, env(safe-area-inset-bottom));
		z-index: 80;
		width: fit-content;
		max-width: calc(100% - 24px);
		box-sizing: border-box;
		margin: 1rem auto 0;
		padding: 0 0.6rem;
		border-radius: 14px;
		background: rgba(5, 5, 5, 0.7);
		backdrop-filter: blur(8px);
	}

	:global(body:has([data-bottom-bar])) .legal-pill {
		position: static;
	}

	/* Credit and version side by side where they fit, one per row on a phone. */
	.site-footer {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		align-items: center;
		column-gap: 0.75rem;
		padding: 0.25rem 1rem max(0.75rem, env(safe-area-inset-bottom));
		text-align: center;
	}

	.site-footer.compact {
		flex-wrap: nowrap;
		column-gap: 0.4rem;
		padding: 0.1rem 0;
	}

	/* The least important part goes first: the credit, then the version. */
	.compact :global(.made-in-hamburg),
	.compact :global(.version-badge) {
		display: none;
	}

	@media (min-width: 400px) {
		.compact :global(.version-badge) {
			display: inline-flex;
		}
	}

	@media (min-width: 768px) {
		.compact :global(.made-in-hamburg) {
			display: inline-flex;
		}
	}
</style>
