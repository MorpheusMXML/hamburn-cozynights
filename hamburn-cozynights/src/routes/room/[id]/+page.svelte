<script lang="ts">
  import type { PageData, ActionData } from './$types';
  import { enhance } from '$app/forms';

  export let data: PageData;
  export let form: ActionData;

  // State für das ausgewählte Bett (für das Modal/Formular)
  let selectedBedId: string | null = null;
  let showModal = false;

  function selectBed(id: string) {
    selectedBedId = id;
    showModal = true;
  }

  function closeModal() {
    showModal = false;
    selectedBedId = null;
  }
</script>

<div class="container">
  <header>
    <a href="/house/{data.room.house}" class="back-link">← Zurück zum Haus</a>
    <h1>{data.room.name} <small>#{data.room.room_number}</small></h1>
  </header>

  <div class="beds-grid">
    {#each data.beds as bed}
      {#if bed.occupied}
        <div class="bed-card occupied">
           <div class="icon">🛏️</div>
           <span class="label">{bed.label}</span>
           <div class="status-box occupied">
              <span class="status-text">Occupied</span>
              <span class="guest-name">
                {bed.expand?.order?.customer_name || 'Mystery Burner'}
              </span>
           </div>
        </div>
      {:else}
        <button class="bed-card free" on:click={() => selectBed(bed.id)}>
           <div class="icon">🛏️</div>
           <span class="label">{bed.label}</span>
           <div class="status-box free">
              <span>open</span>
              <small>Book now!</small>
           </div>
        </button>
      {/if}
    {/each}
  </div>
</div>

{#if showModal}
  <div class="modal-backdrop" role="button" tabindex="0" on:click={closeModal} on:keydown={(e) => e.key === 'Escape' && closeModal()}>
    <div class="modal" role="dialog" tabindex="-1" on:click|stopPropagation on:keydown={(e) => e.key === 'Escape' && closeModal()}>
      <h2>Book Bed</h2>
      <p>Please enter your Burner name (optional) to book this bed.</p>
      
      <form method="POST" action="?/bookBed" use:enhance={() => {
          return async ({ result, update }) => {
              if (result.type === 'success') closeModal();
              await update();
          };
      }}>
        <input type="hidden" name="bedId" value={selectedBedId} />
        
        <div class="form-group">
            <label for="guestName">optional Burner Name...</label>
            <input type="text" name="guestName" id="guestName" placeholder="Max Mustermann" required />
        </div>

        <div class="actions">
            <button type="button" class="btn-cancel" on:click={closeModal}>Cancel</button>
            <button type="submit" class="btn-confirm">Confirm Selection</button>
        </div>
      </form>
    </div>
  </div>
{/if}

<style>
  :global(body) { background: #050505; color: #eee; font-family: sans-serif; }
  .container { max-width: 800px; margin: 0 auto; padding: 2rem; }
  
  header { margin-bottom: 2rem; border-bottom: 1px solid #333; padding-bottom: 1rem; }
  .back-link { color: #888; text-decoration: none; }
  h1 small { font-weight: normal; color: #666; font-size: 0.6em; }

  .beds-grid { 
      display: grid; 
      grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); 
      gap: 1.5rem; 
  }

  .bed-card {
      border-radius: 12px;
      padding: 1.5rem;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.5rem;
      border: 2px solid transparent;
      transition: all 0.2s;
      position: relative;
  }

  /* Styles für FREI */
  .bed-card.free {
      background: #1a1a1a;
      border-color: #333;
      cursor: pointer;
      color: white;
  }
  .bed-card.free:hover {
      background: #222;
      border-color: #4ade80; /* Grün */
      transform: translateY(-4px);
  }
  .status-box.free { color: #4ade80; display: flex; flex-direction: column; align-items: center; font-weight: bold; }
  .status-box.free small { font-weight: normal; font-size: 0.7rem; color: #888; }

  /* Styles für BELEGT */
  .bed-card.occupied {
      background: #150505;
      border-color: #331111;
      opacity: 0.9;
  }
  .status-box.occupied { color: #ef4444; text-align: center; }
  .guest-name { display: block; color: #888; font-size: 0.8rem; margin-top: 4px; font-style: italic; }

  .icon { font-size: 2rem; }
  .label { font-size: 1.2rem; font-weight: bold; }

  /* MODAL */
  .modal-backdrop {
      position: fixed; top: 0; left: 0; width: 100%; height: 100%;
      background: rgba(0,0,0,0.8);
      display: flex; align-items: center; justify-content: center;
      z-index: 100;
  }
  .modal {
      background: #1a1a1a;
      padding: 2rem;
      border-radius: 12px;
      border: 1px solid #333;
      width: 100%;
      max-width: 400px;
      box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5);
  }
  .modal h2 { margin-top: 0; color: white; }
  .form-group { margin: 1.5rem 0; }
  .form-group label { display: block; margin-bottom: 0.5rem; color: #aaa; font-size: 0.9rem; }
  .form-group input {
      width: 100%; padding: 0.75rem; background: #0a0a0a; border: 1px solid #333;
      color: white; border-radius: 6px; box-sizing: border-box;
  }
  .form-group input:focus { outline: none; border-color: #4ade80; }

  .actions { display: flex; gap: 1rem; justify-content: flex-end; }
  button { padding: 0.75rem 1rem; border-radius: 6px; cursor: pointer; border: none; font-weight: bold; }
  .btn-cancel { background: transparent; color: #aaa; }
  .btn-cancel:hover { color: white; }
  .btn-confirm { background: #4ade80; color: #000; }
  .btn-confirm:hover { background: #22c55e; }
</style>