<!--
@component
The footer of every page: legal links (German law wants the legal notice and
the privacy policy reachable from everywhere) and the "made in Hamburg"
credit. The root layout renders it; full-screen pages use `compact` inside
their own overlay (map) or place the two parts themselves (landing page).
-->
<script lang="ts">
	import LegalLinks from './LegalLinks.svelte';
	import MadeInHamburg from './MadeInHamburg.svelte';

	let { compact = false }: { compact?: boolean } = $props();
</script>

<footer class="site-footer" class:compact>
	<LegalLinks />
	<MadeInHamburg />
</footer>

<style>
	.site-footer {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.2rem;
		padding: 1.25rem 1rem max(1.25rem, env(safe-area-inset-bottom));
		text-align: center;
	}

	.site-footer.compact {
		gap: 0;
		padding: 0.1rem 0.4rem;
	}
</style>
