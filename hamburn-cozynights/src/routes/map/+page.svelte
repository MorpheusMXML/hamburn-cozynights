<script lang="ts">
  import type { PageData } from './$types';
  import Map from '$lib/components/Map.svelte';
  import { onMount } from 'svelte';
  import { invalidateAll } from '$app/navigation';

  export let data: PageData;

  // Reaktivität sicherstellen
  $: ({ houses } = data);

  onMount(() => {
    // Erzwingt beim Betreten der Seite, dass die Load-Funktion 
    // vom Server (page.server.ts) erneut aufgerufen wird.
    invalidateAll();
  });
</script>

<div class="page-container">
  {#if houses}
    {#key houses}
      <Map {houses} isEditorMode={false} />
    {/key}
  {:else}
    <div class="loading">Loading Map...</div>
  {/if}
</div>

<style>
  .page-container {
    width: 100vw;
    height: 100vh;
    background: #050505;
    overflow: hidden;
  }
  .loading {
    color: white;
    display: flex;
    justify-content: center;
    align-items: center;
    height: 100%;
  }
</style>