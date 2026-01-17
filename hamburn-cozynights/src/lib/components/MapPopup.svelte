<script lang="ts">
  import type { House } from '$lib/types';
  import { scale } from 'svelte/transition';

  export let house: House;
  export let selectedBedId: number | null = null;
  export let onClose: () => void;
  export let onSelectBed: (id: number) => void;
  export let onBook: () => void;
</script>

<div 
  class="popup" 
  style="left: {house.x/10}%; top: {house.y/7}%;"
  transition:scale={{duration: 200, start: 0.8}}
>
  <div class="popup-content">
    <button class="close-btn" on:click={onClose}>&times;</button>
    <h3>{house.name}</h3>
    <p>Wähle ein Bett:</p>
    
    <div class="bed-grid">
      {#each house.beds as bed}
        <button 
          class="bed-btn" 
          class:occupied={bed.occupied} 
          class:selected={selectedBedId === bed.id}
          on:click={() => !bed.occupied && onSelectBed(bed.id)}
        >
          {bed.label}
          {#if selectedBedId === bed.id}
            <div class="fire-effect"></div>
          {/if}
        </button>
      {/each}
    </div>

    {#if selectedBedId}
      <button class="confirm-action" on:click={onBook}>
        Bett {selectedBedId} buchen
      </button>
    {/if}
  </div>
</div>

<style>
  .popup {
    position: absolute;
    z-index: 100;
    transform: translate(-50%, -110%);
    width: 280px;
    background: rgba(15, 15, 15, 0.95);
    border: 2px solid #ff3e00;
    border-radius: 15px;
    box-shadow: 0 10px 30px rgba(0,0,0,0.8);
    backdrop-filter: blur(10px);
    padding: 15px;
    color: white;
  }
  
  .popup-content {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .close-btn {
    position: absolute;
    top: -5px;
    right: -5px;
    background: none;
    border: none;
    color: #aaa;
    font-size: 1.5rem;
    cursor: pointer;
    padding: 0 5px;
  }

  .close-btn:hover {
    color: white;
  }

  h3 {
    margin: 0;
    color: #ff3e00;
    font-size: 1.2rem;
  }

  p {
    margin: 0;
    font-size: 0.9rem;
    color: #ccc;
  }

  .bed-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 8px;
    margin-top: 5px;
  }

  .bed-btn {
    position: relative;
    padding: 10px;
    background: #333;
    border: 1px solid #444;
    border-radius: 8px;
    color: white;
    cursor: pointer;
    transition: all 0.2s;
    overflow: hidden;
  }

  .bed-btn:hover:not(.occupied) {
    background: #444;
    border-color: #666;
  }

  .bed-btn.occupied {
    background: #222;
    color: #555;
    cursor: not-allowed;
    border-color: #333;
  }

  .bed-btn.selected {
    background: #ff3e00;
    border-color: #ff6230;
    color: white;
    box-shadow: 0 0 10px rgba(255, 62, 0, 0.4);
  }

  .confirm-action {
    margin-top: 10px;
    padding: 10px;
    background: #22c55e;
    color: white;
    border: none;
    border-radius: 8px;
    font-weight: bold;
    cursor: pointer;
    transition: background 0.2s;
  }

  .confirm-action:hover {
    background: #16a34a;
  }

  .fire-effect {
    position: absolute;
    bottom: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: linear-gradient(to top, rgba(255, 200, 0, 0.2), transparent);
    pointer-events: none;
    animation: flicker 1.5s infinite alternate;
  }

  @keyframes flicker {
    0% { opacity: 0.5; }
    100% { opacity: 1; }
  }
</style>