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