<script lang="ts">
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';
    import FairyBackground from '$lib/components/FairyBackground.svelte';
    import NyanTrail from '$lib/components/NyanTrail.svelte';
    import { onMount } from 'svelte';

	let { children } = $props();

    onMount(() => {
        const handleMouseMove = (e: MouseEvent) => {
            const x = e.clientX;
            const y = e.clientY;
            document.documentElement.style.setProperty('--mouse-x', `${x}px`);
            document.documentElement.style.setProperty('--mouse-y', `${y}px`);
        };

        window.addEventListener('mousemove', handleMouseMove);
        return () => window.removeEventListener('mousemove', handleMouseMove);
    });
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>

<FairyBackground />
<NyanTrail />

<div class="app-root">
    {@render children()}
</div>

<style>
    .app-root {
        position: relative;
        z-index: 1;
    }
</style>
