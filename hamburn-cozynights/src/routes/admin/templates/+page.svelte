<script lang="ts">
	import type { PageData } from './$types';
	import TemplateManager from '$lib/components/admin/TemplateManager.svelte';
	import { layoutLock } from '$lib/layout-lock';

	export let data: PageData;
	$: ({ isSuperuser, phase, isLayoutLocked } = data);
	// Live Booking and Closed: comparing works, applying needs Staging Mode.
	$: lock = isLayoutLocked ? layoutLock(phase, isSuperuser) : null;
</script>

<svelte:head>
	<title>Templates · CozyNights</title>
</svelte:head>

<div class="templates-page">
	<nav class="breadcrumbs" aria-label="Breadcrumb">
		<a href="/admin/camp">Map & houses</a>
		<span class="sep">/</span>
		<span class="current">Templates</span>
	</nav>

	<TemplateManager
		inline
		{isSuperuser}
		lockedNote={lock
			? `${lock('apply templates').title}: comparing works now, applying needs Staging Mode.`
			: ''}
	/>
</div>

<style>
	.templates-page {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}
	.breadcrumbs {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		font-size: 0.75rem;
		font-weight: 800;
		letter-spacing: 1px;
		text-transform: uppercase;
		color: #666;
	}
	.breadcrumbs a {
		color: #2dd4bf;
		text-decoration: none;
	}
	.breadcrumbs .current {
		color: #aaa;
	}
</style>
