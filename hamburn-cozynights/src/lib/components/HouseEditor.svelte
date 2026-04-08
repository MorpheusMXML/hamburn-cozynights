<script lang="ts">
  import type { HouseData } from '$lib/types';
  import { createEventDispatcher } from 'svelte';

  export let x: number;
  export let y: number;
  export let name = "";

  const dispatch = createEventDispatcher();
  
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
    <h4>{name ? `Edit House ${name}` : 'New House'} 🏠</h4>
    <label>Name: <input bind:value={name} placeholder="House Name" /></label>
    <label>Initial Beds 🛌: <input type="number" bind:value={bedCount} min="1" /></label>
    <div class="actions">
      <button on:click={() => dispatch('cancel')}>Cancel 🏜️</button>
      <button class="save" on:click={handleSave} disabled={!name}>Save ✨</button>
    </div>
  </div>
</div>

<style>
  .editor-card-container {
    background: #1a1a1a;
    border: 2px solid #22c55e;
    padding: 20px;
    border-radius: 12px;
    color: white;
    width: 300px;
    box-shadow: 0 10px 25px rgba(0,0,0,0.5);
  }
  .editor-card { display: flex; flex-direction: column; gap: 15px; }
  label { display: flex; flex-direction: column; gap: 5px; font-size: 0.9rem; color: #aaa; }
  input { background: #333; border: 1px solid #444; color: white; padding: 10px; border-radius: 6px; }
  .actions { display: flex; justify-content: space-between; margin-top: 10px; }
  button { padding: 8px 15px; border-radius: 6px; cursor: pointer; border: 1px solid #444; background: #222; color: #ccc; }
  .save { background: #22c55e; border: none; color: white; font-weight: bold; }
</style>