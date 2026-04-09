<script lang="ts">
  import type { HouseData } from '$lib/types';
  import { createEventDispatcher } from 'svelte';

  export let x: number;
  export let y: number;

  const dispatch = createEventDispatcher();
  
  let name = "";
  let bedCount = 4;

  function handleSave() {
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

<div class="editor-overlay" style="left: {x/10}%; top: {y/7}%;">
  <div class="editor-card">
    <h4>New House 🏠</h4>
    <label>Name: <input bind:value={name} placeholder="House Name" /></label>
    <label>Beds 🛌: <input type="number" bind:value={bedCount} min="1" /></label>
    <div class="actions">
      <button on:click={() => dispatch('cancel')}>Cancel 🏜️</button>
      <button class="save" on:click={handleSave} disabled={!name}>Save ✨</button>
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