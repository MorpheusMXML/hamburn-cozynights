<script lang="ts">
  import type { PageData } from './$types';
  export let data: PageData;
</script>

<div class="container">
  <header>
    <a href="/map" class="back-link">← Karte</a>
    <h1>{data.house.name}</h1>
    <p class="subtitle">Wähle ein Zimmer für deine Übernachtung</p>
  </header>

  <div class="grid">
    {#each data.rooms as room}
      <a href="/room/{room.id}" class="card" class:full={room.freeCount === 0}>
        <div class="card-header">
          <h2>{room.name || 'Zimmer'} #{room.room_number}</h2>
          <span class="badge" class:green={room.freeCount > 0}>
             {room.freeCount > 0 ? `${room.freeCount} frei` : 'Voll'}
          </span>
        </div>
        <div class="progress-bar">
           <div class="fill" style="width: {((room.totalCount - room.freeCount) / (room.totalCount || 1)) * 100}%"></div>
        </div>
      </a>
    {/each}
  </div>
</div>

<style>
  /* Dunkles Theme */
  :global(body) { background: #050505; color: #eee; font-family: sans-serif; margin: 0; }
  .container { max-width: 800px; margin: 0 auto; padding: 2rem; }
  
  header { margin-bottom: 2rem; border-bottom: 1px solid #333; padding-bottom: 1rem; }
  .back-link { color: #888; text-decoration: none; display: block; margin-bottom: 0.5rem; }
  h1 { margin: 0; font-size: 2rem; }
  .subtitle { color: #666; margin: 0; }

  .grid { display: grid; gap: 1rem; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); }

  .card {
    background: #1a1a1a; border: 1px solid #333; border-radius: 8px; padding: 1.5rem;
    text-decoration: none; color: white; display: block; transition: all 0.2s;
  }
  .card:hover { border-color: #555; background: #222; transform: translateY(-2px); }
  .card.full { opacity: 0.6; pointer-events: none; } /* Optional: Voll nicht klickbar machen */

  .card-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; }
  .badge { background: #333; padding: 4px 8px; border-radius: 4px; font-size: 0.8rem; }
  .badge.green { color: #4ade80; background: rgba(74, 222, 128, 0.1); }

  .progress-bar { height: 4px; background: #333; border-radius: 2px; overflow: hidden; }
  .fill { height: 100%; background: #4ade80; }
  .full .fill { background: #ef4444; }
</style>