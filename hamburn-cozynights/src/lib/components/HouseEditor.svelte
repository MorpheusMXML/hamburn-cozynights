<script lang="ts">
  import type { HouseData } from '$lib/types';
  import { createEventDispatcher } from 'svelte';
  import { fade, fly } from 'svelte/transition';

  export let x: number;
  export let y: number;
  export let name = "";

  const dispatch = createEventDispatcher();
  
  let bedCount = 4;
  let showValidationError = false;

  function handleSave() {
    if (!name || name.trim() === "") {
        showValidationError = true;
        return;
    }
    
    showValidationError = false;

    // Note: In a real app, this would be handled by a PocketBase create call
    // This is likely a placeholder for the UI editor
    const now = new Date().toISOString() as any;
    const newHouse: HouseData = {
      id: String(Date.now()),
      collectionId: '',
      collectionName: 'houses' as any,
      created: now,
      updated: now,
      name,
      occupied: false,
      x,
      y,
      rooms: [{
          id: 'temp-room',
          collectionId: '',
          collectionName: 'rooms' as any,
          created: now,
          updated: now,
          name: 'Room 1',
          room_number: 1,
          house: '',
          amount_beds: bedCount,
          occupied: false,
          beds: Array.from({ length: bedCount }, (_, i) => ({
            id: String(Date.now() + i),
            collectionId: '',
            collectionName: 'beds' as any,
            created: now,
            updated: now,
            label: `B${i + 1}`,
            occupied: false,
            room: 'temp-room',
            bookedBy: '',
            order: ''
          }))
      }],
      totalBeds: bedCount,
      occupiedBeds: 0
    };
    dispatch('save', newHouse);
  }
</script>

<div class="editor-card-container">
  <div class="editor-card">
    <header class="editor-header">
        <h4>{name ? 'RECONFIGURE HOUSE' : 'NEW SANCTUARY'} 🏠</h4>
        {#if name}
            <span class="house-name-tag">{name}</span>
        {/if}
    </header>

    <div class="input-group">
        <label for="house-name">SANCTUARY NAME</label>
        <input 
            id="house-name"
            bind:value={name} 
            placeholder="e.g. Neon Cave" 
            class:error={showValidationError}
            on:input={() => showValidationError = false}
        />
        {#if showValidationError}
            <span class="error-msg" transition:fade>⚠️ NAME REQUIRED TO EXIST IN THE DUST</span>
        {/if}
    </div>

    <div class="input-group">
        <label for="bed-count">INITIAL BED CAPACITY 🛌</label>
        <div class="number-input-wrapper">
            <input id="bed-count" type="number" bind:value={bedCount} min="1" />
            <div class="laser-accent"></div>
        </div>
    </div>

    <div class="actions">
      <button class="btn-cancel" on:click={() => dispatch('cancel')}>CANCEL 🏜️</button>
      <button class="btn-save" on:click={handleSave}>
        {name ? 'APPLY CHANGES' : 'IGNITE HOUSE'} ✨
      </button>
    </div>
  </div>
</div>

<style>
  .editor-card-container {
    background: #0f0f0f;
    border: 1px solid #2dd4bf;
    padding: 2rem;
    border-radius: 12px;
    color: white;
    width: 360px;
    box-shadow: 0 0 30px rgba(45, 212, 191, 0.2);
    position: relative;
    overflow: hidden;
  }

  /* Decorative Laser Corner */
  .editor-card-container::before {
      content: '';
      position: absolute;
      top: 0; left: 0;
      width: 40px; height: 40px;
      border-top: 2px solid #f472b6;
      border-left: 2px solid #f472b6;
  }

  .editor-card { display: flex; flex-direction: column; gap: 2rem; }

  .editor-header { border-bottom: 1px solid #222; padding-bottom: 1rem; }
  h4 { margin: 0; font-size: 0.8rem; letter-spacing: 2px; color: #666; font-weight: 900; }
  .house-name-tag { font-size: 1.25rem; font-weight: bold; color: #2dd4bf; margin-top: 0.5rem; display: block; }

  .input-group { display: flex; flex-direction: column; gap: 0.75rem; }
  label { font-size: 0.7rem; font-weight: 900; color: #aaa; letter-spacing: 1px; }

  input { 
    background: #1a1a1a; 
    border: 1px solid #333; 
    color: white; 
    padding: 1rem; 
    border-radius: 8px;
    font-size: 1rem;
    transition: all 0.3s;
  }
  input:focus { outline: none; border-color: #2dd4bf; box-shadow: 0 0 10px rgba(45, 212, 191, 0.2); }
  input.error { border-color: #ef4444; background: rgba(239, 68, 68, 0.05); }

  .error-msg { font-size: 0.65rem; color: #ef4444; font-weight: bold; margin-top: 0.25rem; }

  .number-input-wrapper { position: relative; }
  .laser-accent { 
      position: absolute; bottom: 0; left: 0; width: 0%; height: 2px; 
      background: #f472b6; transition: width 0.3s ease; 
  }
  input:focus + .laser-accent { width: 100%; }

  .actions { display: flex; justify-content: space-between; align-items: center; margin-top: 1rem; }
  
  button { 
      padding: 0.75rem 1.25rem; 
      border-radius: 8px; 
      cursor: pointer; 
      font-weight: 900; 
      font-size: 0.8rem;
      letter-spacing: 1px;
      transition: all 0.2s;
  }

  .btn-cancel { 
      background: transparent; 
      border: 1px solid #444; 
      color: #888; 
  }
  .btn-cancel:hover { color: #fff; border-color: #666; background: rgba(255,255,255,0.05); }

  .btn-save { 
      background: #2dd4bf; 
      border: none; 
      color: #000; 
      box-shadow: 0 0 15px rgba(45, 212, 191, 0.3);
  }
  .btn-save:hover { transform: scale(1.05); box-shadow: 0 0 25px rgba(45, 212, 191, 0.5); }
</style>