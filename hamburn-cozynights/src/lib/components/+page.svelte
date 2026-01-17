<script lang="ts">
  import Map from '$lib/components/Map.svelte';
  import type { House } from '$lib/types';

  const brahmseeHouses: House[] = [
    { 
      id: 1, name: 'Haus Seeblick', x: 250, y: 450, status: 'frei',
      beds: [
        { id: 101, label: 'B1', occupied: false },
        { id: 102, label: 'B2', occupied: true },
        { id: 103, label: 'B3', occupied: false },
        { id: 104, label: 'B4', occupied: false }
      ]
    },
    // Weitere Häuser hier...
  ];
</script>

<div class="background-wrapper">
  <div class="background-image"></div>
</div>

<main class="content-layer">
  <div class="app-container">
    <Map houses={brahmseeHouses} />
  </div>
</main>

<style>
  .content-layer {
    position: relative;
    z-index: 1;
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 10px;
    box-sizing: border-box;
  }

  .app-container {
    width: 100%;
    max-width: 1200px;
    display: flex;
    justify-content: center;
  }

  :global(body) {
    background-color: #000;
  }
</style>