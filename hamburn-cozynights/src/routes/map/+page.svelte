<script lang="ts">
  import type { PageData } from './$types';
  import Map from '$lib/components/Map.svelte';
  import CountdownTimer from '$lib/components/CountdownTimer.svelte';
  import { onMount } from 'svelte';
  import { invalidateAll } from '$app/navigation';

  export let data: PageData;
  $: ({ houses, isBookingActive, bookingUnlockAt } = data);

  onMount(() => {
    // Force a fresh fetch when entering the page
    invalidateAll();
  });

  let clickCount = 0;
  let lastClickTime = 0;
  let isShaking = false;
  let shakeTimeout: any;

  function handleReloadSensors() {
    const now = Date.now();
    if (now - lastClickTime < 300) {
      clickCount++;
    } else {
      clickCount = 1;
    }
    lastClickTime = now;

    if (clickCount > 3) {
      isShaking = true;
      clearTimeout(shakeTimeout);
      shakeTimeout = setTimeout(() => {
        isShaking = false;
      }, 500);
    }

    invalidateAll();
  }
</script>

<div class="page-container">
  <div class="header-overlay">
    <div class="logo-box">
      <span class="logo">Hamburn</span>
      <span class="tagline">Interactive Map</span>
    </div>
    
    {#if isBookingActive}
      <div class="header-actions">
        <a href="/random-bed" class="random-btn">
          <span class="icon">🎰</span>
          LUCK OF THE PLAYA
        </a>
        <div class="phase-badge live">🎪 LIVE BOOKING</div>
      </div>
    {:else}
      <div class="phase-badge staging">🛠 STAGING MODE</div>
    {/if}
    <div class="debug-counter" style="color: white; font-size: 0.6rem; opacity: 0.5; margin-left: 1rem;">
      SENSORS: {houses?.length || 0}
    </div>
  </div>

  {#if data.houses}
    <div class="map-container">
      <Map houses={data.houses} isEditorMode={false} isBookingActive={data.isBookingActive} />
    </div>
  {:else}
    <div class="loading">Igniting Sensors...</div>
  {/if}

  {#if !isBookingActive}
    <div class="staging-overlay">
      <div class="staging-center-content">
        {#if bookingUnlockAt}
          <div class="timer-wrapper">
            <h2 class="laser-text pink">IGNITION IN</h2>
            <CountdownTimer targetDate={bookingUnlockAt} />
          </div>
        {/if}
        
        <button 
          class="reload-button" 
          class:smashed={isShaking}
          on:click={handleReloadSensors}
        >
          <span class="icon">📡</span>
          RELOAD SENSORS
          {#if clickCount > 5}
             <span class="warning-text">CALIBRATING INTENSELY!</span>
          {/if}
        </button>
      </div>
    </div>
  {/if}
</div>

<style>
  .page-container {
    width: 100vw;
    height: 100vh;
    min-height: 100vh;
    background: #050505;
    overflow: hidden;
    position: relative;
    font-family: 'Inter', system-ui, sans-serif;
  }

  .header-overlay {
    position: absolute;
    top: 20px;
    left: 20px;
    right: 20px;
    z-index: 100;
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    pointer-events: none;
  }

  .header-actions {
    display: flex;
    align-items: center;
    gap: 1rem;
    pointer-events: auto;
  }

  .random-btn {
    background: #111;
    color: #f472b6;
    text-decoration: none;
    padding: 0.5rem 1rem;
    border-radius: 8px;
    font-weight: 900;
    font-size: 0.7rem;
    letter-spacing: 1px;
    border: 1px solid #f472b633;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    transition: all 0.2s;
    box-shadow: 0 0 15px rgba(244, 114, 182, 0.1);
  }

  .random-btn:hover {
    background: #f472b6;
    color: #000;
    box-shadow: 0 0 20px rgba(244, 114, 182, 0.4);
    transform: translateY(-2px);
  }

  .logo-box {
    background: rgba(10, 10, 10, 0.9);
    padding: 1rem 1.5rem;
    border-radius: 12px;
    border: 1px solid #333;
    display: flex;
    flex-direction: column;
    pointer-events: auto;
    backdrop-filter: blur(10px);
    box-shadow: 0 0 20px rgba(0, 0, 0, 0.5);
  }

  .logo {
    font-size: 1.5rem;
    font-weight: 900;
    letter-spacing: -1px;
    background: linear-gradient(to right, #2dd4bf, #f472b6);
    background-clip: text;
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    text-transform: uppercase;
  }

  .tagline {
    font-size: 0.6rem;
    font-weight: 900;
    color: #666;
    letter-spacing: 2px;
    text-transform: uppercase;
  }

  .phase-badge {
    background: #111;
    color: #666;
    padding: 0.5rem 1rem;
    border-radius: 8px;
    font-weight: 900;
    font-size: 0.7rem;
    letter-spacing: 1px;
    border: 1px solid #222;
    pointer-events: auto;
    backdrop-filter: blur(10px);
  }

  .phase-badge.live {
    color: #f472b6;
    border-color: #f472b633;
    box-shadow: 0 0 15px rgba(244, 114, 182, 0.2);
  }

  .phase-badge.staging {
    color: #2dd4bf;
    border-color: #2dd4bf33;
    box-shadow: 0 0 15px rgba(45, 212, 191, 0.2);
  }

  .map-container {
    width: 100%;
    height: 100%;
    transition: filter 0.5s ease;
  }

  .staging-overlay {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    z-index: 50;
    display: flex;
    justify-content: center;
    align-items: center;
    pointer-events: none;
  }

  .staging-center-content {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2rem;
    pointer-events: auto;
    background: rgba(0, 0, 0, 0.4);
    padding: 3rem;
    border-radius: 24px;
    backdrop-filter: blur(2px);
  }

  .timer-wrapper {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
  }

  .laser-text {
    font-weight: 900;
    letter-spacing: 4px;
    text-shadow: 0 0 10px currentColor;
    margin: 0;
    font-size: 1rem;
  }

  .laser-text.pink { color: #f472b6; }

  .reload-button {
    background: #111;
    border: 2px solid #2dd4bf;
    color: #2dd4bf;
    padding: 1rem 2rem;
    font-weight: 900;
    letter-spacing: 2px;
    border-radius: 12px;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 1rem;
    transition: all 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275);
    box-shadow: 0 0 20px rgba(45, 212, 191, 0.3);
    position: relative;
    overflow: hidden;
  }

  .reload-button:hover {
    background: #2dd4bf;
    color: #111;
    transform: scale(1.05);
    box-shadow: 0 0 30px rgba(45, 212, 191, 0.6);
  }

  .reload-button:active {
    transform: scale(0.95);
  }

  .reload-button.smashed {
    animation: shake 0.1s infinite;
    border-color: #f472b6;
    color: #f472b6;
    box-shadow: 0 0 40px rgba(244, 114, 182, 0.8);
  }

  .warning-text {
    position: absolute;
    bottom: -20px;
    left: 50%;
    transform: translateX(-50%);
    font-size: 0.6rem;
    white-space: nowrap;
    color: #f472b6;
    animation: pulse 0.5s infinite;
  }

  @keyframes shake {
    0% { transform: translate(2px, 2px) rotate(0deg); }
    25% { transform: translate(-2px, -2px) rotate(1deg); }
    50% { transform: translate(2px, -2px) rotate(-1deg); }
    75% { transform: translate(-2px, 2px) rotate(0deg); }
    100% { transform: translate(2px, 2px) rotate(0deg); }
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
  }

  .loading {
    color: #2dd4bf;
    font-weight: 900;
    letter-spacing: 2px;
    text-transform: uppercase;
    display: flex;
    justify-content: center;
    align-items: center;
    height: 100%;
    text-shadow: 0 0 10px rgba(45, 212, 191, 0.5);
  }
</style>