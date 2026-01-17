<script lang="ts">
  import type { House } from '$lib/types';
  import HouseMarker from './HouseMarker.svelte';
  import MapPopup from './MapPopup.svelte';

  export let houses: House[] = [];
  
  let selectedHouse: House | null = null;
  let selectedBedId: number | null = null;

  function openPopup(house: House) {
    if (house.status === 'voll') return;
    selectedHouse = house;
    selectedBedId = null; // Reset
  }

  function closePopup() {
    selectedHouse = null;
  }

  function selectBed(bedId: number) {
    selectedBedId = bedId;
  }

  function handleMapClick(event: MouseEvent) {
    // Koordinaten-Finder für Entwickler
    // Klicke auf die Karte und schaue in die Konsole, um x/y zu sehen
    const svg = event.currentTarget as SVGSVGElement;
    const pt = svg.createSVGPoint();
    pt.x = event.clientX;
    pt.y = event.clientY;
    
    // Umrechnung in SVG-Koordinaten
    const screenCTM = svg.getScreenCTM();
    if (screenCTM) {
      const cursorPt = pt.matrixTransform(screenCTM.inverse());
      console.log(`Map Position: x: ${Math.round(cursorPt.x)}, y: ${Math.round(cursorPt.y)}`);
    }
  }
</script>

<div class="map-wrapper">
  <!-- svelte-ignore a11y-click-events-have-key-events -->
  <svg viewBox="0 0 1000 700" on:click={handleMapClick} role="presentation">
    <image href="/lageplan-brahmsee.jpg" width="1000" height="700" />
    
    {#each houses as house}
      <HouseMarker 
        {house} 
        on:click={(e) => { e.stopPropagation(); openPopup(house); }}
        on:keydown={(e) => (e.key === 'Enter' || e.code === 'Space') && openPopup(house)}
      />
    {/each}
  </svg>

  {#if selectedHouse}
    <MapPopup 
      house={selectedHouse}
      {selectedBedId}
      onClose={closePopup}
      onSelectBed={selectBed}
      onBook={() => alert('Bett gebucht!')}
    />
  {/if}
</div>

<style>
  .map-wrapper {
    position: relative;
    width: 100vw; /* Volle Bildschirmbreite  */
    height: 100vh; /* Volle Bildschirmhöhe [cite: 36] */
    display: flex;
    justify-content: center;
    align-items: center; /* Zentriert die Karte vertikal */
    background: #000; /* Schwarzer Hintergrund  */
    overflow: hidden; /* Verhindert Scrollbalken  */
  }

  svg {
    width: 100%;
    height: 100%;
    /* Sorgt dafür, dass das Bild proportional skaliert und den Platz füllt  */
    max-width: 100vw;
    max-height: 100vh;
    display: block;
    object-fit: contain; /* Behält Seitenverhältnis bei und füllt den Container [cite: 38] */
  }
</style>