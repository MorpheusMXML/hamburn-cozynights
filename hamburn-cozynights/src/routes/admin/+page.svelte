<script lang="ts">
  import type { PageData } from './$types';
  import Map from '$lib/components/Map.svelte';
  import { goto } from '$app/navigation';
  
  export let data: PageData;
  
  $: ({ houses, isVerified } = data);

  let showMap = false; // Steuert die Sichtbarkeit der Karte

  function getStatusColor(free: number, total: number) {
    if (total === 0) return 'gray';
    if (free === 0) return 'red';
    if (free < 3) return 'orange';
    return 'green';
  }

  function getStatusText(free: number, total: number) {
      if (total === 0) return 'Not setup';
      if (free === 0) return 'Fully booked';
      return `${free} beds free`;
  }

  // Wenn auf der Karte im Editor-Modus geklickt wird
  function handleLocationSelected(event: CustomEvent) {
    const { x, y } = event.detail;
    // Weiterleitung zum "New House" Formular mit Koordinaten in der URL
    goto(`/admin/house/new?x=${x}&y=${y}`);
  }
</script>

<div class="dashboard-container">
  <header class="dashboard-header">
    <div class="header-content">
        <div>
            <h1>Hamburn Dashboard 🔥</h1>
            <p class="subtitle">Real-time house management & occupancy 🛖</p>
        </div>
        
        <div class="header-actions">
            <button class="btn-secondary" on:click={() => showMap = !showMap}>
                {showMap ? '🗺️ Show List' : '🛰️ Show Map'}
            </button>

            {#if isVerified}
                <a href="/admin/house/new" class="btn-add">
                    <span class="plus-icon">+</span> Add House 🏠
                </a>
            {/if}
        </div>
    </div>
  </header>

  {#if showMap}
    <div class="map-section">
        <div class="map-info">
            <p><strong>🛠 Editor Mode:</strong> Click anywhere on the map to place a new house at that location. 📍</p>
        </div>
        <Map 
            {houses} 
            isEditorMode={true} 
            on:locationSelected={handleLocationSelected} 
        />
    </div>
  {:else}
    <div class="grid">
        {#each houses as house}
          <a href="/admin/house/{house.id}" class="card">
            <div class="card-header">
              <h2>{house.name} 🛖</h2>
              <span class="status-badge {getStatusColor(house.freeBeds, house.totalBeds)}">
                 {getStatusText(house.freeBeds, house.totalBeds)}
              </span>
            </div>

            <div class="card-body">
                <div class="stat-row">
                    <span class="label">Occupancy 👥</span>
                    <span class="value">{house.occupiedBeds} / {house.totalBeds}</span>
                </div>

                <div class="progress-track">
                    <div 
                        class="progress-fill" 
                        style="width: {house.occupancyRate}%;"
                        class:full={house.occupancyRate === 100}
                    ></div>
                </div>
                
                <div class="coordinates">
                    📍 X: {house.x || 0} / Y: {house.y || 0}
                </div>
            </div>
          </a>
        {/each}
    </div>
  {/if}

  <form action="?/logout" method="POST" style="margin-top: 3rem; text-align: center;">
    <button type="submit" class="btn-logout">Sign out 🚪</button>
  </form>
</div>

<style>
  /* Bestehende Styles bleiben erhalten */
  :global(body) {
    background-color: #050505;
    color: #e5e5e5;
    font-family: 'Inter', sans-serif;
    margin: 0;
  }

  .dashboard-container {
    max-width: 1200px;
    margin: 0 auto;
    padding: 3rem 1.5rem;
  }

  .dashboard-header {
    margin-bottom: 3rem;
    border-bottom: 1px solid #333;
    padding-bottom: 1rem;
  }

  .header-content {
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
  }

  .header-actions {
      display: flex;
      gap: 1rem;
  }

  h1 { font-size: 2rem; color: #fff; margin: 0; }
  .subtitle { color: #888; margin-top: 0.5rem; }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
    gap: 1.5rem;
  }

  .card {
    background: #111;
    border: 1px solid #222;
    border-radius: 12px;
    padding: 1.5rem;
    text-decoration: none;
    color: inherit;
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }

  .card:hover { transform: translateY(-4px); border-color: #444; }

  /* Map Section Styles */
  .map-section {
      display: flex;
      flex-direction: column;
      gap: 1rem;
      animation: fadeIn 0.3s ease-out;
  }

  .map-info {
      background: rgba(34, 197, 94, 0.1);
      border: 1px solid rgba(34, 197, 94, 0.3);
      padding: 1rem;
      border-radius: 8px;
      color: #4ade80;
      font-size: 0.9rem;
  }

  @keyframes fadeIn {
      from { opacity: 0; transform: translateY(10px); }
      to { opacity: 1; transform: translateY(0); }
  }

  /* Buttons */
  .btn-add {
      background: #eee;
      color: #000;
      text-decoration: none;
      padding: 10px 20px;
      border-radius: 8px;
      font-weight: 600;
      display: inline-flex;
      align-items: center;
      gap: 8px;
  }

  .btn-secondary {
      background: #222;
      color: #fff;
      border: 1px solid #444;
      padding: 10px 20px;
      border-radius: 8px;
      cursor: pointer;
      font-weight: 600;
  }

  .btn-secondary:hover { background: #333; }

  .status-badge {
    font-size: 0.75rem;
    padding: 4px 10px;
    border-radius: 99px;
    font-weight: 600;
    text-transform: uppercase;
  }

  .status-badge.green { background: rgba(16, 185, 129, 0.15); color: #34d399; }
  .status-badge.red { background: rgba(239, 68, 68, 0.15); color: #f87171; }

  .progress-track { height: 6px; background: #333; border-radius: 3px; overflow: hidden; }
  .progress-fill { height: 100%; background: #34d399; transition: width 0.5s; }
  .progress-fill.full { background: #ef4444; }
  .coordinates { font-size: 0.8rem; color: #555; font-family: monospace; }
  .btn-logout { background: transparent; border: 1px solid #333; color: #888; padding: 8px 16px; border-radius: 6px; cursor: pointer; }
</style>