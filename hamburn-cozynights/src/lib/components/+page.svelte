<script lang="ts">
  import Map from '$lib/components/Map.svelte';
  import type { House } from '$lib/types';


</script>

<div class="background-wrapper">
  <div class="background-image"></div>
</div>

<main class="content-layer">
  <div class="app-container">
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