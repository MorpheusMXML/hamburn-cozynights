<script lang="ts">
  import type { PageData, ActionData } from './$types';
  import { enhance } from '$app/forms';

  export let data: PageData;
  export let form: ActionData;

  let selectedBedId: string | null = null;
  let showModal = false;
  let currentNameInput = "";

  // Helper to open the modal for a specific bed
  function openBookingModal(bedId: string, name = "") {
    selectedBedId = bedId;
    currentNameInput = name;
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
      {@const isMyBed = bed.id === data.userBedId}
      {@const someoneElseBooked = bed.occupied && !isMyBed}
      {@const iHaveAnotherBooking = !!data.userBedId && !isMyBed}
      
      {#if someoneElseBooked}
        <div class="bed-card occupied">
           <div class="icon">🛏️</div>
           <span class="label">{bed.label}</span>
           <div class="status-box occupied">
              <span class="status-text">Occupied</span>
              <span class="guest-name">{bed.expand?.order?.customer_name || 'Mystery Burner'}</span>
           </div>
        </div>
      {:else if isMyBed}
        <button class="bed-card mine" on:click={() => openBookingModal(bed.id, bed.expand?.order?.customer_name)}>
           <div class="icon">🛏️</div>
           <span class="label">{bed.label}</span>
           <div class="status-box my-status">
              <span class="status-text">Your Bed</span>
              <span class="guest-name">{bed.expand?.order?.customer_name}</span>
           </div>
           <small class="edit-hint">Click to edit/unbook</small>
        </button>
      {:else}
        <button 
          class="bed-card free {iHaveAnotherBooking ? 'disabled' : ''}" 
          on:click={() => !iHaveAnotherBooking && openBookingModal(bed.id)}
          disabled={iHaveAnotherBooking}
        >
           <div class="icon">🛏️</div>
           <span class="label">{bed.label}</span>
           <div class="status-box free">
              <span>{iHaveAnotherBooking ? 'Locked' : 'Open'}</span>
              <small>{iHaveAnotherBooking ? 'Unbook yours first' : 'Book now!'}</small>
           </div>
        </button>
      {/if}
    {/each}
  </div>
</div>

{#if showModal}
  <div class="modal-backdrop" on:click={closeModal}>
    <div class="modal" on:click|stopPropagation>
      <h2>{selectedBedId === data.userBedId ? 'Edit Booking' : 'Book Bed'}</h2>
      <p>Enter your Burner name or leave blank for a random one.</p>
      
      <form method="POST" action="?/bookBed" use:enhance={() => {
          return async ({ result, update }) => {
              if (result.type === 'success') closeModal();
              await update(); 
          };
      }}>
        <input type="hidden" name="bedId" value={selectedBedId} />
        
        <div class="form-group">
            <label for="guestName">Burner Name (optional)</label>
            <input type="text" name="guestName" id="guestName" bind:value={currentNameInput} placeholder="Leave empty for random name" />
        </div>

        <div class="actions">
            {#if selectedBedId === data.userBedId}
                <button type="submit" formaction="?/unbookBed" class="btn-unbook">Unbook Bed</button>
            {/if}
            <button type="button" class="btn-cancel" on:click={closeModal}>Cancel</button>
            <button type="submit" class="btn-confirm">Confirm</button>
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
  .beds-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 1.5rem; }

  .bed-card {
      border-radius: 12px; padding: 1.5rem; display: flex; flex-direction: column; align-items: center;
      gap: 0.5rem; border: 2px solid transparent; transition: all 0.2s; background: #1a1a1a; cursor: pointer; color: white;
  }

  /* FREE BED STYLES */
  .bed-card.free:hover:not(.disabled) { border-color: #4ade80; transform: translateY(-4px); }
  .status-box.free { color: #4ade80; font-weight: bold; text-align: center; }
  .bed-card.free.disabled { opacity: 0.3; cursor: not-allowed; filter: grayscale(1); }

  /* OCCUPIED BY OTHERS */
  .bed-card.occupied { background: #150505; border-color: #331111; cursor: default; opacity: 0.8; }
  .status-box.occupied { color: #ef4444; text-align: center; }
  .guest-name { display: block; color: #888; font-size: 0.8rem; margin-top: 4px; font-style: italic; }

  /* OWN BED STYLES */
  .bed-card.mine { border-color: #3b82f6; background: #0a1020; box-shadow: 0 0 15px rgba(59, 130, 246, 0.2); }
  .bed-card.mine:hover { transform: translateY(-4px); border-color: #60a5fa; }
  .my-status { color: #3b82f6; font-weight: bold; text-align: center; }
  .edit-hint { font-size: 0.7rem; color: #3b82f6; margin-top: 4px; }

  .icon { font-size: 2rem; }
  .label { font-size: 1.2rem; font-weight: bold; }

  /* MODAL STYLES */
  .modal-backdrop { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.8); display: flex; align-items: center; justify-content: center; z-index: 100; }
  .modal { background: #1a1a1a; padding: 2rem; border-radius: 12px; border: 1px solid #333; width: 100%; max-width: 400px; }
  .modal h2 { margin-top: 0; color: white; }
  .form-group { margin: 1.5rem 0; }
  .form-group label { display: block; margin-bottom: 0.5rem; color: #aaa; font-size: 0.9rem; }
  .form-group input { width: 100%; padding: 0.75rem; background: #0a0a0a; border: 1px solid #333; color: white; border-radius: 6px; box-sizing: border-box; }
  .actions { display: flex; gap: 0.8rem; justify-content: flex-end; align-items: center; }
  button { padding: 0.75rem 1rem; border-radius: 6px; cursor: pointer; border: none; font-weight: bold; }
  .btn-confirm { background: #4ade80; color: #000; }
  .btn-unbook { background: transparent; color: #ef4444; border: 1px solid #ef4444; font-size: 0.8rem; }
  .btn-unbook:hover { background: #ef4444; color: white; }
  .btn-cancel { background: transparent; color: #aaa; }
</style>