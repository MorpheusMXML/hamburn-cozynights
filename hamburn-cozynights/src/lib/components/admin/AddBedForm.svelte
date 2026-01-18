<script lang="ts">
  export let roomId: string;
</script>

<div class="bed-form-container">
  <form method="POST" action="?/createBed" class="inline-form">
    <input type="hidden" name="roomId" value={roomId} />

    <input 
      type="text" 
      name="label" 
      placeholder="Bett Label (z.B. B1)" 
      required 
      class="input-small"
    />
    
    <button type="submit" class="btn-small">
      + Bett
    </button>
  </form>
</div>

<style>
  .inline-form {
    display: flex;
    gap: 0.5rem;
    align-items: center;
    margin-top: 0.5rem;
  }

  .input-small {
    background: #2a2a2a;
    border: 1px solid #444;
    color: white;
    padding: 0.25rem 0.5rem;
    border-radius: 4px;
    font-size: 0.9rem;
  }

  .btn-small {
    background: #333;
    color: #fff;
    border: 1px solid #555;
    padding: 0.25rem 0.75rem;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.9rem;
  }
  
  .btn-small:hover { background: #444; }
</style>