<script lang="ts">
  export let name: string;
  export let status: string = 'available';

  $: isOccupied = status === 'full' || status === 'besetzt';
</script>

<div class="marker-wrapper">
  <div class="hit-area"></div>
  
  <div class="pin" class:occupied={isOccupied}>
      <div class="pulse-ring"></div>
  </div>
  <span class="label">{name}</span>
</div>

<style>
  .marker-wrapper {
    display: flex;
    flex-direction: column;
    align-items: center;
    position: relative;
    transform: translate(-50%, -50%);
    pointer-events: none; 
  }

  .hit-area {
    position: absolute;
    width: 60px;
    height: 60px;
    border-radius: 50%;
    background: transparent;
    z-index: 1;
    pointer-events: auto; 
    cursor: pointer;
  }

  .pin {
    width: 20px;
    height: 20px;
    background-color: #2dd4bf;
    border: 3px solid white;
    border-radius: 50%;
    box-shadow: 0 0 15px rgba(45, 212, 191, 0.6);
    z-index: 2;
    transition: all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
    position: relative;
  }

  .pulse-ring {
      position: absolute;
      top: -5px; left: -5px; right: -5px; bottom: -5px;
      border: 2px solid currentColor;
      border-radius: 50%;
      opacity: 0;
      pointer-events: none;
  }

  :global(.marker-link:hover) .pin {
    transform: scale(1.4);
    background-color: #fff;
    box-shadow: 0 0 25px #2dd4bf;
  }
  
  :global(.marker-link:hover) .pulse-ring {
      animation: laser-pulse 1.5s infinite;
      color: #2dd4bf;
  }

  .pin.occupied { background-color: #f87171; box-shadow: 0 0 15px rgba(248, 113, 113, 0.6); }
  :global(.marker-link:hover) .pin.occupied { box-shadow: 0 0 25px #f87171; }
  :global(.marker-link:hover) .pin.occupied .pulse-ring { color: #f87171; }

  @keyframes laser-pulse {
      0% { transform: scale(1); opacity: 0.8; }
      100% { transform: scale(2); opacity: 0; }
  }

  .label {
    margin-top: 8px;
    background: rgba(15, 15, 15, 0.9);
    backdrop-filter: blur(4px);
    color: white;
    padding: 4px 10px;
    border-radius: 6px;
    font-size: 0.7rem;
    font-weight: 900;
    letter-spacing: 1px;
    z-index: 3;
    white-space: nowrap;
    border: 1px solid #333;
    text-transform: uppercase;
    box-shadow: 0 4px 10px rgba(0,0,0,0.5);
  }
</style>