<script lang="ts">
  import UserHouseMarker from './UserHouseMarker.svelte';
  import { createEventDispatcher } from 'svelte';
  
  export let houses: any[] = [];
  export let isEditorMode = false;
  export let isBookingActive = false;

  const dispatch = createEventDispatcher();

  // Drag & Drop State
  let draggingHouseId: string | null = null;
  let dragOffset = { x: 0, y: 0 };
  let hasDragged = false;

  // Context Menu State
  let selectedHouseId: string | null = null;

  // Staging Warning State
  let showStagingWarning = false;
  let warningTimeout: any;

  function handleMouseDown(event: MouseEvent, house: any) {
    if (!isEditorMode || isBookingActive) return;
    
    draggingHouseId = house.id;
    hasDragged = false;
    
    const svg = (event.currentTarget as SVGElement).closest('svg');
    if (!svg) return;
    
    const CTM = svg.getScreenCTM();
    if (!CTM) return;
    
    // Get mouse position relative to SVG coordinates
    const mouseX = (event.clientX - CTM.e) / CTM.a;
    const mouseY = (event.clientY - CTM.f) / CTM.d;
    
    dragOffset = {
      x: mouseX - house.x,
      y: mouseY - house.y
    };
    
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }

  function handleMouseMove(event: MouseEvent) {
    if (!draggingHouseId) return;
    hasDragged = true;
    
    const svg = document.querySelector('.map-wrapper svg') as SVGSVGElement;
    const CTM = svg.getScreenCTM();
    if (!CTM) return;
    
    const mouseX = (event.clientX - CTM.e) / CTM.a;
    const mouseY = (event.clientY - CTM.f) / CTM.d;
    
    const newX = Math.round(mouseX - dragOffset.x);
    const newY = Math.round(mouseY - dragOffset.y);
    
    // Local update for immediate feedback
    const index = houses.findIndex(h => h.id === draggingHouseId);
    if (index !== -1) {
      houses[index].x = newX;
      houses[index].y = newY;
      houses = [...houses];
    }
  }

  function handleMouseUp() {
    if (draggingHouseId) {
      const house = houses.find(h => h.id === draggingHouseId);
      if (house && hasDragged) {
        dispatch('houseMoved', { id: house.id, x: house.x, y: house.y });
      }
      draggingHouseId = null;
    }
    window.removeEventListener('mousemove', handleMouseMove);
    window.removeEventListener('mouseup', handleMouseUp);
  }

  function handleHouseClick(event: MouseEvent, house: any) {
    if (isEditorMode) {
      if (hasDragged) return; // Prevent menu opening after drag
      
      event.preventDefault();
      event.stopPropagation();
      
      if (selectedHouseId === house.id) {
        selectedHouseId = null;
      } else {
        selectedHouseId = house.id;
      }
      return;
    }

    // Client-side navigation or Staging Mode warning
    if (!isBookingActive) {
      event.preventDefault();
      event.stopPropagation();
      
      showStagingWarning = true;
      clearTimeout(warningTimeout);
      warningTimeout = setTimeout(() => {
        showStagingWarning = false;
      }, 4000);
    }
  }

  function handleMapClick(event: MouseEvent) {
    if (selectedHouseId) {
      selectedHouseId = null;
      return;
    }
    
    if (!isEditorMode) return;
    
    const svg = event.currentTarget as SVGSVGElement;
    const CTM = svg.getScreenCTM();
    if (!CTM) return;
    
    const x = Math.round((event.clientX - CTM.e) / CTM.a);
    const y = Math.round((event.clientY - CTM.f) / CTM.d);
    
    dispatch('locationSelected', { x, y });
  }
</script>

<div class="map-wrapper">
  <!-- svelte-ignore a11y-click-events-have-key-events -->
  <!-- svelte-ignore a11y-no-static-element-interactions -->
  <svg 
    viewBox="0 0 1000 700" 
    preserveAspectRatio="xMidYMid meet"
    on:click={handleMapClick}
  >
    <image href="/lageplan-brahmsee.jpg" width="1000" height="700" />
    
    {#if houses && houses.length > 0}
      <g class="marker-layer">
        {#each houses as house (house.id)}
          <!-- svelte-ignore a11y-click-events-have-key-events -->
          <!-- svelte-ignore a11y-no-static-element-interactions -->
          <g 
            class="house-group" 
            class:dragging={draggingHouseId === house.id}
            class:selected={selectedHouseId === house.id}
            class:lock-drag={isBookingActive}
            on:mousedown={(e) => handleMouseDown(e, house)}
            on:click={(e) => handleHouseClick(e, house)}
          >
            <foreignObject 
              x={house.x} 
              y={house.y} 
              width="1" 
              height="1" 
              style="overflow: visible;"
            >
              {#if !isEditorMode}
                <a href="/house/{house.id}" class="marker-link" on:click={(e) => handleHouseClick(e, house)}>
                  <UserHouseMarker 
                    name={house.name} 
                    status={house.occupiedBeds >= house.totalBeds ? 'full' : 'available'} 
                  />
                </a>
              {:else}
                <div class="admin-marker-wrapper">
                  <UserHouseMarker 
                    name={house.name} 
                    status={house.occupiedBeds >= house.totalBeds ? 'full' : 'available'} 
                  />
                  
                  {#if selectedHouseId === house.id}
                    <div class="admin-menu" on:click|stopPropagation>
                      <button class="menu-item" on:click={() => dispatch('renameHouse', house)}>✏️ Rename</button>
                      <a href="/admin/house/{house.id}" class="menu-item">⚙️ Manage</a>
                      <button class="menu-item delete" on:click={() => dispatch('deleteHouse', house)}>🗑 Delete</button>
                    </div>
                  {/if}
                </div>
              {/if}
            </foreignObject>
          </g>
        {/each}
      </g>
    {/if}
  </svg>

  {#if showStagingWarning}
    <div class="staging-warning">
      <div class="warning-content">
        <p class="warning-title">PATIENCE, BURNER! 🏜️</p>
        <p>This house is currently being calibrated in <strong>Staging Mode</strong>.</p>
        <p>Ignition starts when the timer hits zero.</p>
        <div class="laser-line"></div>
      </div>
    </div>
  {/if}
</div>

<style>
  .map-wrapper {
    width: 100%;
    height: 100%;
    background: #000;
    position: relative;
    overflow: hidden;
  }
  svg {
    width: 100%;
    height: 100%;
    display: block;
  }
  .marker-link {
    text-decoration: none;
    cursor: pointer;
    pointer-events: auto;
  }
  
  .house-group {
    cursor: grab;
    pointer-events: auto;
  }
  .house-group.dragging { cursor: grabbing; }
  .house-group.lock-drag { cursor: pointer; }
  
  .admin-marker-wrapper {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
  }

  .admin-menu {
    position: absolute;
    top: 100%;
    margin-top: 10px;
    background: #1a1a1a;
    border: 1px solid #444;
    border-radius: 8px;
    padding: 5px;
    display: flex;
    flex-direction: column;
    gap: 2px;
    z-index: 1000;
    box-shadow: 0 4px 15px rgba(0,0,0,0.5);
    min-width: 120px;
  }

  .menu-item {
    background: transparent;
    border: none;
    color: #eee;
    padding: 8px 12px;
    text-align: left;
    font-size: 0.85rem;
    cursor: pointer;
    border-radius: 4px;
    text-decoration: none;
    display: block;
  }
  .menu-item:hover { background: #333; }
  .menu-item.delete { color: #f87171; }
  .menu-item.delete:hover { background: #422; }

  /* Kleiner Animationstrick: Marker faden sanft ein, wenn sie geladen werden */
  .marker-layer {
    animation: fadeIn 0.3s ease-out forwards;
  }

  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  .staging-warning {
    position: absolute;
    bottom: 40px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 2000;
    pointer-events: none;
    animation: slideUp 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);
  }

  .warning-content {
    background: #111;
    border: 1px solid #f472b6;
    padding: 1.5rem 2rem;
    border-radius: 16px;
    color: #eee;
    text-align: center;
    box-shadow: 0 0 30px rgba(244, 114, 182, 0.4);
    min-width: 300px;
    position: relative;
  }

  .warning-title {
    color: #f472b6;
    font-weight: 900;
    font-size: 1.2rem;
    margin-bottom: 0.5rem;
    letter-spacing: 1px;
  }

  .warning-content p {
    margin: 0.2rem 0;
    font-size: 0.9rem;
  }

  .laser-line {
    position: absolute;
    bottom: 0;
    left: 10%;
    right: 10%;
    height: 2px;
    background: #f472b6;
    box-shadow: 0 0 10px #f472b6;
    animation: laserPulse 1s infinite;
  }

  @keyframes slideUp {
    from { transform: translate(-50%, 100px); opacity: 0; }
    to { transform: translate(-50%, 0); opacity: 1; }
  }

  @keyframes laserPulse {
    0%, 100% { opacity: 1; transform: scaleX(1); }
    50% { opacity: 0.5; transform: scaleX(0.8); }
  }
</style>