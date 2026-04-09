<script lang="ts">
  export let houseId: string;
  export let disabled = false;
</script>

<div class="form-card">
  <form method="POST" action="?/createRoom" class="admin-form">
    <input type="hidden" name="houseId" value={houseId} />

    <div class="form-group">
      <label for="name">ROOM DESIGNATION (NAME)</label>
      <input type="text" id="name" name="name" placeholder="e.g. Skyline Sanctuary" required {disabled} />
    </div>

    <div class="form-row">
      <div class="form-group">
        <label for="room_number">ROOM #</label>
        <input type="number" id="room_number" name="room_number" placeholder="101" required {disabled} />
      </div>

      <div class="form-group">
        <label for="amount_beds">BED CAPACITY 🛌</label>
        <input type="number" id="amount_beds" name="amount_beds" placeholder="0" min="0" {disabled} />
      </div>
    </div>

    <button type="submit" class="btn-ignite" class:disabled {disabled}>
        IGNITE ROOM ✨
    </button>
  </form>
</div>

<style>
  .form-card {
    background: transparent;
  }
  
  .admin-form { display: flex; flex-direction: column; gap: 1.5rem; }
  
  .form-row { display: flex; gap: 1.5rem; }
  
  .form-group { display: flex; flex-direction: column; flex: 1; gap: 0.5rem; }
  
  label { font-size: 0.65rem; font-weight: 900; color: #444; letter-spacing: 1px; }
  
  input {
    padding: 0.8rem;
    background: #1a1a1a;
    border: 1px solid #333;
    color: white;
    border-radius: 8px;
    font-size: 0.9rem;
    transition: all 0.3s;
  }
  input:focus { outline: none; border-color: #2dd4bf; box-shadow: 0 0 10px rgba(45, 212, 191, 0.2); }
  input:disabled { opacity: 0.5; cursor: not-allowed; }
  
  .btn-ignite {
    background: #2dd4bf;
    color: #000;
    padding: 1rem;
    border: none;
    border-radius: 8px;
    cursor: pointer;
    font-weight: 900;
    margin-top: 0.5rem;
    font-size: 0.8rem;
    letter-spacing: 1px;
    transition: all 0.2s;
    box-shadow: 0 0 15px rgba(45, 212, 191, 0.3);
  }
  .btn-ignite:hover { transform: scale(1.02); box-shadow: 0 0 25px rgba(45, 212, 191, 0.5); }
  .btn-ignite.disabled { opacity: 0.3; cursor: not-allowed; box-shadow: none; transform: none; }
</style>