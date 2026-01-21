<script lang="ts">
  import type { PageData } from './$types';
  import AddBedForm from '$lib/components/admin/AddBedForm.svelte';

  export let data: PageData;
  // isVerified aus dem Layout
  $: ({ room, beds, isVerified } = data);
  $: house = room.expand?.house;
</script>

<div class="dashboard-container">
  <div class="header-row">
    <div class="breadcrumbs">
        <a href="/admin">Übersicht</a> 
        <span class="sep">/</span>
        {#if house}<a href="/admin/house/{house.id}">{house.name}</a> <span class="sep">/</span>{/if}
        <span>Zimmer {room.room_number}</span>
    </div>
    
    <h1>{room.name || `Zimmer ${room.room_number}`} <span class="badge">#{room.room_number}</span></h1>
  </div>

  <div class="content-split">
    <div class="info-column">
        <div class="status-card">
            <h3>Auslastung</h3>
            <div class="big-number">
                {beds.filter(b => b.occupied).length} <span class="divider">/</span> {beds.length}
            </div>
            <p class="label">Betten belegt</p>
        </div>

        {#if isVerified}
            <div class="form-panel">
                <h3>Neues Bett hinzufügen</h3>
                <p class="hint">Bezeichnung (z.B. "Etagenbett unten links")</p>
                <AddBedForm roomId={room.id} />
            </div>
        {/if}
    </div>

    <div class="beds-column">
        <h3 class="column-title">Vorhandene Betten</h3>
        
        <div class="beds-grid">
            {#each beds as bed (bed.id)}
                <div class="bed-card" class:occupied={bed.occupied}>
                    <div class="bed-icon">
                        {#if bed.occupied}🔴{:else}🟢{/if}
                    </div>
                    <div class="bed-info">
                        <span class="bed-label">{bed.label || 'Unbenannt'}</span>
                        <span class="bed-status">{bed.occupied ? 'Belegt' : 'Frei'}</span>
                    </div>

                    <div class="bed-actions">
                        <form action="?/toggleOccupied" method="POST">
                            <input type="hidden" name="id" value={bed.id} />
                            <input type="hidden" name="occupied" value={bed.occupied.toString()} />
                            <button class="btn-icon" title="Status ändern">🔄</button>
                        </form>

                        {#if isVerified}
                            <form action="?/deleteBed" method="POST">
                                <input type="hidden" name="id" value={bed.id} />
                                <button class="btn-icon delete" title="Bett löschen">🗑</button>
                            </form>
                        {/if}
                    </div>
                </div>
            {/each}
            
            {#if beds.length === 0}
                <div class="empty-state">Noch keine Betten in diesem Zimmer.</div>
            {/if}
        </div>
    </div>
  </div>
</div>

<style>
  :global(body) { background-color: #050505; color: #e5e5e5; font-family: sans-serif; margin: 0; }
  
  .dashboard-container { max-width: 1200px; margin: 0 auto; padding: 3rem 1.5rem; }

  /* Header */
  .header-row { margin-bottom: 3rem; border-bottom: 1px solid #333; padding-bottom: 1rem; }
  .breadcrumbs { font-size: 0.9rem; color: #888; margin-bottom: 0.5rem; }
  .breadcrumbs a { color: #aaa; text-decoration: none; }
  .breadcrumbs a:hover { color: #fff; }
  .sep { margin: 0 0.5rem; color: #444; }
  h1 { font-size: 2rem; margin: 0; color: #fff; display: flex; align-items: center; gap: 10px; }
  .badge { background: #333; font-size: 1rem; padding: 4px 10px; border-radius: 6px; color: #aaa; }

  /* Layout */
  .content-split { display: grid; grid-template-columns: 1fr 2fr; gap: 2rem; }
  @media (max-width: 768px) { .content-split { grid-template-columns: 1fr; } }

  /* Info Column */
  .status-card { background: #111; border: 1px solid #222; padding: 1.5rem; border-radius: 8px; text-align: center; margin-bottom: 1.5rem; }
  .status-card h3 { margin: 0 0 0.5rem 0; color: #888; font-size: 0.9rem; text-transform: uppercase; letter-spacing: 1px; }
  .big-number { font-size: 2.5rem; font-weight: bold; color: #fff; }
  .big-number .divider { color: #444; font-size: 1.5rem; vertical-align: middle; }
  .label { margin: 0; color: #666; font-size: 0.8rem; }

  .form-panel { background: #111; border: 1px dashed #333; padding: 1.5rem; border-radius: 8px; }
  .form-panel h3 { margin-top: 0; color: #ddd; font-size: 1.1rem; }
  .hint { color: #666; font-size: 0.85rem; margin-bottom: 1rem; }

  /* Beds Column */
  .column-title { margin-top: 0; border-bottom: 1px solid #333; padding-bottom: 1rem; color: #ccc; }
  .beds-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 1rem; }
  
  .bed-card {
      background: #1a1a1a; border: 1px solid #333; border-radius: 8px; padding: 1rem;
      display: flex; align-items: center; gap: 1rem; transition: all 0.2s;
  }
  .bed-card.occupied { border-color: #522; background: #2a1a1a; }
  
  .bed-icon { font-size: 1.2rem; }
  .bed-info { flex: 1; display: flex; flex-direction: column; }
  .bed-label { font-weight: bold; font-size: 1rem; }
  .bed-status { font-size: 0.75rem; color: #666; text-transform: uppercase; margin-top: 2px; }
  .occupied .bed-status { color: #f87171; }

  .bed-actions { display: flex; gap: 0.5rem; }
  .btn-icon { background: #222; border: 1px solid #333; color: #888; border-radius: 4px; cursor: pointer; padding: 6px; transition: all 0.2s; }
  .btn-icon:hover { background: #333; color: #fff; }
  .btn-icon.delete:hover { background: #311; color: #f87171; border-color: #522; }

  .empty-state { grid-column: 1/-1; text-align: center; color: #444; padding: 2rem; background: #111; border-radius: 8px; border: 1px dashed #333; }
</style>