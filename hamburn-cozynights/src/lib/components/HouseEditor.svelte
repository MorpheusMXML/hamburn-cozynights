<script lang="ts">
  import type { House } from '$lib/types';
  import { createEventDispatcher } from 'svelte';

  export let x: number;
  export let y: number;

  const dispatch = createEventDispatcher();
  
  let name = "";
  let bedCount = 4;

  function handleSave() {
    const newHouse: House = {
      id: Date.now(), // Simple ID generation
      name,
      x,
      y,
      status: 'frei',
      beds: Array.from({ length: bedCount }, (_, i) => ({
        id: Date.now() + i,
        label: `B${i + 1}`,
        occupied: false
      }))
    };
    dispatch('save', newHouse);
  }
</script>

<div class="editor-overlay" style="left: {x/10}%; top: {y/7}%;">
  <div class="editor-card">
    <h4>Neues Haus</h4>
    <label>Name: <input bind:value={name} placeholder="Haus Name" /></label>
    <label>Betten: <input type="number" bind:value={bedCount} min="1" /></label>
    <div class="actions">
      <button on:click={() => dispatch('cancel')}>Abbrechen</button>
      <button class="save" on:click={handleSave} disabled={!name}>Speichern</button>
    </div>
  </div>
</div>

<style>
  .editor-overlay {
    position: absolute;
    z-index: 200;
    transform: translate(-50%, -110%);
    background: #1a1a1a;
    border: 2px solid #22c55e;
    padding: 15px;
    border-radius: 10px;
    color: white;
    width: 200px;
  }
  .editor-card { display: flex; flex-direction: column; gap: 10px; }
  input { background: #333; border: 1px solid #444; color: white; padding: 5px; }
  .actions { display: flex; justify-content: space-between; margin-top: 5px; }
  .save { background: #22c55e; border: none; color: white; cursor: pointer; }
</style>