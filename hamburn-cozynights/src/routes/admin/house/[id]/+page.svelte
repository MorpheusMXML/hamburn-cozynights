<script lang="ts">
  import type { PageData } from './$types';
  import AddRoomForm from '$lib/components/admin/AddRoomForm.svelte';
  import { fade, fly } from 'svelte/transition';
  import { invalidateAll } from '$app/navigation';
  import { enhance } from '$app/forms';

  export let data: PageData;
  // isVerified comes from the layout
  $: ({ house, rooms, isVerified, isBookingActive } = data);

  function handleAction(roomId: string) {
      if (isBookingActive) {
          alert("🔒 LOCKDOWN ACTIVE: Configuration is locked during Live Booking.");
          return;
      }
      return async ({ result, update }: { result: any, update: any }) => {
          if (result.type === 'success') {
              const card = document.querySelector(`.room-card:has([value="${roomId}"])`);
              if (card) card.classList.add('disintegrating');
              await new Promise(r => setTimeout(r, 550));
          }
          await update();
          await invalidateAll();
      };
  }
</script>

<div class="dashboard-container">
  <div class="header-row" in:fly={{ y: -20, duration: 500 }}>
    <nav class="breadcrumbs">
        <a href="/admin">Control Center</a> <span class="sep">/</span> <span class="current">{house.name}</span>
    </nav>
    <h1>
        <span class="house-icon">🛖</span> 
        {house.name} 
        <span class="subtitle">SANCTUARY OVERSIGHT</span>
    </h1>
  </div>

  {#if isVerified}
      <section class="form-section" in:fade={{ delay: 200 }} class:disabled={isBookingActive}>
          <header class="section-header">
              <span class="laser-dot turquoise"></span>
              <h3>ADD ROOM ➕</h3>
          </header>
          {#if isBookingActive}
            <div class="lockdown-notice">🔒 MANAGEMENT LOCKED DURING LIVE BOOKING</div>
          {/if}
          <div class="form-wrapper">
              <AddRoomForm houseId={house.id} disabled={isBookingActive} />
          </div>
      </section>
  {/if}

  <header class="section-title-row">
      <span class="laser-dot pink"></span>
      <h2 class="section-title">ACTIVE ROOMS 🚪</h2>
  </header>
  
  <div class="grid">
    {#each rooms as room, i (room.id)}
      <a href="/admin/room/{room.id}" class="room-card" in:fly={{ y: 20, duration: 400, delay: i * 50 }}>
        <div class="card-edge pink"></div>
        
        <header class="card-header">
          <span class="room-number">#{room.room_number}</span>
          <span class="room-name">{room.name} 🚪</span>
        </header>

        <div class="card-body">
            <div class="progress-container">
                <div class="progress-track">
                    <div 
                        class="progress-fill" 
                        style="width: {(room.stats.occupied / (room.stats.total || 1)) * 100}%"
                        class:full={room.stats.occupied === room.stats.total && room.stats.total > 0}
                    ></div>
                </div>
                <div class="stat-info">
                    <span class="label">SPOTS CLAIMED 📊</span>
                    <span class="value">{room.stats.occupied} / {room.stats.total}</span>
                </div>
            </div>
        </div>
        
        {#if isVerified}
            <footer class="card-actions">
                <div on:click|stopPropagation on:keydown|stopPropagation={(e) => e.key === 'Enter' && e.stopPropagation()} role="presentation">
                    <form action="?/deleteRoom" method="POST" use:enhance={() => handleAction(room.id)}>
                        <input type="hidden" name="id" value={room.id} />
                        <button type="submit" class="btn-vanish" title="Vanish Room" class:disabled={isBookingActive} disabled={isBookingActive}>
                            VANISH ROOM 🌪️
                        </button>
                    </form>
                </div>
            </footer>
        {/if}
      </a>
    {/each}
  </div>
</div>

<style>
  .dashboard-container { max-width: 1200px; margin: 0 auto; padding: 1rem 0; }

  /* Header & Breadcrumbs */
  .header-row { margin-bottom: 3rem; border-bottom: 1px solid #222; padding-bottom: 1.5rem; position: relative; }
  .breadcrumbs { font-size: 0.75rem; font-weight: 900; letter-spacing: 1px; color: #666; text-transform: uppercase; margin-bottom: 1rem; }
  .breadcrumbs a { color: #2dd4bf; text-decoration: none; transition: color 0.2s; }
  .breadcrumbs a:hover { color: #fff; text-shadow: 0 0 10px rgba(45, 212, 191, 0.5); }
  .breadcrumbs .current { color: #f472b6; }
  .sep { margin: 0 0.5rem; color: #333; }
  
  h1 { font-size: 2.5rem; margin: 0; color: #fff; font-weight: 900; letter-spacing: -1px; display: flex; align-items: center; gap: 1rem; }
  .house-icon { filter: drop-shadow(0 0 10px rgba(255,255,255,0.2)); }
  .subtitle { color: #444; font-size: 0.8rem; font-weight: 900; margin-left: auto; letter-spacing: 2px; }

  /* Section Headers */
  .section-title-row, .section-header { display: flex; align-items: center; gap: 10px; margin-bottom: 1.5rem; }
  .laser-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
  .laser-dot.turquoise { background: #2dd4bf; box-shadow: 0 0 10px #2dd4bf; }
  .laser-dot.pink { background: #f472b6; box-shadow: 0 0 10px #f472b6; }

  .section-title { margin: 0; font-size: 1rem; color: #fff; font-weight: 900; letter-spacing: 2px; }

  /* Form Section */
  .form-section { 
      background: #0f0f0f; 
      border: 1px solid #222; 
      padding: 2rem; 
      border-radius: 12px; 
      margin-bottom: 4rem;
      border-top: 2px solid #2dd4bf;
      box-shadow: 0 10px 30px rgba(0,0,0,0.3);
      position: relative;
  }
  .form-section.disabled { opacity: 0.4; filter: grayscale(1); pointer-events: none; }
  .lockdown-notice { 
      position: absolute; top: 1.5rem; right: 2rem; 
      color: #fb923c; font-size: 0.65rem; font-weight: 900; letter-spacing: 1px;
  }
  .form-section h3 { margin: 0; color: #eee; font-size: 0.9rem; font-weight: 900; letter-spacing: 1px; }

  /* Grid Layout */
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 2rem; }

  /* Room Card */
  .room-card {
    background: #111; 
    border: 1px solid #222; 
    border-radius: 12px; 
    padding: 1.5rem;
    text-decoration: none; 
    color: inherit; 
    display: flex; 
    flex-direction: column; 
    gap: 1.5rem;
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1); 
    position: relative;
    overflow: hidden;
  }
  .room-card:hover { transform: translateY(-5px); border-color: #f472b6; box-shadow: 0 10px 30px rgba(244, 114, 182, 0.1); }
  
  .card-edge { position: absolute; top: 0; left: 0; width: 4px; height: 100%; }
  .card-edge.pink { background: #f472b6; }

  .card-header { display: flex; justify-content: space-between; align-items: center; }
  .room-number { background: #222; color: #f472b6; padding: 4px 10px; border-radius: 6px; font-weight: 900; font-size: 0.8rem; border: 1px solid #333; }
  .room-name { font-weight: bold; font-size: 1.25rem; color: #fff; }

  /* Stats & Progress */
  .progress-container { display: flex; flex-direction: column; gap: 0.75rem; }
  .progress-track { height: 6px; background: #000; border-radius: 3px; overflow: hidden; border: 1px solid #222; }
  .progress-fill { height: 100%; background: #2dd4bf; transition: width 1s ease-out; box-shadow: 0 0 10px rgba(45, 212, 191, 0.5); }
  .progress-fill.full { background: #ef4444; box-shadow: 0 0 10px rgba(239, 68, 68, 0.5); }
  
  .stat-info { display: flex; justify-content: space-between; align-items: center; }
  .label { font-size: 0.65rem; font-weight: 900; color: #444; letter-spacing: 1px; }
  .value { font-size: 0.85rem; color: #eee; font-weight: bold; }

  /* Actions */
  .card-actions { margin-top: auto; padding-top: 1.5rem; border-top: 1px solid #222; display: flex; justify-content: flex-end; }
  .btn-vanish { 
      background: transparent; border: 1px solid #444; color: #666; 
      cursor: pointer; font-size: 0.7rem; font-weight: 900; letter-spacing: 1px;
      padding: 0.5rem 1rem; border-radius: 6px; transition: all 0.2s; 
  }
  .btn-vanish:hover { color: #f87171; border-color: #f87171; background: rgba(248, 113, 113, 0.05); }
  .btn-vanish.disabled { opacity: 0.3; cursor: not-allowed; }
</style>