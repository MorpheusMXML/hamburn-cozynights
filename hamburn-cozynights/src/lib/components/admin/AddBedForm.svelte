<script lang="ts">
  export let roomId: string;
  export let disabled = false;
</script>

<form method="POST" action="?/createBed" class="add-bed-form">
  <input type="hidden" name="roomId" value={roomId} />
  
  <div class="input-row">
    <input 
        type="text" 
        name="label" 
        placeholder="e.g. B1 or Top Bunk" 
        required 
        {disabled}
    />
    <button type="submit" class="btn-add" {disabled} class:disabled>
        IGNITE ⚡️
    </button>
  </div>
</form>

<style>
  .add-bed-form { width: 100%; }
  .input-row { display: flex; gap: 0.5rem; }
  
  input {
    flex: 1;
    background: #1a1a1a;
    border: 1px solid #333;
    color: white;
    padding: 0.6rem 1rem;
    border-radius: 8px;
    font-size: 0.85rem;
    transition: all 0.3s;
  }
  input:focus { outline: none; border-color: #fb923c; box-shadow: 0 0 10px rgba(251, 146, 60, 0.2); }
  input:disabled { opacity: 0.5; cursor: not-allowed; }

  .btn-add {
    background: #fb923c;
    color: #000;
    border: none;
    padding: 0 1.5rem;
    border-radius: 8px;
    font-weight: 900;
    font-size: 0.75rem;
    cursor: pointer;
    transition: all 0.2s;
  }
  .btn-add:hover:not(:disabled) { transform: translateY(-2px); box-shadow: 0 5px 15px rgba(251, 146, 60, 0.3); }
  .btn-add.disabled { opacity: 0.3; cursor: not-allowed; }
</style>