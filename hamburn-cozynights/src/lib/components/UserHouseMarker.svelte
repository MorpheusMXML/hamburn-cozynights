<script lang="ts">
  export let name: string;
  export let status: string = 'available';

  $: isOccupied = status === 'full' || status === 'besetzt';
</script>

<div class="marker-wrapper">
  <div class="hit-area"></div>
  
  <div class="pin" class:occupied={isOccupied}></div>
  <span class="label">{name}</span>
</div>

<style>
  .marker-wrapper {
    display: flex;
    flex-direction: column;
    align-items: center;
    position: relative;
    transform: translate(-50%, -50%);
    /* Ermöglicht Hover-Effekte */
    pointer-events: none; 
  }

  .hit-area {
    position: absolute;
    width: 60px;
    height: 60px;
    border-radius: 50%;
    background: transparent;
    z-index: 1;
    /* Die Hit-Area soll Klicks empfangen, damit der Link triggert */
    pointer-events: auto; 
    cursor: pointer;
  }

  .pin {
    width: 24px;
    height: 24px;
    background-color: #22c55e;
    border: 3px solid white;
    border-radius: 50%;
    box-shadow: 0 4px 10px rgba(0,0,0,0.5);
    z-index: 2;
    transition: transform 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275);
  }

  /* Hover wird über den Link oder die hit-area ausgelöst */
  :global(.marker-link:hover) .pin {
    transform: scale(1.3);
    background-color: #4ade80;
  }

  .pin.occupied { background-color: #ef4444; }

  .label {
    margin-top: 6px;
    background: rgba(0, 0, 0, 0.85);
    color: white;
    padding: 3px 8px;
    border-radius: 4px;
    font-size: 0.75rem;
    font-weight: 700;
    z-index: 3;
    white-space: nowrap;
  }
</style>