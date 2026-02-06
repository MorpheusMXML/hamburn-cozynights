<script lang="ts">
  import UserHouseMarker from './UserHouseMarker.svelte';
  export let houses: any[] = [];
  export let isEditorMode = false;
</script>

<div class="map-wrapper">
  <svg 
    viewBox="0 0 1000 700" 
    preserveAspectRatio="xMidYMid meet"
  >
    <image href="/lageplan-brahmsee.jpg" width="1000" height="700" />
    
    {#if houses && houses.length > 0}
      <g class="marker-layer">
        {#each houses as house (house.id)}
          <foreignObject 
            x={house.x} 
            y={house.y} 
            width="1" 
            height="1" 
            style="overflow: visible;"
          >
            <a href="/house/{house.id}" class="marker-link">
              <UserHouseMarker 
                name={house.name} 
                status={house.occupiedBeds >= house.totalBeds ? 'full' : 'available'} 
              />
            </a>
          </foreignObject>
        {/each}
      </g>
    {/if}
  </svg>
</div>

<style>
  .map-wrapper {
    width: 100%;
    height: 100%;
    background: #000;
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
  
  /* Kleiner Animationstrick: Marker faden sanft ein, wenn sie geladen werden */
  .marker-layer {
    animation: fadeIn 0.3s ease-out forwards;
  }

  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }
</style>