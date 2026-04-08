<script lang="ts">
  import type { PageData } from './$types';
  import Map from '$lib/components/Map.svelte';
  import CountdownTimer from '$lib/components/CountdownTimer.svelte';
  import { onMount } from 'svelte';
  import { invalidateAll } from '$app/navigation';

  export let data: PageData;
  $: ({ houses, isBookingActive, bookingUnlockAt } = data);

  onMount(() => {
    // Force a fresh fetch when entering the page
    invalidateAll();
  });
</script>

<div class="page-container">
  <div class="header-overlay">
    <div class="logo-box">
      <span class="logo">Hamburn</span>
      <span class="tagline">Interactive Map</span>
    </div>
    
    {#if !isBookingActive && bookingUnlockAt}
      <CountdownTimer targetDate={bookingUnlockAt} />
    {:else if !isBookingActive}
      <div class="phase-badge">🛠 PRE-ORGA</div>
    {/if}
  </div>

  {#if houses}
    {#key houses}
      <Map {houses} isEditorMode={false} />
    {/key}
  {:else}
    <div class="loading">Igniting Sensors...</div>
  {/if}
</div>

<style>
  .page-container {
    width: 100vw;
    height: 100vh;
    background: #050505;
    overflow: hidden;
    position: relative;
  }

  .header-overlay {
    position: absolute;
    top: 20px;
    left: 20px;
    right: 20px;
    z-index: 10;
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    pointer-events: none;
  }

  .logo-box {
    background: rgba(0, 0, 0, 0.8);
    padding: 1rem 1.5rem;
    border-radius: 12px;
    border: 1px solid #222;
    display: flex;
    flex-direction: column;
    pointer-events: auto;
    backdrop-filter: blur(10px);
  }

  .logo {
    font-size: 1.5rem;
    font-weight: 900;
    letter-spacing: -1px;
    background: linear-gradient(to right, #2dd4bf, #f472b6);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    text-transform: uppercase;
  }

  .tagline {
    font-size: 0.6rem;
    font-weight: 900;
    color: #444;
    letter-spacing: 2px;
    text-transform: uppercase;
  }

  .phase-badge {
    background: #111;
    color: #666;
    padding: 0.5rem 1rem;
    border-radius: 8px;
    font-weight: 900;
    font-size: 0.7rem;
    letter-spacing: 1px;
    border: 1px solid #222;
    pointer-events: auto;
  }

  .loading {
    color: #444;
    font-weight: 900;
    letter-spacing: 2px;
    text-transform: uppercase;
    display: flex;
    justify-content: center;
    align-items: center;
    height: 100%;
  }
</style>