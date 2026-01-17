<script lang="ts">
  import type { House, Bed } from '$lib/types';
  import { fade, scale } from 'svelte/transition';

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
</script>

<div class="map-wrapper">
  <svg viewBox="0 0 1000 700">
    <image href="/lageplan-brahmsee.jpg" width="1000" height="700" />
    
    {#each houses as house}
      <g
        class="house-marker"
        role="button"
        tabindex="0"
        on:click={() => openPopup(house)}
        on:keydown={(e) => (e.key === 'Enter' || e.code === 'Space') && openPopup(house)}
        aria-label={`Haus ${house.name}`}
      >
        <circle cx={house.x} cy={house.y} r="15" fill={house.status === 'frei' ? '#22c55e' : '#ef4444'} stroke="white" stroke-width="3" />
        <text x={house.x} y={house.y - 25} text-anchor="middle" class="map-label">{house.name}</text>
      </g>
    {/each}
  </svg>

  {#if selectedHouse}
    <div 
      class="popup" 
      style="left: {selectedHouse.x/10}%; top: {selectedHouse.y/7}%;"
      transition:scale={{duration: 200, start: 0.8}}
    >
      <div class="popup-content">
        <button class="close-btn" on:click={closePopup}>&times;</button>
        <h3>{selectedHouse.name}</h3>
        <p>Wähle ein Bett:</p>
        
        <div class="bed-grid">
          {#each selectedHouse.beds as bed}
            <button 
              class="bed-btn" 
              class:occupied={bed.occupied} 
              class:selected={selectedBedId === bed.id}
              on:click={() => !bed.occupied && selectBed(bed.id)}
            >
              {bed.label}
              {#if selectedBedId === bed.id}
                <div class="fire-effect"></div>
              {/if}
            </button>
          {/each}
        </div>

        {#if selectedBedId}
          <button class="confirm-action" on:click={() => alert('Bett gebucht!')}>
            Bett {selectedBedId} buchen
          </button>
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  .map-wrapper { position: relative; width: 100%; background: #1a1a1a; border-radius: 15px; overflow: hidden; }
  svg { width: 100%; height: auto; display: block; }
  .house-marker { cursor: pointer; }
  .map-label { fill: white; font-weight: bold; font-size: 14px; paint-order: stroke; stroke: black; stroke-width: 3px; }

  /* Pop-up Styling */
  .popup {
    position: absolute;
    z-index: 100;
    transform: translate(-50%, -110%); /* Positioniert es über dem Haus-Punkt */
    width: 280px;
    background: rgba(15, 15, 15, 0.95);
    border: 2px solid #ff3e00;
    border-radius: 15px;
    box-shadow: 0 10px 30px rgba(0,0,0,0.8);
    backdrop-filter: blur(10px);
    padding: 15px;
    color: white;
  }

  /* Kleiner Pfeil nach unten */
  .popup::after {
    content: '';
    position: absolute;
    bottom: -10px;
    left: 50%;
    transform: translateX(-50%);
    border-left: 10px solid transparent;
    border-right: 10px solid transparent;
    border-top: 10px solid #ff3e00;
  }

  .close-btn { position: absolute; top: 5px; right: 10px; background: none; border: none; color: white; font-size: 20px; cursor: pointer; }

  .bed-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin: 15px 0; }

  .bed-btn {
    position: relative;
    padding: 10px 5px;
    font-size: 0.8rem;
    border-radius: 6px;
    border: 1px solid #444;
    background: #22c55e;
    color: white;
    cursor: pointer;
    overflow: hidden;
  }

  .bed-btn.occupied { background: #ef4444; opacity: 0.5; cursor: not-allowed; }
  .bed-btn.selected { border-color: #ffeb3b; transform: scale(1.1); box-shadow: 0 0 10px #ff3e00; }

  /* Feuer Animation */
  .fire-effect {
    position: absolute;
    bottom: 0; left: 0; width: 100%; height: 100%;
    background: linear-gradient(0deg, rgba(255,62,0,0.7) 0%, transparent 80%);
    animation: flame 0.4s ease-in-out infinite alternate;
  }
  @keyframes flame { 
    from { opacity: 0.4; transform: translateY(2px); } 
    to { opacity: 0.9; transform: translateY(0); } 
  }

  .confirm-action {
    width: 100%;
    padding: 10px;
    background: #ff3e00;
    border: none;
    border-radius: 5px;
    color: white;
    font-weight: bold;
    cursor: pointer;
    margin-top: 10px;
  }
</style>