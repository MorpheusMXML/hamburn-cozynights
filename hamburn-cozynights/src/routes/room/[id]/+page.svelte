<script lang="ts">
  import type { PageData, ActionData } from './$types';
  import { enhance } from '$app/forms';

  export let data: PageData;
  export let form: ActionData;

  // Modal State
  let selectedBedId: string | null = null;
  let showModal = false;
  let currentNameInput = "";

  function openBookingModal(bedId: string, name = "") {
    selectedBedId = bedId;
    currentNameInput = name || "";
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
              <span class="status-text">Belegt</span>
              <span class="guest-name">
                {bed.expand?.order?.burner_name || 'Mystery Burner'}
              </span>
           </div>
        </div>

      {:else if isMyBed}
        <button class="bed-card mine" on:click={() => openBookingModal(bed.id, bed.expand?.order?.burner_name)}>
           <div class="icon">🛏️</div>
           <span class="label">{bed.label}</span>
           <div class="status-box my-status">
              <span class="status-text">Dein Bett</span>
              <span class="guest-name">{bed.expand?.order?.burner_name}</span>
           </div>
           <small class="edit-hint">Klicken zum Ändern</small>
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
              <span>{iHaveAnotherBooking ? 'Gesperrt' : 'Frei'}</span>
              <small>{iHaveAnotherBooking ? 'Zuerst anderes Bett freigeben' : 'Jetzt buchen!'}</small>
           </div>
        </button>
      {/if}
    {/each}
  </div>
</div>

{#if showModal}
  <div class="modal-backdrop" on:click={closeModal} role="presentation">
    <div class="modal" on:click|stopPropagation role="dialog">
      <h2>{selectedBedId === data.userBedId ? 'Buchung bearbeiten' : 'Bett buchen'}</h2>
      <p>Gib einen Burner-Namen ein (optional).</p>
      
      <form method="POST" action="?/bookBed" use:enhance={() => {
          return async ({ result, update }) => {
              if (result.type === 'success') closeModal();
              await update(); 
          };
      }}>
        <input type="hidden" name="bedId" value={selectedBedId} />
        
        <div class="form-group">
            <label for="guestName">Burner Name</label>
            <input 
                type="text" 
                name="guestName" 
                id="guestName" 
                bind:value={currentNameInput} 
                placeholder="Leer lassen für Zufallsnamen..." 
            />
        </div>

        <div class="actions">
            {#if selectedBedId === data.userBedId}
                <button type="submit" formaction="?/unbookBed" class="btn-unbook">Freigeben</button>
            {/if}
            <button type="button" class="btn-cancel" on:click={closeModal}>Abbrechen</button>
            <button type="submit" class="btn-confirm">Speichern</button>
        </div>
      </form>
    </div>
  </div>
{/if}

<style>
  :global(body) { background: #050505; color: #eee; font-family: 'Segoe UI', sans-serif; }
  .container { max-width: 800px; margin: 0 auto; padding: 2rem; }
  header { margin-bottom: 2rem; border-bottom: 1px solid #333; padding-bottom: 1rem; }
  .back-link { color: #888; text-decoration: none; font-size: 0.9rem; margin-bottom: 0.5rem; display: block; }
  .back-link:hover { color: white; }
  h1 { margin: 0; font-size: 2rem; }
  h1 small { font-weight: normal; color: #666; font-size: 0.6em; margin-left: 10px; }

  .beds-grid { 
      display: grid; 
      grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); 
      gap: 1.5rem; 
  }

  .bed-card {
      position: relative;
      border-radius: 12px;
      padding: 1.5rem;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.5rem;
      border: 2px solid #333;
      background: #1a1a1a;
      transition: all 0.2s ease;
      text-align: center;
      min-height: 180px;
      justify-content: center;
      color: white;
  }

  .icon { font-size: 2.5rem; margin-bottom: 0.5rem; }
  .label { font-size: 1.2rem; font-weight: bold; display: block; }

  button.bed-card.free { cursor: pointer; }
  button.bed-card.free:hover:not(.disabled) {
      background: #222;
      border-color: #4ade80;
      transform: translateY(-4px);
      box-shadow: 0 4px 12px rgba(74, 222, 128, 0.2);
  }
  .status-box.free { color: #4ade80; font-weight: bold; display: flex; flex-direction: column; gap: 2px; }
  .status-box.free small { font-weight: normal; font-size: 0.75rem; color: #888; }

  button.bed-card.free.disabled {
      opacity: 0.4;
      cursor: not-allowed;
      border-style: dashed;
      filter: grayscale(1);
  }

  .bed-card.occupied {
      background: #150505;
      border-color: #331111;
      cursor: default;
      opacity: 0.8;
  }
  .status-box.occupied { color: #ef4444; }
  .guest-name { display: block; color: #999; font-size: 0.85rem; margin-top: 5px; font-style: italic; word-break: break-word; }

  button.bed-card.mine {
      background: #0a1220;
      border-color: #3b82f6;
      cursor: pointer;
      box-shadow: 0 0 15px rgba(59, 130, 246, 0.15);
  }
  button.bed-card.mine:hover {
      background: #0f1c30;
      transform: translateY(-2px);
      box-shadow: 0 0 20px rgba(59, 130, 246, 0.3);
  }
  .my-status { color: #3b82f6; font-weight: bold; }
  .edit-hint { font-size: 0.7rem; color: #3b82f6; margin-top: 8px; text-transform: uppercase; letter-spacing: 0.5px; }

  .modal-backdrop {
      position: fixed; top: 0; left: 0; width: 100%; height: 100%;
      background: rgba(0,0,0,0.85);
      backdrop-filter: blur(4px);
      display: flex; align-items: center; justify-content: center;
      z-index: 1000;
      animation: fadeIn 0.2s ease-out;
  }
  .modal {
      background: #1a1a1a;
      padding: 2rem;
      border-radius: 16px;
      border: 1px solid #444;
      width: 90%;
      max-width: 420px;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
      animation: slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1);
  }
  .modal h2 { margin-top: 0; color: white; margin-bottom: 0.5rem; }
  .modal p { color: #aaa; margin-bottom: 1.5rem; font-size: 0.95rem; }

  .form-group { margin-bottom: 2rem; }
  .form-group label { display: block; margin-bottom: 0.5rem; color: #bbb; font-size: 0.9rem; font-weight: bold; }
  .form-group input {
      width: 100%; padding: 0.8rem; background: #0a0a0a; border: 1px solid #333;
      color: white; border-radius: 8px; font-size: 1rem; box-sizing: border-box;
      transition: border-color 0.2s;
  }
  .form-group input:focus { outline: none; border-color: #4ade80; }

  .actions { display: flex; gap: 1rem; justify-content: flex-end; align-items: center; }
  
  button { font-family: inherit; }

  .btn-confirm { 
      padding: 0.8rem 1.5rem; border-radius: 8px; border: none; font-weight: bold; 
      background: #4ade80; color: #000; cursor: pointer; 
      transition: transform 0.1s, background 0.2s;
  }
  .btn-confirm:hover { background: #22c55e; transform: scale(1.02); }

  .btn-cancel { 
      background: transparent; color: #aaa; border: none; cursor: pointer; padding: 0.8rem;
      font-weight: 500;
  }
  .btn-cancel:hover { color: white; }

  .btn-unbook {
      margin-right: auto;
      background: transparent; color: #ef4444; border: 1px solid #ef4444; 
      padding: 0.6rem 1rem; border-radius: 6px; cursor: pointer; font-size: 0.85rem;
  }
  .btn-unbook:hover { background: #ef4444; color: white; }

  @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
  @keyframes slideUp { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
</style>