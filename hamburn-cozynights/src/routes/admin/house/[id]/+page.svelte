<script lang="ts">
  import type { PageData } from './$types';
  import AddRoomForm from '$lib/components/admin/AddRoomForm.svelte';

  export let data: PageData;
  // isVerified kommt automatisch aus dem Layout
  $: ({ house, rooms, isVerified } = data);
</script>

<div class="dashboard-container">
  <div class="header-row">
    <div class="breadcrumbs">
        <a href="/admin">Übersicht</a> <span class="sep">/</span> <span>{house.name}</span>
    </div>
    <h1>{house.name} <span class="subtitle">Verwaltung</span></h1>
  </div>

  {#if isVerified}
      <div class="form-section">
          <h3>Neuen Raum hinzufügen</h3>
          <AddRoomForm houseId={house.id} />
      </div>
  {/if}

  <h2 class="section-title">Zimmer & Belegung</h2>
  
  <div class="grid">
    {#each rooms as room (room.id)}
      <a href="/admin/room/{room.id}" class="card">
        
        <div class="card-header">
          <div class="room-badges">
            <span class="room-number">#{room.room_number}</span>
          </div>
          <span class="room-name">{room.name}</span>
        </div>

        <div class="card-body">
            <div class="progress-track">
                <div 
                    class="progress-fill" 
                    style="width: {(room.stats.occupied / (room.stats.total || 1)) * 100}%"
                    class:full={room.stats.occupied === room.stats.total && room.stats.total > 0}
                ></div>
            </div>
            
            <div class="stat-row">
                <span class="label">Belegung</span>
                <span class="value">{room.stats.occupied} / {room.stats.total} Betten</span>
            </div>
        </div>
        
        {#if isVerified}
            <div class="card-actions">
                <form action="?/deleteRoom" method="POST" on:click|stopPropagation>
                    <input type="hidden" name="id" value={room.id} />
                    <button type="submit" class="btn-delete" title="Raum löschen">
                        🗑 Löschen
                    </button>
                </form>
            </div>
        {/if}
      </a>
    {/each}
  </div>
</div>

<style>
  :global(body) { background-color: #050505; color: #e5e5e5; font-family: sans-serif; margin: 0; }

  .dashboard-container { max-width: 1200px; margin: 0 auto; padding: 3rem 1.5rem; }

  /* Header & Breadcrumbs */
  .header-row { margin-bottom: 3rem; border-bottom: 1px solid #333; padding-bottom: 1rem; }
  .breadcrumbs { font-size: 0.9rem; color: #888; margin-bottom: 0.5rem; }
  .breadcrumbs a { color: #aaa; text-decoration: none; transition: color 0.2s; }
  .breadcrumbs a:hover { color: #fff; }
  .sep { margin: 0 0.5rem; color: #444; }
  
  h1 { font-size: 2rem; margin: 0; color: #fff; }
  .subtitle { color: #666; font-size: 1rem; font-weight: normal; margin-left: 10px; }
  .section-title { margin: 2rem 0 1rem; font-size: 1.2rem; color: #ccc; border-bottom: 1px solid #222; padding-bottom: 0.5rem; }

  /* Form Section */
  .form-section { background: #111; border: 1px solid #222; padding: 1.5rem; border-radius: 8px; margin-bottom: 3rem; }
  .form-section h3 { margin-top: 0; color: #ddd; font-size: 1.1rem; }

  /* Grid Layout */
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 1.5rem; }

  /* Card Styles */
  .card {
    background: #111; border: 1px solid #222; border-radius: 12px; padding: 1.5rem;
    text-decoration: none; color: inherit; display: flex; flex-direction: column; gap: 1rem;
    transition: all 0.2s ease; position: relative;
  }
  .card:hover { transform: translateY(-4px); background: #161616; border-color: #333; }

  .card-header { display: flex; justify-content: space-between; align-items: center; }
  .room-number { background: #333; color: #fff; padding: 2px 8px; border-radius: 4px; font-weight: bold; font-size: 0.9rem; }
  .room-name { font-weight: 600; font-size: 1.1rem; }

  /* Stats & Progress */
  .progress-track { height: 6px; background: #333; border-radius: 3px; overflow: hidden; margin-top: 0.5rem; }
  .progress-fill { height: 100%; background: #34d399; border-radius: 3px; }
  .progress-fill.full { background: #ef4444; }
  
  .stat-row { display: flex; justify-content: space-between; font-size: 0.85rem; color: #888; margin-top: 0.5rem; }

  /* Actions */
  .card-actions { margin-top: auto; padding-top: 1rem; border-top: 1px dashed #333; display: flex; justify-content: flex-end; }
  .btn-delete { background: none; border: none; color: #666; cursor: pointer; font-size: 0.8rem; transition: color 0.2s; padding: 0; }
  .btn-delete:hover { color: #ef4444; }
</style>