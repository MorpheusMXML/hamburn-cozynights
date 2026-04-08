<script lang="ts">
  import type { PageData } from './$types';
  import Map from '$lib/components/Map.svelte';
  import HouseEditor from '$lib/components/HouseEditor.svelte';
  import { goto, invalidateAll } from '$app/navigation';
  import { enhance } from '$app/forms';
  
  export let data: PageData;
  
  $: ({ houses, isVerified, isBookingActive } = data);

  let showMap = true; // Default to map for easier management

  // Editor Modal State
  let editingHouse: { id?: string, x: number, y: number, name: string } | null = null;

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

  // When clicking empty space on the map in editor mode
  function handleLocationSelected(event: CustomEvent) {
    const { x, y } = event.detail;
    editingHouse = { x, y, name: "" };
  }

  async function handleHouseMoved(event: CustomEvent) {
    const { id, x, y } = event.detail;
    const formData = new FormData();
    formData.append('id', id);
    formData.append('x', x.toString());
    formData.append('y', y.toString());
    
    const response = await fetch('?/updateHouseCoords', {
      method: 'POST',
      body: formData
    });

    if (!response.ok) {
      alert("The playa says NO! 🔒 This house has active bookings and cannot be moved.");
      invalidateAll(); // Revert local state
    }
  }

  function handleRenameHouse(event: CustomEvent) {
    const house = event.detail;
    editingHouse = { id: house.id, x: house.x, y: house.y, name: house.name };
  }

  async function handleSaveHouse(event: CustomEvent) {
    const newHouseData = event.detail;
    const formData = new FormData();
    formData.append('name', newHouseData.name);
    
    if (editingHouse?.id) {
      // RENAME
      formData.append('id', editingHouse.id);
      const response = await fetch('?/renameHouse', { method: 'POST', body: formData });
      if (!response.ok) alert("Failed to rename. The desert is harsh.");
    } else {
      // CREATE NEW
      formData.append('x', editingHouse?.x.toString() || "0");
      formData.append('y', editingHouse?.y.toString() || "0");
      const response = await fetch('/admin/house/new?/create', { method: 'POST', body: formData });
      if (!response.ok) alert("Creation failed. Dust in the gears.");
    }
    
    editingHouse = null;
    invalidateAll();
  }

  async function handleDeleteHouse(event: CustomEvent) {
    const house = event.detail;
    if (confirm(`Are you sure you want to delete "${house.name}"? This will vanish all rooms and beds into the dust! 🌪️`)) {
      const formData = new FormData();
      formData.append('id', house.id);
      
      const response = await fetch('?/deleteHouse', {
        method: 'POST',
        body: formData
      });
      
      if (!response.ok) {
        alert("The playa protects! 🛡️ This house has active bookings and cannot be deleted.");
      }
      invalidateAll();
    }
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
            {#if isVerified}
              <form method="POST" action="?/togglePhase" use:enhance>
                <button type="submit" class="btn-phase" class:live={isBookingActive}>
                  {isBookingActive ? '🎪 Live Booking Active' : '🛠 Pre-Orga Phase'}
                </button>
              </form>
            {/if}

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
        <div class="map-info" class:warning={isBookingActive}>
            {#if isBookingActive}
              <p><strong>🔒 Live Mode:</strong> Map interactions are locked while bookings are active. Switch to Pre-Orga to move houses. 🎪</p>
            {:else}
              <p><strong>🛠 Editor Mode:</strong> Drag houses to reposition them. Click a house for options. Click empty space to add a house. 📍</p>
            {/if}
        </div>
        <Map 
            {houses} 
            isEditorMode={true} 
            {isBookingActive}
            on:locationSelected={handleLocationSelected} 
            on:houseMoved={handleHouseMoved}
            on:renameHouse={handleRenameHouse}
            on:deleteHouse={handleDeleteHouse}
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

{#if editingHouse}
  <!-- svelte-ignore a11y-click-events-have-key-events -->
  <!-- svelte-ignore a11y-no-static-element-interactions -->
  <div class="editor-modal-backdrop" on:click={() => editingHouse = null}>
    <div on:click|stopPropagation>
      <HouseEditor 
        x={editingHouse.x} 
        y={editingHouse.y} 
        name={editingHouse.name} 
        on:save={handleSaveHouse} 
        on:cancel={() => editingHouse = null} 
      />
    </div>
  </div>
{/if}

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
      align-items: center;
  }

  .btn-phase {
    background: #333;
    color: #aaa;
    border: 1px solid #444;
    padding: 10px 20px;
    border-radius: 8px;
    cursor: pointer;
    font-weight: bold;
    transition: all 0.3s;
  }
  .btn-phase.live {
    background: rgba(239, 68, 68, 0.2);
    color: #f87171;
    border-color: #ef4444;
    box-shadow: 0 0 15px rgba(239, 68, 68, 0.3);
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

  .map-info.warning {
    background: rgba(239, 68, 68, 0.1);
    border-color: rgba(239, 68, 68, 0.3);
    color: #f87171;
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

  .editor-modal-backdrop {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0,0,0,0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 2000;
  }
</style>