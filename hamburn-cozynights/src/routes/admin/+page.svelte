<script lang="ts">
  import type { PageData } from './$types';
  import Map from '$lib/components/Map.svelte';
  import HouseEditor from '$lib/components/HouseEditor.svelte';
  import { invalidateAll } from '$app/navigation';
  import { enhance } from '$app/forms';
  import { fade, fly, slide } from 'svelte/transition';
  
  export let data: PageData;
  
  $: ({ houses, isVerified, isBookingActive, bookingUnlockAt } = data);

  // Management Summary Calculations
  $: totalBeds = houses.reduce((sum, h) => sum + (h.totalBeds || 0), 0);
  $: occupiedBeds = houses.reduce((sum, h) => sum + (h.occupiedBeds || 0), 0);
  $: freeBeds = totalBeds - occupiedBeds;
  $: occupancyRate = totalBeds > 0 ? (occupiedBeds / totalBeds) * 100 : 0;
  
  $: houseStats = {
      empty: houses.filter(h => h.occupiedBeds === 0 && h.totalBeds > 0).length,
      partial: houses.filter(h => h.occupiedBeds > 0 && h.occupiedBeds < h.totalBeds).length,
      full: houses.filter(h => h.occupiedBeds >= h.totalBeds && h.totalBeds > 0).length,
      unconfigured: houses.filter(h => h.totalBeds === 0).length
  };

  // Main View state
  let showMap = true;
  let showGuide = false;
  let selectedHouseId: string | null = null;
  let unlockDateInput = bookingUnlockAt ? new Date(bookingUnlockAt).toISOString().slice(0, 16) : "";

  // Editor Sidebar State
  let editingHouse: { id?: string, x: number, y: number, name: string } | null = null;

  // Compute the currently active house for the sidebar
  $: activeHouse = houses.find(h => h.id === selectedHouseId) || (editingHouse?.id ? null : editingHouse);

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

  async function submitAction(actionUrl: string, formData: FormData) {
    try {
      const response = await fetch(actionUrl, {
        method: 'POST',
        body: formData,
        headers: {
          'x-sveltekit-action': 'true',
          'accept': 'application/json'
        }
      });
      const result = await response.json();
      return result;
    } catch (err: any) {
      console.error(`[Action Error] Fetch failed for ${actionUrl}:`, err);
      return { type: 'error', error: err.message };
    }
  }

  // When clicking empty space on the map in editor mode
  function handleLocationSelected(data: { x: number, y: number }) {
    const { x, y } = data;
    selectedHouseId = null; // Deselect existing
    editingHouse = { x, y, name: "" };
    console.log(`[Dashboard] Preparing new house deployment at (${x}, ${y})`);
  }

  async function handleHouseMoved(event: CustomEvent) {
    const { id, x, y } = event.detail;
    selectedHouseId = id; // Select the house being moved
    
    // 1. Find the house object to get its current name
    const house = houses.find(h => h.id === id);
    if (!house) return;

    // 2. Update local state for sidebar
    editingHouse = { id: house.id, x, y, name: house.name };

    // 3. Save coordinates to background
    const formData = new FormData();
    formData.append('id', id);
    formData.append('x', x.toString());
    formData.append('y', y.toString());
    
    const result = await submitAction('?/updateHouseCoords', formData);

    if (result.type !== 'success') {
      alert(`🔥 THE PLAYA PROTECTS! 🛡️ ${result.data?.error || 'This house has active bookings and cannot be moved.'}`);
      editingHouse = null;
      selectedHouseId = null;
      invalidateAll();
    }
  }

  function handleSelectHouse(event: CustomEvent) {
    const house = event.detail;
    selectedHouseId = house.id;
    editingHouse = { id: house.id, x: house.x, y: house.y, name: house.name };
    console.log(`[Dashboard] House selected: ${house.name}`);
  }

  function handleRenameHouse(house: any) {
    selectedHouseId = house.id;
    editingHouse = { id: house.id, x: house.x, y: house.y, name: house.name };
    console.log(`[Dashboard] House selected for rename: ${house.name}`);
  }

  async function handleDeleteHouse(house: any) {
    if (!house || !house.id) return;
    
    if (confirm(`⚠️ DANGER! ⚠️ Are you sure you want to vanish "${house.name}"? This will evaporate all modules and spots! 🌪️`)) {
      const formData = new FormData();
      formData.append('id', house.id);
      
      const result = await submitAction('?/deleteHouse', formData);
      
      if (result.type !== 'success') {
        alert(`❌ VANISH FAILED! ${result.data?.error || 'The playa protects this sanctuary.'}`);
      }
      invalidateAll();
    }
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
      // RENAME / UPDATE
      formData.append('id', editingHouse.id);
      const result = await submitAction('?/renameHouse', formData);
      if (result.type !== 'success') alert(`❌ RENAME FAILED! ${result.data?.error || 'The desert winds are too strong.'}`);
    } else {
      // CREATE NEW
      formData.append('x', editingHouse?.x.toString() || "0");
      formData.append('y', editingHouse?.y.toString() || "0");
      formData.append('bedCount', newHouseData.totalBeds?.toString() || "0"); // Correctly map bedCount
      
      const result = await submitAction('/admin/house/new?/create', formData);
      if (result.type !== 'success') alert(`❌ CREATION FAILED! ${result.data?.error || 'The dust has clogged the gears.'}`);
    }
    
    editingHouse = null;
    selectedHouseId = null;
    invalidateAll();
  }

  async function handleDeleteActiveHouse() {
    if (!activeHouse || !activeHouse.id) return;
    
    if (confirm(`⚠️ DANGER! ⚠️ Are you sure you want to vanish "${activeHouse.name}"? This will evaporate all modules and spots! 🌪️`)) {
      console.log(`[Dashboard] Requesting VANISH for house ID: ${activeHouse.id}`);
      
      // Visual feedback: Start disintegration
      const card = document.querySelector(`.house-card-wrapper:has([href*="${activeHouse.id}"])`);
      if (card) card.classList.add('disintegrating');
      const sidebar = document.querySelector('.details-sidebar');
      if (sidebar) sidebar.classList.add('disintegrating');

      const formData = new FormData();
      formData.append('id', activeHouse.id);
      
      // Delay deletion slightly to let animation play
      await new Promise(resolve => setTimeout(resolve, 500));

      const result = await submitAction('?/deleteHouse', formData);
      
      if (result.type !== 'success') {
        console.error('[Dashboard] Vanish FAILED:', result);
        // Revert visual state if failed
        if (card) card.classList.remove('disintegrating');
        if (sidebar) sidebar.classList.remove('disintegrating');
        alert(`🛑 ACTION BLOCKED! ${result.data?.error || 'The playa resisted your command.'}`);
      } else {
        console.log('[Dashboard] Vanish SUCCESS. Clearing state...');
        selectedHouseId = null;
        editingHouse = null;
        await invalidateAll();
      }
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
            {#if !showGuide}
                <button class="btn-help-small" on:click={() => showGuide = true} in:fade>
                    HELP EDITING ❓
                </button>
            {/if}

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

            <button class="btn-guide" on:click={() => showGuide = !showGuide} class:active={showGuide}>
            {showGuide ? 'CLOSE INTEL 📡' : 'SHOW INTEL 📊'}
        </button>

        {#if isVerified}
          <form method="POST" action="?/togglePhase" use:enhance>
            <button type="submit" class="btn-laser" class:live={isBookingActive}>
              {isBookingActive ? '🎪 LIVE BOOKING ACTIVE' : '🛠 STAGING MODE'}
              <div class="laser-glow"></div>
            </button>
          </form>
        {/if}

        <button class="btn-toggle" on:click={() => showMap = !showMap}>
            {showMap ? '🛰️ LIST VIEW' : '🗺️ MAP VIEW'}
        </button>
    </div>
  </header>

  <!-- Interactive Dashboard & Guide -->
  {#if showGuide}
    <section class="intel-panel" transition:slide>
        <div class="intel-container">
            <!-- Management Summary -->
            <div class="dashboard-section">
                <div class="section-header">
                    <span class="laser-dot pink"></span>
                    <h3>LIVE OPERATIONS INTEL</h3>
                </div>
                
                <div class="stats-grid">
                    <div class="stat-box cyan">
                        <span class="label">CAPACITY</span>
                        <span class="value">{totalBeds}</span>
                    </div>
                    <div class="stat-box pink">
                        <span class="label">BOOKED</span>
                        <span class="value">{occupiedBeds}</span>
                    </div>
                    <div class="stat-box green">
                        <span class="label">FREE</span>
                        <span class="value">{freeBeds}</span>
                    </div>
                    <div class="stat-box orange">
                        <span class="label">LOAD</span>
                        <span class="value">{occupancyRate.toFixed(1)}%</span>
                    </div>
                </div>

                <div class="visual-progress">
                    <div class="progress-track">
                        <div class="progress-fill laser-gradient" style="width: {occupancyRate}%"></div>
                        <div class="scanline"></div>
                    </div>
                    <div class="status-legend">
                        <div class="legend-item">
                            <span class="dot empty"></span>
                            <span class="count">{houseStats.empty}</span>
                            <span class="text">EMPTY</span>
                        </div>
                        <div class="legend-item">
                            <span class="dot partial"></span>
                            <span class="count">{houseStats.partial}</span>
                            <span class="text">FILLING</span>
                        </div>
                        <div class="legend-item">
                            <span class="dot full"></span>
                            <span class="count">{houseStats.full}</span>
                            <span class="text">FULL</span>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Help Section -->
            <div class="dashboard-section">
                <div class="section-header">
                    <span class="laser-dot turquoise"></span>
                    <h3>PLAYA PROTOCOLS</h3>
                </div>
                <div class="intel-grid">
                    <div class="intel-card turquoise">
                        <span class="icon">📍</span>
                        <p>Click map to ignite house. (STAGING ONLY)</p>
                    </div>
                    <div class="intel-card pink">
                        <span class="icon">🖱️</span>
                        <p>Drag to reposition. (STAGING ONLY)</p>
                    </div>
                    <div class="intel-card orange">
                        <span class="icon">⚙️</span>
                        <p>Click house for Unit Intel sidebar.</p>
                    </div>
                    <div class="intel-card green">
                        <span class="icon">🎪</span>
                        <p>Go LIVE to lock layout & allow bookings.</p>
                    </div>
                </div>
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
                <span class="status-msg">🛠 EDITOR ACTIVE: Drag houses to reposition. Click house or space to manage.</span>
              {/if}
          </div>
          <div class="map-layout-split">
              <div class="map-frame">
                  <Map 
                      {houses} 
                      isEditorMode={true} 
                      {isBookingActive}
                      on:locationSelected={(e) => handleLocationSelected(e.detail)} 
                      on:houseMoved={handleHouseMoved}
                      on:renameHouse={handleSelectHouse}
                      on:deleteHouse={(e) => handleDeleteHouse(e.detail)}
                  />
              </div>

              {#if activeHouse}
                <aside class="details-sidebar" in:fly={{ x: 100, duration: 400 }}>
                    <div class="sidebar-header">
                        <span class="laser-dot turquoise"></span>
                        <h3>{selectedHouseId ? 'UNIT INTEL' : 'NEW DEPLOYMENT'}</h3>
                        <button class="btn-close-sidebar" on:click={() => { selectedHouseId = null; editingHouse = null; }}>&times;</button>
                    </div>

                    <div class="sidebar-content">
                        <HouseEditor 
                            x={activeHouse.x} 
                            y={activeHouse.y} 
                            name={activeHouse.name} 
                            houseId={selectedHouseId || undefined}
                            flat={true}
                            on:save={handleSaveHouse} 
                            on:cancel={() => { selectedHouseId = null; editingHouse = null; }} 
                        />

                        {#if selectedHouseId}
                            <div class="danger-zone" in:fade>
                                <span class="zone-label">CRITICAL ACTIONS</span>
                                <a href="/admin/house/{selectedHouseId}" class="btn-manage-link">MANAGE MODULES ⚙️</a>
                                <button class="btn-vanish-big" on:click={handleDeleteActiveHouse}>
                                    VANISH FROM PLAYA 🌪️
                                </button>
                            </div>
                        {/if}
                    </div>
                </aside>
              {/if}
          </div>
      </div>
    {:else}
    <div class="grid-view" in:fade={{ duration: 300 }}>
          {#each houses as house}
            <div class="house-card-wrapper">
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
                    </footer>
                </div>
              </a>
              
              {#if isVerified}
                <div class="card-admin-actions">
                    <button class="btn-action-small" on:click={() => handleRenameHouse(house)}>RENAME ✏️</button>
                    <button class="btn-action-small vanish" on:click={() => handleDeleteHouse(house)}>VANISH 🌪️</button>
                </div>
              {/if}
            </div>
          {/each}
          
          {#if isVerified}
            <button class="add-house-card" on:click={() => handleLocationSelected({ x: 500, y: 350 })}>
                <span class="plus">+</span>
                <span>Ignite New House</span>
                <small>Auto-centered at 500/350</small>
            </button>
          {/if}
      </div>
    {/if}
  </main>
</div>

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

  /* Intel Panel & Dashboard */
  .intel-panel {
    background: #0a0a0a;
    border: 1px solid #222;
    border-radius: 16px;
    padding: 2rem;
    box-shadow: inset 0 0 50px rgba(0,0,0,0.8), 0 0 20px rgba(0,0,0,0.5);
  }

  .intel-container {
      display: grid;
      grid-template-columns: 1.5fr 1fr;
      gap: 3rem;
  }

  @media (max-width: 1000px) {
      .intel-container { grid-template-columns: 1fr; gap: 2rem; }
  }

  .dashboard-section {
      display: flex;
      flex-direction: column;
      gap: 1.5rem;
  }

  .section-header {
      display: flex;
      align-items: center;
      gap: 12px;
      border-bottom: 1px solid #1a1a1a;
      padding-bottom: 0.75rem;
  }
  .section-header h3 { margin: 0; font-size: 0.7rem; font-weight: 900; letter-spacing: 2.5px; color: #666; }

  .stats-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 1rem;
  }
  .stat-box {
      background: #111;
      padding: 1.25rem;
      border-radius: 12px;
      display: flex;
      flex-direction: column;
      gap: 4px;
      border: 1px solid #222;
      position: relative;
      overflow: hidden;
  }
  .stat-box::after {
      content: ''; position: absolute; top: 0; left: 0; width: 100%; height: 2px; opacity: 0.5;
  }
  .stat-box.cyan::after { background: #2dd4bf; box-shadow: 0 0 10px #2dd4bf; }
  .stat-box.pink::after { background: #f472b6; box-shadow: 0 0 10px #f472b6; }
  .stat-box.green::after { background: #4ade80; box-shadow: 0 0 10px #4ade80; }
  .stat-box.orange::after { background: #fb923c; box-shadow: 0 0 10px #fb923c; }

  .stat-box .label { font-size: 0.55rem; font-weight: 900; color: #444; letter-spacing: 1px; }
  .stat-box .value { font-size: 1.5rem; font-weight: 900; color: #fff; font-family: monospace; }
  .stat-box.cyan .value { color: #2dd4bf; }
  .stat-box.pink .value { color: #f472b6; }
  .stat-box.green .value { color: #4ade80; }
  .stat-box.orange .value { color: #fb923c; }

  .visual-progress {
      background: #111;
      padding: 1.5rem;
      border-radius: 12px;
      border: 1px solid #222;
      display: flex;
      flex-direction: column;
      gap: 1.5rem;
  }

  .progress-track {
      height: 40px;
      background: #050505;
      border-radius: 6px;
      position: relative;
      overflow: hidden;
      border: 1px solid #222;
  }
  .progress-fill {
      height: 100%;
      transition: width 1s cubic-bezier(0.4, 0, 0.2, 1);
      position: relative;
  }
  .laser-gradient {
      background: linear-gradient(90deg, #111, #f472b6);
      box-shadow: 0 0 20px rgba(244, 114, 182, 0.3);
  }

  .scanline {
      position: absolute;
      top: 0; left: 0; width: 100%; height: 100%;
      background: linear-gradient(to bottom, transparent 50%, rgba(0,0,0,0.5) 50%);
      background-size: 100% 4px;
      pointer-events: none;
  }

  .status-legend {
      display: flex;
      justify-content: space-around;
      border-top: 1px solid #1a1a1a;
      padding-top: 1rem;
  }
  .legend-item { display: flex; align-items: center; gap: 8px; }
  .legend-item .dot { width: 8px; height: 8px; border-radius: 50%; }
  .legend-item .dot.empty { background: #444; }
  .legend-item .dot.partial { background: #fb923c; box-shadow: 0 0 10px #fb923c; }
  .legend-item .dot.full { background: #f87171; box-shadow: 0 0 10px #f87171; }
  .legend-item .count { font-weight: 900; color: #fff; font-size: 0.9rem; }
  .legend-item .text { font-size: 0.6rem; font-weight: 900; color: #666; letter-spacing: 1px; }

  .intel-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 1rem; }
  
  .intel-card {
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 1rem;
    padding: 1rem;
    background: #111;
    border-radius: 10px;
    border: 1px solid #1a1a1a;
  }
  .intel-card p { margin: 0; font-size: 0.75rem; color: #888; line-height: 1.2; font-weight: bold; }
  .icon { font-size: 1rem; }

  .laser-dot { width: 6px; height: 6px; border-radius: 50%; }
  .laser-dot.pink { background: #f472b6; box-shadow: 0 0 10px #f472b6; }
  .laser-dot.turquoise { background: #2dd4bf; box-shadow: 0 0 10px #2dd4bf; }

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
  
  .map-layout-split {
      display: flex;
      gap: 2rem;
      align-items: flex-start;
  }

  .map-frame {
    flex: 1;
    height: 70vh;
    border: 2px solid #222;
    border-radius: 16px;
    overflow: hidden;
    position: relative;
    box-shadow: 0 20px 50px rgba(0,0,0,0.5);
  }

  .details-sidebar {
      width: 400px;
      background: #0a0a0a;
      border: 1px solid #222;
      border-top: 2px solid #f472b6;
      border-radius: 16px;
      padding: 1.5rem;
      display: flex;
      flex-direction: column;
      gap: 1.5rem;
      box-shadow: -10px 0 30px rgba(0,0,0,0.5);
      animation: sidebarSlide 0.4s cubic-bezier(0.4, 0, 0.2, 1);
  }

  @keyframes sidebarSlide {
      from { transform: translateX(50px); opacity: 0; }
      to { transform: translateX(0); opacity: 1; }
  }

  .sidebar-header {
      display: flex;
      align-items: center;
      gap: 10px;
      border-bottom: 1px solid #222;
      padding-bottom: 1rem;
  }
  .sidebar-header h3 { margin: 0; font-size: 0.8rem; font-weight: 900; letter-spacing: 2px; color: #fff; flex: 1; }
  .btn-close-sidebar {
      background: none; border: none; color: #444; font-size: 1.5rem; cursor: pointer; line-height: 1;
  }
  .btn-close-sidebar:hover { color: #fff; }

  .sidebar-content {
      display: flex;
      flex-direction: column;
      gap: 2rem;
  }

  .danger-zone {
      margin-top: 1rem;
      padding-top: 2rem;
      border-top: 1px solid #222;
      display: flex;
      flex-direction: column;
      gap: 1rem;
  }
  .zone-label { font-size: 0.6rem; font-weight: 900; color: #ef4444; letter-spacing: 2px; }
  
  .btn-manage-link {
      background: #1a1a1a;
      border: 1px solid #333;
      color: #2dd4bf;
      padding: 0.75rem;
      border-radius: 8px;
      font-weight: 900;
      text-decoration: none;
      text-align: center;
      font-size: 0.8rem;
      letter-spacing: 1px;
      transition: all 0.2s;
  }
  .btn-manage-link:hover { background: #222; border-color: #2dd4bf; box-shadow: 0 0 15px rgba(45, 212, 191, 0.2); }

  .btn-vanish-big {
      background: rgba(239, 68, 68, 0.1);
      border: 1px solid #ef4444;
      color: #f87171;
      padding: 1rem;
      border-radius: 8px;
      font-weight: 900;
      cursor: pointer;
      transition: all 0.2s;
      letter-spacing: 1px;
  }
  .btn-vanish-big:hover { background: #ef4444; color: #fff; box-shadow: 0 0 20px rgba(239, 68, 68, 0.4); }

  /* Grid View */
  .grid-view { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 2rem; }
  
  .house-card-wrapper {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
  }

  .card-admin-actions {
      display: flex;
      gap: 0.5rem;
      padding: 0 0.5rem;
  }

  .btn-action-small {
      flex: 1;
      background: #1a1a1a;
      border: 1px solid #333;
      color: #888;
      padding: 6px;
      border-radius: 6px;
      font-size: 0.65rem;
      font-weight: 900;
      cursor: pointer;
      letter-spacing: 1px;
      transition: all 0.2s;
  }
  .btn-action-small:hover { border-color: #2dd4bf; color: #2dd4bf; background: rgba(45, 212, 191, 0.05); }
  .btn-action-small.vanish:hover { border-color: #f87171; color: #f87171; background: rgba(248, 113, 113, 0.05); }

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
  
  .add-house-card {
    background: transparent; border: 2px dashed #222; border-radius: 16px;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: 0.5rem; color: #444; cursor: pointer; transition: all 0.2s;
    min-height: 200px;
  }
  .add-house-card small { font-size: 0.6rem; opacity: 0.5; text-transform: uppercase; letter-spacing: 1px; }
  .add-house-card:hover { border-color: #2dd4bf; color: #2dd4bf; background: rgba(45, 212, 191, 0.05); }
  .add-house-card .plus { font-size: 3rem; font-weight: 100; }

  /* Badge Colors */
  .badge { padding: 4px 10px; border-radius: 99px; font-size: 0.7rem; font-weight: 900; text-transform: uppercase; border: 1px solid currentColor; }
  .badge.green { color: #4ade80; background: rgba(74, 222, 128, 0.1); }
  .badge.orange { color: #fb923c; background: rgba(251, 146, 60, 0.1); }
  .badge.red { color: #f87171; background: rgba(248, 113, 113, 0.1); }
  .badge.gray { color: #666; background: rgba(102, 102, 102, 0.1); }

  .laser-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
  .laser-dot.turquoise { background: #2dd4bf; box-shadow: 0 0 10px #2dd4bf; }
</style>