<script lang="ts">
  import type { PageData } from './$types';
  import Map from '$lib/components/Map.svelte';
  import HouseEditor from '$lib/components/HouseEditor.svelte';
  import { invalidateAll } from '$app/navigation';
  import { enhance } from '$app/forms';
  import { fade, fly, slide } from 'svelte/transition';
  
  export let data: PageData;
  
  $: ({ houses, isVerified, isBookingActive, bookingUnlockAt } = data);

  let showMap = true;
  let showGuide = false;
  let unlockDateInput = bookingUnlockAt ? new Date(bookingUnlockAt).toISOString().slice(0, 16) : "";

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
      return `${free} spots free`;
  }

  function handleLocationSelected(event: CustomEvent) {
    const { x, y } = event.detail;
    editingHouse = { x, y, name: "" };
  }

  async function handleHouseMoved(event: CustomEvent) {
    const { id, x, y } = event.detail;
    
    // 1. Find the house object to get its current name
    const house = houses.find(h => h.id === id);
    if (!house) return;

    // 2. Open the editor modal immediately so the user can see/confirm the move
    editingHouse = { id: house.id, x, y, name: house.name };

    // 3. Save coordinates to background
    const formData = new FormData();
    formData.append('id', id);
    formData.append('x', x.toString());
    formData.append('y', y.toString());
    
    const response = await fetch('?/updateHouseCoords', {
      method: 'POST',
      body: formData
    });

    if (!response.ok) {
      alert("🔥 THE PLAYA PROTECTS! 🛡️ This house has active bookings and cannot be moved.");
      editingHouse = null; // Close editor if move was illegal
      invalidateAll();
    }
  }

  function handleRenameHouse(event: CustomEvent) {
    const house = event.detail;
    // Ensure all data is correctly passed to pre-fill the modal
    editingHouse = { id: house.id, x: house.x, y: house.y, name: house.name };
  }

  async function handleSaveHouse(event: CustomEvent) {
    const newHouseData = event.detail;
    
    if (!newHouseData.name || newHouseData.name.trim() === "") {
        alert("⚠️ NAME REQUIRED! A sanctuary needs a name to exist in the dust.");
        return;
    }

    const formData = new FormData();
    formData.append('name', newHouseData.name);
    
    if (editingHouse?.id) {
      formData.append('id', editingHouse.id);
      const response = await fetch('?/renameHouse', { method: 'POST', body: formData });
      if (!response.ok) alert("❌ RENAME FAILED! The desert winds are too strong.");
    } else {
      formData.append('x', editingHouse?.x.toString() || "0");
      formData.append('y', editingHouse?.y.toString() || "0");
      const response = await fetch('/admin/house/new?/create', { method: 'POST', body: formData });
      if (!response.ok) alert("❌ CREATION FAILED! The dust has clogged the gears.");
    }
    
    editingHouse = null;
    invalidateAll();
  }

  async function handleDeleteHouse(event: CustomEvent) {
    const house = event.detail;
    if (confirm(`⚠️ DANGER! ⚠️ Are you sure you want to vanish "${house.name}"? All rooms and beds inside will be lost to the dust forever! 🌪️`)) {
      const formData = new FormData();
      formData.append('id', house.id);
      
      const response = await fetch('?/deleteHouse', {
        method: 'POST',
        body: formData
      });
      
      if (!response.ok) {
        alert("🛑 ACTION BLOCKED! This house is already inhabited by burners.");
      }
      invalidateAll();
    }
  }
</script>

<div class="dashboard-wrapper">
  <!-- Interactive Header -->
  <header class="page-header">
    <div class="header-left">
        <h1>Control Center 🔥</h1>
        <p class="subtitle">Orchestrating the chaos of the playa 🏜️</p>
    </div>
    
        <div class="header-right">
            {#if isVerified && !isBookingActive}
              <div class="timer-config" in:fade>
                {#if bookingUnlockAt}
                  <div class="active-timer-display">
                    <div class="timer-info">
                      <span class="label">ACTIVE COUNTDOWN ⏳</span>
                      <span class="value">{new Date(bookingUnlockAt).toLocaleString()}</span>
                    </div>
                    <form method="POST" action="?/cancelUnlockTimer" use:enhance={() => {
                      return async ({ result, update }) => {
                        if (confirm("⚠️ WARNING: This will immediately stop the countdown for all burners. Continue?")) {
                          await update();
                        }
                      };
                    }}>
                      <button type="submit" class="btn-cancel-timer">Cancel</button>
                    </form>
                  </div>
                {:else}
                  <form method="POST" action="?/setUnlockTimer" use:enhance>
                    <label for="unlockAt">AUTO-UNLOCK ⏳</label>
                    <div class="input-row">
                      <input type="datetime-local" id="unlockAt" name="unlockAt" bind:value={unlockDateInput} required />
                      <button type="submit" class="btn-save-timer">Set</button>
                    </div>
                  </form>
                {/if}
              </div>
            {/if}

            <button class="btn-guide" on:click={() => showGuide = !showGuide}>
            {showGuide ? 'Close Intel 📖' : 'Show Intel ❓'}
        </button>

        {#if isVerified}
          <form method="POST" action="?/togglePhase" use:enhance>
            <button type="submit" class="btn-laser" class:live={isBookingActive}>
              {isBookingActive ? '🎪 LIVE BOOKING ACTIVE' : '🛠 PRE-ORGA PHASE'}
              <div class="laser-glow"></div>
            </button>
          </form>
        {/if}

        <button class="btn-toggle" on:click={() => showMap = !showMap}>
            {showMap ? '🛰️ LIST VIEW' : '🗺️ MAP VIEW'}
        </button>
    </div>
  </header>

  <!-- Interactive Guide -->
  {#if showGuide}
    <section class="intel-panel" transition:slide>
        <div class="intel-grid">
            <div class="intel-card turquoise">
                <span class="icon">📍</span>
                <h3>Placing Houses</h3>
                <p>Click any empty spot on the map to ignite a new sanctuary. Name it wisely!</p>
            </div>
            <div class="intel-card pink">
                <span class="icon">🖱️</span>
                <h3>Drag & Drop</h3>
                <p>Grab a house and drag it across the dust. (Only allowed in 🛠 PRE-ORGA phase)</p>
            </div>
            <div class="intel-card orange">
                <span class="icon">⚙️</span>
                <h3>Management</h3>
                <p>Click a house to rename it, manage rooms, or vanish it from existence.</p>
            </div>
            <div class="intel-card green">
                <span class="icon">🎪</span>
                <h3>Go Live</h3>
                <p>Switch to Live Booking to let burners secure their spots. Map layout will be locked 🔒</p>
            </div>
        </div>
    </section>
  {/if}

  <!-- Main View -->
  <main class="view-container">
    {#if showMap}
      <div class="map-view" in:fade={{ duration: 300 }}>
          <div class="map-status-bar" class:live={isBookingActive}>
              {#if isBookingActive}
                <span class="status-msg">🔒 MAP LOCKED: Bookings are active on the playa!</span>
              {:else}
                <span class="status-msg">🛠 EDITOR ACTIVE: Drag houses to reposition them.</span>
              {/if}
          </div>
          <div class="map-frame">
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
      </div>
    {:else}
      <div class="grid-view" in:fade={{ duration: 300 }}>
          {#each houses as house}
            <a href="/admin/house/{house.id}" class="house-card">
              <div class="card-glow"></div>
              <header class="card-header">
                <h2>{house.name} 🛖</h2>
                <span class="badge {getStatusColor(house.freeBeds, house.totalBeds)}">
                   {getStatusText(house.freeBeds, house.totalBeds)}
                </span>
              </header>

              <div class="card-body">
                  <div class="stat-group">
                      <span class="stat-label">Occupancy 👥</span>
                      <span class="stat-value">{house.occupiedBeds} / {house.totalBeds}</span>
                  </div>

                  <div class="progress-bar">
                      <div 
                          class="progress-fill" 
                          style="width: {house.occupancyRate}%;"
                          class:full={house.occupancyRate === 100}
                      ></div>
                  </div>
                  
                  <footer class="card-footer">
                      <span>📍 X: {house.x} / Y: {house.y}</span>
                      <span class="btn-manage">Manage ⚙️</span>
                  </footer>
              </div>
            </a>
          {/each}
          
          {#if isVerified}
            <button class="add-house-card" on:click={() => showMap = true}>
                <span class="plus">+</span>
                <span>Open Map to Add House</span>
            </button>
          {/if}
      </div>
    {/if}
  </main>
</div>

<!-- Editor Modal -->
{#if editingHouse}
  <!-- svelte-ignore a11y-click-events-have-key-events -->
  <!-- svelte-ignore a11y-no-static-element-interactions -->
  <div class="modal-overlay" transition:fade={{ duration: 200 }} on:mousedown={() => {
      console.log('[Dashboard] Closing editor modal (backdrop click)');
      editingHouse = null;
  }}>
    <div class="modal-content" on:mousedown|stopPropagation in:fly={{ y: 50, duration: 400 }}>
      <HouseEditor 
        x={editingHouse.x} 
        y={editingHouse.y} 
        name={editingHouse.name} 
        houseId={editingHouse.id}
        on:save={handleSaveHouse} 
        on:cancel={() => {
            console.log('[Dashboard] Closing editor modal (cancel button)');
            editingHouse = null;
        }} 
      />
    </div>
  </div>
{/if}

<style>
  .dashboard-wrapper {
    display: flex;
    flex-direction: column;
    gap: 2rem;
  }

  /* Header */
  .page-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    padding-bottom: 1.5rem;
    border-bottom: 1px solid #222;
  }

  h1 { font-size: 2.5rem; font-weight: 900; color: #fff; margin: 0; letter-spacing: -1px; }
  .subtitle { color: #666; margin: 0.5rem 0 0 0; font-size: 1rem; }

  .header-right { display: flex; gap: 1rem; align-items: center; }

  .timer-config {
    background: #0a0a0a;
    border: 1px solid #333;
    padding: 0.5rem 1rem;
    border-radius: 8px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .timer-config label { font-size: 0.6rem; font-weight: 900; color: #666; letter-spacing: 1px; }
  .timer-config .input-row { display: flex; gap: 8px; }
  .timer-config input { 
    background: transparent; border: none; color: #fb923c; font-family: monospace; font-size: 0.8rem; 
    outline: none; width: 160px;
  }
  .btn-save-timer {
    background: #fb923c; color: #000; border: none; padding: 2px 8px; border-radius: 4px;
    font-size: 0.7rem; font-weight: 900; cursor: pointer;
  }

  .active-timer-display {
    display: flex;
    align-items: center;
    gap: 1rem;
  }
  .timer-info { display: flex; flex-direction: column; gap: 2px; }
  .active-timer-display .value { color: #fb923c; font-weight: 900; font-size: 0.8rem; font-family: monospace; }
  .btn-cancel-timer {
    background: transparent; border: 1px solid #ef4444; color: #ef4444; padding: 4px 10px; border-radius: 6px;
    font-size: 0.7rem; font-weight: 900; cursor: pointer; transition: all 0.2s;
  }
  .btn-cancel-timer:hover { background: #ef4444; color: #fff; box-shadow: 0 0 10px rgba(239, 68, 68, 0.3); }

  /* Buttons */
  .btn-laser {
    background: #111;
    color: #fca5a5;
    border: 1px solid #ef4444;
    padding: 0.75rem 1.5rem;
    border-radius: 8px;
    font-weight: 900;
    cursor: pointer;
    position: relative;
    overflow: hidden;
    transition: all 0.3s;
    letter-spacing: 1px;
    text-shadow: 0 0 8px rgba(239, 68, 68, 0.5);
  }
  .btn-laser.live {
    background: #ef4444;
    color: #fff;
    box-shadow: 0 0 20px rgba(239, 68, 68, 0.4);
  }
  .btn-laser:hover { transform: translateY(-2px); box-shadow: 0 5px 15px rgba(239, 68, 68, 0.3); }

  .btn-toggle, .btn-guide {
    background: #1a1a1a;
    color: #2dd4bf;
    border: 1px solid #2dd4bf;
    padding: 0.75rem 1.25rem;
    border-radius: 8px;
    font-weight: bold;
    cursor: pointer;
    transition: all 0.2s;
  }
  .btn-toggle:hover, .btn-guide:hover { background: rgba(45, 212, 191, 0.1); box-shadow: 0 0 15px rgba(45, 212, 191, 0.2); }

  .btn-guide { color: #f472b6; border-color: #f472b6; }
  .btn-guide:hover { background: rgba(244, 114, 182, 0.1); box-shadow: 0 0 15px rgba(244, 114, 182, 0.2); }

  /* Intel Panel */
  .intel-panel {
    background: #111;
    border: 1px dashed #333;
    border-radius: 16px;
    padding: 2rem;
  }
  .intel-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1.5rem; }
  
  .intel-card {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 1.5rem;
    background: #0a0a0a;
    border-radius: 12px;
    border-left: 4px solid #333;
  }
  .intel-card.turquoise { border-left-color: #2dd4bf; }
  .intel-card.pink { border-left-color: #f472b6; }
  .intel-card.orange { border-left-color: #fb923c; }
  .intel-card.green { border-left-color: #4ade80; }

  .intel-card h3 { margin: 0; font-size: 1rem; color: #fff; }
  .intel-card p { margin: 0; font-size: 0.85rem; color: #888; line-height: 1.4; }
  .icon { font-size: 1.5rem; }

  /* Map View */
  .map-view { display: flex; flex-direction: column; gap: 1rem; }
  .map-status-bar {
    padding: 0.75rem 1.5rem;
    background: rgba(45, 212, 191, 0.1);
    border: 1px solid rgba(45, 212, 191, 0.3);
    border-radius: 8px;
    color: #2dd4bf;
    font-weight: bold;
    font-size: 0.9rem;
    text-align: center;
  }
  .map-status-bar.live { background: rgba(239, 68, 68, 0.1); border-color: rgba(239, 68, 68, 0.3); color: #f87171; }
  .map-frame {
    height: 70vh;
    border: 2px solid #222;
    border-radius: 16px;
    overflow: hidden;
    position: relative;
    box-shadow: 0 20px 50px rgba(0,0,0,0.5);
  }

  /* Grid View */
  .grid-view { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 2rem; }
  
  .house-card {
    background: #111;
    border: 1px solid #222;
    border-radius: 16px;
    padding: 1.5rem;
    text-decoration: none;
    color: inherit;
    position: relative;
    overflow: hidden;
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  }
  .house-card:hover { border-color: #444; transform: translateY(-5px); box-shadow: 0 10px 30px rgba(0,0,0,0.5); }
  
  .card-glow {
    position: absolute; top: 0; left: 0; width: 100%; height: 100%;
    background: linear-gradient(45deg, transparent, rgba(45, 212, 191, 0.05), transparent);
    pointer-events: none;
  }

  .card-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem; }
  .card-header h2 { margin: 0; font-size: 1.25rem; color: #fff; }

  .stat-group { display: flex; justify-content: space-between; margin-bottom: 0.5rem; }
  .stat-label { color: #666; font-size: 0.85rem; }
  .stat-value { color: #eee; font-weight: bold; }

  .progress-bar { height: 8px; background: #222; border-radius: 4px; overflow: hidden; margin-bottom: 1.5rem; }
  .progress-fill { height: 100%; background: #2dd4bf; transition: width 1s ease-out; }
  .progress-fill.full { background: #f87171; }

  .card-footer { display: flex; justify-content: space-between; align-items: center; font-size: 0.75rem; color: #444; font-family: monospace; }
  .btn-manage { color: #2dd4bf; font-weight: bold; text-transform: uppercase; letter-spacing: 1px; font-family: sans-serif; }

  .add-house-card {
    background: transparent; border: 2px dashed #222; border-radius: 16px;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: 1rem; color: #444; cursor: pointer; transition: all 0.2s;
  }
  .add-house-card:hover { border-color: #2dd4bf; color: #2dd4bf; background: rgba(45, 212, 191, 0.05); }
  .add-house-card .plus { font-size: 3rem; font-weight: 100; }

  /* Badge Colors */
  .badge { padding: 4px 10px; border-radius: 99px; font-size: 0.7rem; font-weight: 900; text-transform: uppercase; border: 1px solid currentColor; }
  .badge.green { color: #4ade80; background: rgba(74, 222, 128, 0.1); }
  .badge.orange { color: #fb923c; background: rgba(251, 146, 60, 0.1); }
  .badge.red { color: #f87171; background: rgba(248, 113, 113, 0.1); }
  .badge.gray { color: #666; background: rgba(102, 102, 102, 0.1); }

  /* Modal */
  .modal-overlay {
    position: fixed; top: 0; left: 0; width: 100%; height: 100%;
    background: rgba(0,0,0,0.85); backdrop-filter: blur(8px);
    display: flex; align-items: center; justify-content: center; z-index: 2000;
  }
</style>