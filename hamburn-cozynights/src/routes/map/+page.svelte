<script lang="ts">
  import Map from '$lib/components/Map.svelte';
  import type { PageData } from './$types';

  export let data: PageData;
</script>

<div class="map-wrapper">
  <Map houses={data.houses} />
</div>

<style>
  .map-wrapper {
    width: 100vw;
    height: 100vh;
    overflow: hidden;
    background: #050505;
  }
</style>