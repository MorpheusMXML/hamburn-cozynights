<script lang="ts">
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';
	import FairyBackground from '$lib/components/FairyBackground.svelte';
	import BurnerTrail from '$lib/components/BurnerTrail.svelte';

	let { children } = $props();
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>

<FairyBackground />
<BurnerTrail />

<div class="app-root">
	{@render children()}
</div>

<style>
	.app-root {
		position: relative;
		z-index: 1;
	}
</style>
