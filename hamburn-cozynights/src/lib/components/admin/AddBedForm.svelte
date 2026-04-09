<script lang="ts">
  export let roomId: string;
</script>

<div class="bed-form-container">
  <form method="POST" action="?/createBed" class="inline-form">
    <input type="hidden" name="roomId" value={roomId} />

    <input 
      type="text" 
      name="label" 
      placeholder="Unit ID (e.g. B1)" 
      required 
      class="input-laser"
    />
    
    <button type="submit" class="btn-ignite-small">
      IGNITE 🛌
    </button>
  </form>
</div>

<style>
  .inline-form {
    display: flex;
    gap: 0.75rem;
    align-items: center;
  }

  .input-laser {
    background: #1a1a1a;
    border: 1px solid #333;
    color: white;
    padding: 0.6rem 1rem;
    border-radius: 8px;
    font-size: 0.85rem;
    flex: 1;
    transition: all 0.3s;
  }
  .input-laser:focus { outline: none; border-color: #fb923c; box-shadow: 0 0 10px rgba(251, 146, 60, 0.2); }

  .btn-ignite-small {
    background: transparent;
    color: #fb923c;
    border: 1px solid #fb923c;
    padding: 0.6rem 1rem;
    border-radius: 8px;
    cursor: pointer;
    font-size: 0.75rem;
    font-weight: 900;
    letter-spacing: 1px;
    transition: all 0.2s;
    white-space: nowrap;
  }
  
  .btn-ignite-small:hover { 
      background: rgba(251, 146, 60, 0.1); 
      box-shadow: 0 0 15px rgba(251, 146, 60, 0.2);
      transform: translateY(-1px);
  }
</style>