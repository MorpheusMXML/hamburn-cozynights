<script lang="ts">
  import type { PageData } from './$types';
  import AddRoomForm from '$lib/components/admin/AddRoomForm.svelte';

  export let data: PageData;
  $: ({ house, rooms } = data);
</script>

<div class="admin-container">
  <div class="header-row">
    <a href="/admin" class="back-link">← Zurück zur Übersicht</a>
    <h1>Haus: {house.name}</h1>
  </div>

  <AddRoomForm houseId={house.id} />

  <hr />

  <h2>Zimmerliste & Auslastung</h2>
  
  <div class="rooms-grid">
    {#each rooms as room (room.id)}
      <a href="/admin/room/{room.id}" class="room-card">
        
        <div class="room-header">
          <span class="room-number">#{room.room_number}</span>
          <span class="room-name">{room.name}</span>
        </div>

        <div class="room-stats">
          <div class="stat-bar">
            <div class="fill" style="width: {(room.stats.occupied / (room.stats.total || 1)) * 100}%"></div>
          </div>
          <span class="stat-text">
            {room.stats.occupied} / {room.stats.total} Betten belegt
          </span>
        </div>
        
        <div class="card-actions">
            <object> <form action="?/deleteRoom" method="POST" on:click|stopPropagation>
                    <input type="hidden" name="id" value={room.id}>
                    <button class="btn-delete-link">Zimmer löschen</button>
                </form>
            </object>
        </div>
      </a>
    {/each}
  </div>
</div>

<style>
  .admin-container { max-width: 1000px; margin: 0 auto; padding: 2rem; color: #eee; }
  .header-row { margin-bottom: 2rem; }
  .back-link { color: #888; text-decoration: none; font-size: 0.9rem; }
  .back-link:hover { color: #fff; }

  hr { border: 0; border-top: 1px solid #333; margin: 2rem 0; }

  .rooms-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
    gap: 1.5rem;
  }

  .room-card {
    background: #1a1a1a;
    border: 1px solid #333;
    border-radius: 8px;
    padding: 1.5rem;
    text-decoration: none;
    color: inherit;
    transition: transform 0.2s, border-color 0.2s;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .room-card:hover {
    transform: translateY(-3px);
    border-color: #555;
    background: #222;
  }

  .room-header { display: flex; justify-content: space-between; align-items: center; }
  .room-number { font-weight: bold; font-size: 1.2rem; color: #fff; }
  .room-name { color: #aaa; }

  .room-stats { margin-top: auto; }
  .stat-bar { height: 4px; background: #333; border-radius: 2px; overflow: hidden; margin-bottom: 0.5rem; }
  .fill { height: 100%; background: #4CAF50; }
  .stat-text { font-size: 0.85rem; color: #888; }

  .card-actions { margin-top: 1rem; border-top: 1px solid #333; padding-top: 0.5rem; text-align: right; }
  .btn-delete-link { background: none; border: none; color: #ff4444; cursor: pointer; font-size: 0.8rem; padding: 0; text-decoration: underline; }
  .btn-delete-link:hover { color: #ff6666; }
</style>