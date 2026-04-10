<script lang="ts">
  export let name: string;
  export let status: string = 'available';
  export let labelPosition: 'top' | 'bottom' = 'bottom';
  export let hovered: boolean = false;

  let markerEl: HTMLElement;

  $: isOccupied = status === 'full' || status === 'besetzt';
</script>

<div 
    class="marker-wrapper" 
    class:label-top={labelPosition === 'top'}
    class:is-hovered={hovered}
    bind:this={markerEl}
    style="transform: translate(-50%, -50%)"
>
  <div class="hit-area"></div>
  
  <div class="pin" class:occupied={isOccupied} class:hovered>
      <div class="pulse-ring"></div>
      <div class="laser-shine"></div>
  </div>
  <span class="label" class:hovered>{name}</span>
</div>

<style>
  .marker-wrapper {
    display: flex;
    flex-direction: column;
    align-items: center;
    position: relative;
    pointer-events: none; 
    filter: drop-shadow(0 0 10px rgba(0,0,0,0.5));
    transition: transform 0.1s ease-out;
  }

  .marker-wrapper.label-top {
      flex-direction: column-reverse;
  }
  
  .marker-wrapper.label-top .label {
      margin-top: 0;
      margin-bottom: 8px;
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
    overflow: hidden;
  }

  .pin.hovered {
    transform: scale(1.6);
    background-color: #fff;
    box-shadow: 0 0 25px #f472b6, 0 0 45px #2dd4bf, 0 0 65px #a855f7;
    border-color: #fff;
    animation: pin-color-cycle 2s infinite linear;
  }

  @keyframes pin-color-cycle {
      0% { box-shadow: 0 0 25px #f472b6, 0 0 45px #f472b6; }
      25% { box-shadow: 0 0 25px #2dd4bf, 0 0 45px #2dd4bf; }
      50% { box-shadow: 0 0 25px #fb923c, 0 0 45px #fb923c; }
      75% { box-shadow: 0 0 25px #a855f7, 0 0 45px #a855f7; }
      100% { box-shadow: 0 0 25px #f472b6, 0 0 45px #f472b6; }
  }

  .pin.occupied { background-color: #f87171; box-shadow: 0 0 15px rgba(248, 113, 113, 0.6); }
  .pin.occupied.hovered { border-color: #f87171; }

  .laser-shine {
      position: absolute;
      top: -100%; left: -100%; width: 300%; height: 300%;
      background: linear-gradient(45deg, transparent, rgba(255,255,255,0.4), transparent);
      transform: rotate(45deg);
      animation: shine 3s infinite;
  }

  @keyframes shine {
      0% { left: -100%; top: -100%; }
      20%, 100% { left: 100%; top: 100%; }
  }

  .pulse-ring {
      position: absolute;
      top: -5px; left: -5px; right: -5px; bottom: -5px;
      border: 3px solid currentColor;
      border-radius: 50%;
      opacity: 0;
      pointer-events: none;
  }

  .pin.hovered .pulse-ring {
      animation: laser-pulse 1s infinite, color-cycle 2s infinite linear;
      opacity: 1;
  }

  @keyframes laser-pulse {
      0% { transform: scale(1); opacity: 0.8; }
      100% { transform: scale(3); opacity: 0; }
  }

  @keyframes color-cycle {
      0% { color: #f472b6; }
      25% { color: #2dd4bf; }
      50% { color: #fb923c; }
      75% { color: #a855f7; }
      100% { color: #f472b6; }
  }

  .label {
    margin-top: 8px;
    background: rgba(10, 10, 10, 0.95);
    backdrop-filter: blur(8px);
    color: #888;
    padding: 4px 10px;
    border-radius: 4px;
    font-size: 0.7rem;
    font-weight: 900;
    letter-spacing: 1px;
    z-index: 3;
    white-space: nowrap;
    border: 1px solid #333;
    text-transform: uppercase;
    box-shadow: 0 4px 10px rgba(0,0,0,0.5);
    transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  }

  .label.hovered {
      background: #000;
      color: #fff;
      border: 2px solid #f472b6;
      box-shadow: 0 0 20px rgba(244, 114, 182, 0.4);
      animation: label-color-cycle 2s infinite linear;
      transform: scale(1.1);
      z-index: 10;
  }

  @keyframes label-color-cycle {
      0%, 100% { border-color: #f472b6; box-shadow: 0 0 15px rgba(244, 114, 182, 0.4); }
      25% { border-color: #2dd4bf; box-shadow: 0 0 15px rgba(45, 212, 191, 0.4); }
      50% { border-color: #fb923c; box-shadow: 0 0 15px rgba(251, 146, 60, 0.4); }
      75% { border-color: #a855f7; box-shadow: 0 0 15px rgba(168, 85, 247, 0.4); }
  }
</style>