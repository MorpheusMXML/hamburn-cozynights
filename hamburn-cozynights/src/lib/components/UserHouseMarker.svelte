<script lang="ts">
  import { onMount } from 'svelte';

  export let name: string;
  export let status: string = 'available';

  let markerEl: HTMLElement;
  let offsetX = 0;
  let offsetY = 0;

  $: isOccupied = status === 'full' || status === 'besetzt';

  onMount(() => {
      const handleMouseMove = (e: MouseEvent) => {
          if (!markerEl) return;
          const rect = markerEl.getBoundingClientRect();
          const centerX = rect.left + rect.width / 2;
          const centerY = rect.top + rect.height / 2;
          
          // Calculate distance from center
          const distX = e.clientX - centerX;
          const distY = e.clientY - centerY;
          
          // Parallax effect: shift slightly based on proximity (max 5px)
          const limit = 300; // Activation radius
          const strength = 10;
          
          const mag = Math.sqrt(distX*distX + distY*distY);
          if (mag < limit) {
              const ratio = (1 - mag / limit) * strength;
              offsetX = (distX / mag) * ratio;
              offsetY = (distY / mag) * ratio;
          } else {
              offsetX = 0;
              offsetY = 0;
          }
      };

      window.addEventListener('mousemove', handleMouseMove);
      return () => window.removeEventListener('mousemove', handleMouseMove);
  });
</script>

<div 
    class="marker-wrapper" 
    bind:this={markerEl}
    style="transform: translate(calc(-50% + {offsetX}px), calc(-50% + {offsetY}px))"
>
  <div class="hit-area"></div>
  
  <div class="pin" class:occupied={isOccupied}>
      <div class="pulse-ring"></div>
      <div class="laser-shine"></div>
  </div>
  <span class="label">{name}</span>
</div>

<style>
  .marker-wrapper {
    display: flex;
    flex-direction: column;
    align-items: center;
    position: relative;
    pointer-events: none; 
    transition: transform 0.1s ease-out;
    filter: drop-shadow(0 0 10px rgba(0,0,0,0.5));
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
    transition: all 0.2s;
  }

  :global(.marker-link:hover) .label {
      background: #2dd4bf;
      color: #000;
      border-color: #fff;
      transform: translateY(2px);
  }
</style>