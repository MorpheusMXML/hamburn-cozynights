<script lang="ts">
  import type { PageData } from './$types';
  import AddBedForm from '$lib/components/admin/AddBedForm.svelte'; // Deine Komponente nutzen

  export let data: PageData;
  $: ({ room, beds } = data);
  $: house = room.expand?.house;
</script>

<div class="admin-container">
  <div class="header">
    <div class="breadcrumbs">
        <a href="/admin">Häuser</a> 
        <span class="sep">/</span>
        {#if house}<a href="/admin/house/{house.id}">{house.name}</a> <span class="sep">/</span>{/if}
        <span>Zimmer {room.room_number}</span>
    </div>
    
    <h1>{room.name || `Zimmer ${room.room_number}`} <span class="badge">{room.room_number}</span></h1>
  </div>

  <div class="content-grid">
    <div class="info-panel">
        <div class="status-card">
            <h3>Status</h3>
            <p class="big-number">{beds.filter((b: typeof beds[0]) => b.occupied).length} / {beds.length}</p>
            <p class="label">Betten belegt</p>
        </div>

        <div class="form-panel">
            <h3>Neues Bett hinzufügen</h3>
            <p class="hint">Fügt diesem Zimmer ein weiteres Bett hinzu.</p>
            <AddBedForm roomId={room.id} />
        </div>
    </div>

    <div class="beds-list-panel">
        <h3>Vorhandene Betten</h3>
        {#if beds.length === 0}
            <div class="empty-state">Keine Betten in diesem Zimmer.</div>
        {:else}
            <div class="beds-grid">
                {#each beds as bed}
                    <div class="bed-card" class:occupied={bed.occupied}>
                        <div class="bed-icon">🛏️</div>
                        <div class="bed-info">
                            <span class="bed-label">{bed.label}</span>
                            <span class="bed-status">{bed.occupied ? 'Belegt' : 'Frei'}</span>
                        </div>
                        <form action="?/deleteBed" method="POST">
                            <input type="hidden" name="id" value={bed.id}>
                            <button class="btn-icon" title="Bett löschen">🗑️</button>
                        </form>
                    </div>
                {/each}
            </div>
        {/if}
    </div>
  </div>
</div>

<style>
  .admin-container { max-width: 1000px; margin: 0 auto; padding: 2rem; color: #eee; }
  
  .breadcrumbs { color: #888; margin-bottom: 0.5rem; font-size: 0.9rem; }
  .breadcrumbs a { color: #aaa; text-decoration: none; }
  .breadcrumbs a:hover { color: #fff; text-decoration: underline; }
  .sep { margin: 0 0.5rem; color: #555; }

  h1 { display: flex; align-items: center; gap: 1rem; margin-top: 0; }
  .badge { background: #333; font-size: 1rem; padding: 4px 10px; border-radius: 4px; color: #bbb; font-weight: normal; }

  .content-grid {
      display: grid;
      grid-template-columns: 1fr 2fr;
      gap: 2rem;
      margin-top: 2rem;
  }

  /* Info Panel Styles */
  .status-card { background: #222; padding: 1.5rem; border-radius: 8px; border: 1px solid #333; margin-bottom: 1.5rem; text-align: center; }
  .big-number { font-size: 2.5rem; font-weight: bold; margin: 0.5rem 0; color: #fff; }
  .label { color: #888; margin: 0; }

  .form-panel { background: #1a1a1a; padding: 1.5rem; border-radius: 8px; border: 1px dashed #444; }
  .form-panel h3 { margin-top: 0; font-size: 1.1rem; }
  .hint { color: #666; font-size: 0.85rem; margin-bottom: 1rem; }

  /* Beds List Styles */
  .beds-list-panel h3 { margin-top: 0; border-bottom: 1px solid #333; padding-bottom: 1rem; margin-bottom: 1rem; }
  
  .beds-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 1rem; }
  
  .bed-card {
      background: #222;
      border: 1px solid #333;
      border-radius: 6px;
      padding: 1rem;
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
      position: relative;
  }
  
  .bed-card.occupied { border-color: #833; background: #2a1a1a; }
  .bed-card.occupied .bed-status { color: #f87171; }
  .bed-status { color: #4ade80; font-size: 0.8rem; font-weight: bold; margin-top: 4px; display: block; }
  
  .bed-icon { font-size: 1.5rem; margin-bottom: 0.5rem; opacity: 0.7; }
  .bed-label { font-weight: bold; font-size: 1.1rem; }

  .btn-icon {
      position: absolute;
      top: 5px;
      right: 5px;
      background: none;
      border: none;
      cursor: pointer;
      opacity: 0.3;
      transition: opacity 0.2s;
  }
  .bed-card:hover .btn-icon { opacity: 1; }
  .btn-icon:hover { transform: scale(1.1); }
  
  .empty-state { padding: 2rem; text-align: center; color: #555; border: 1px dashed #333; border-radius: 8px; }

  @media (max-width: 768px) {
      .content-grid { grid-template-columns: 1fr; }
  }
</style>